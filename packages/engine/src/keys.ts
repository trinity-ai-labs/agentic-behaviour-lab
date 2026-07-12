/**
 * `KeyStore` — encrypted API key storage for the lab.
 *
 * Keys are stored at `~/.abl/keys.json`, encrypted with AES-256-GCM using a
 * machine-local keyfile (`~/.abl/.keyfile`, generated on first access). At
 * resolution time, env vars (`<PROVIDER>_API_KEY`) take precedence over the
 * encrypted store, so CI/staging can skip the file store entirely.
 *
 * The lab is a solo, local-first tool — no multi-user cascade, no key
 * distribution, just one encrypted blob per provider.
 */
import { FileSystem, Path } from '@effect/platform';
import { Context, Data, Effect, Layer } from 'effect';
import * as Crypto from 'node:crypto';
import { defaultAblHome } from './store.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class KeyNotFound extends Data.TaggedError('KeyNotFound')<{
  readonly provider: string;
}> {}

export class KeyStoreError extends Data.TaggedError('KeyStoreError')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface KeyStoreShape {
  /**
   * Resolve an API key for a provider. Checks env vars first
   * (`<PROVIDER>_API_KEY`), then falls back to the encrypted store.
   * Returns `KeyNotFound` when neither source has a key.
   */
  readonly resolve: (provider: string) => Effect.Effect<string, KeyNotFound | KeyStoreError>;

  /** Persist a key for a provider (encrypted at rest). */
  readonly set: (provider: string, key: string) => Effect.Effect<void, KeyStoreError>;

  /** Remove a stored key for a provider. No-op if absent. */
  readonly delete: (provider: string) => Effect.Effect<void, KeyStoreError>;

  /** List providers that have a stored key (redacted — values are never returned). */
  readonly list: Effect.Effect<ReadonlyArray<string>, KeyStoreError>;

  /** Check whether a provider has a configured key (env or stored). */
  readonly isConfigured: (provider: string) => Effect.Effect<boolean, KeyStoreError>;
}

export class KeyStore extends Context.Tag('@abl/engine/KeyStore')<KeyStore, KeyStoreShape>() {}

// ---------------------------------------------------------------------------
// AES-256-GCM helpers
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12; // 96 bits — standard for GCM
const TAG_LENGTH = 16; // 128 bits

interface EncryptedBlob {
  readonly iv: string; // base64
  readonly tag: string; // base64
  readonly ciphertext: string; // base64
}

type KeysFile = Record<string, EncryptedBlob>;

const encrypt = (plaintext: string, key: Buffer): EncryptedBlob => {
  const iv = Crypto.randomBytes(IV_LENGTH);
  const cipher = Crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
};

const decrypt = (blob: EncryptedBlob, key: Buffer): string => {
  const decipher = Crypto.createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};

// ---------------------------------------------------------------------------
// Key derivation — machine-local, no passphrase needed
// ---------------------------------------------------------------------------

const KEYFILE_NAME = '.keyfile';
const KEYS_FILE_NAME = 'keys.json';
const ENV_KEY_PATTERN = /^([A-Z_]+)_API_KEY$/;

/** Derive the provider name from an env var key name, e.g. `DEEPSEEK_API_KEY` → `deepseek`. */
const providerFromEnvKey = (keyName: string): string | undefined => {
  const match = ENV_KEY_PATTERN.exec(keyName);
  return match ? match[1]!.toLowerCase() : undefined;
};

/**
 * Resolve a key from environment variables. Checks `<PROVIDER>_API_KEY`
 * (uppercased, hyphens → underscores). Returns undefined when not set.
 */
const resolveFromEnv = (provider: string): string | undefined => {
  const keyName = `${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`;
  const value = process.env[keyName];
  return value && value.length > 0 ? value : undefined;
};

// ---------------------------------------------------------------------------
// KeyStore implementation
// ---------------------------------------------------------------------------

/**
 * File-backed encrypted key store. On first access, generates a random 256-bit
 * keyfile at `<ablHome>/.keyfile` and uses it for all subsequent
 * encrypt/decrypt operations. Overridable via `ABL_KEYFILE` env var.
 */
export const KeyStoreLive = (
  ablHome: string = defaultAblHome(),
): Layer.Layer<KeyStore, KeyStoreError, FileSystem.FileSystem | Path.Path> =>
  Layer.scoped(
    KeyStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const keyfilePath = process.env.ABL_KEYFILE ?? path.join(ablHome, KEYFILE_NAME);
      const keysFilePath = path.join(ablHome, KEYS_FILE_NAME);

      // Ensure the ablHome directory exists.
      yield* fs
        .makeDirectory(ablHome, { recursive: true })
        .pipe(Effect.mapError((cause) => new KeyStoreError({ operation: 'mkdir', cause })));

      // Load or generate the encryption key.
      const rawKey = yield* Effect.gen(function* () {
        const exists = yield* fs.exists(keyfilePath).pipe(
          Effect.mapError((cause) => new KeyStoreError({ operation: 'readKeyfile', cause })),
        );
        if (exists) {
          return yield* fs.readFileString(keyfilePath).pipe(
            Effect.mapError((cause) => new KeyStoreError({ operation: 'readKeyfile', cause })),
          );
        }
        // First run — generate a random 256-bit key.
        const generated = Crypto.randomBytes(32).toString('base64');
        yield* fs.writeFileString(keyfilePath, generated).pipe(
          Effect.mapError((cause) => new KeyStoreError({ operation: 'writeKeyfile', cause })),
        );
        return generated;
      });

      const encKey = Buffer.from(rawKey, 'base64');

      /** Read + decrypt the keys file. Returns empty object when it doesn't exist. */
      const readKeys = (): Effect.Effect<KeysFile, KeyStoreError> =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(keysFilePath).pipe(
            Effect.mapError((cause) => new KeyStoreError({ operation: 'readKeys', cause })),
          );
          if (!exists) return {};
          const raw = yield* fs.readFileString(keysFilePath).pipe(
            Effect.mapError((cause) => new KeyStoreError({ operation: 'readKeys', cause })),
          );
          if (raw.trim().length === 0) return {};
          try {
            return JSON.parse(raw) as KeysFile;
          } catch (cause) {
            return yield* Effect.fail(new KeyStoreError({ operation: 'parseKeys', cause }));
          }
        });

      /** Write + encrypt the keys file. */
      const writeKeys = (keys: KeysFile): Effect.Effect<void, KeyStoreError> =>
        fs
          .writeFileString(keysFilePath, JSON.stringify(keys, null, 2))
          .pipe(Effect.mapError((cause) => new KeyStoreError({ operation: 'writeKeys', cause })));

      const resolve: KeyStoreShape['resolve'] = (provider) =>
        Effect.gen(function* () {
          // 1. Env var takes precedence.
          const envValue = resolveFromEnv(provider);
          if (envValue !== undefined) return envValue;

          // 2. Fall back to encrypted store.
          const keys = yield* readKeys();
          const blob = keys[provider];
          if (blob === undefined) {
            return yield* Effect.fail(new KeyNotFound({ provider }));
          }
          try {
            return decrypt(blob, encKey);
          } catch (cause) {
            return yield* Effect.fail(new KeyStoreError({ operation: 'decrypt', cause }));
          }
        });

      const set: KeyStoreShape['set'] = (provider, key) =>
        Effect.gen(function* () {
          const keys = yield* readKeys();
          keys[provider] = encrypt(key, encKey);
          yield* writeKeys(keys);
        });

      const del: KeyStoreShape['delete'] = (provider) =>
        Effect.gen(function* () {
          const keys = yield* readKeys();
          delete keys[provider];
          yield* writeKeys(keys);
        });

      const list: KeyStoreShape['list'] = Effect.gen(function* () {
          const keys = yield* readKeys();
          // Include configured env-var keys too.
          const stored = Object.keys(keys);
          const envProviders = Object.keys(process.env)
            .map(providerFromEnvKey)
            .filter((p): p is string => p !== undefined);
          const all = new Set([...stored, ...envProviders]);
          return [...all].sort();
        });

      const isConfigured: KeyStoreShape['isConfigured'] = (provider) =>
        Effect.gen(function* () {
          if (resolveFromEnv(provider) !== undefined) return true;
          const keys = yield* readKeys();
          return keys[provider] !== undefined;
        });

      return KeyStore.of({ resolve, set, delete: del, list, isConfigured });
    }),
  );

/**
 * In-memory stub for tests — no file I/O, no encryption.
 * Keys added via `set` survive until process exit; `resolve` always returns
 * `KeyNotFound` for unset keys (no env-var fallback in test mode).
 */
export const KeyStoreStub: Layer.Layer<KeyStore, never, never> = Layer.effect(
  KeyStore,
  Effect.sync(() => {
    const store = new Map<string, string>();

    const resolve: KeyStoreShape['resolve'] = (provider) =>
      Effect.gen(function* () {
        const key = store.get(provider);
        if (key === undefined) {
          return yield* Effect.fail(new KeyNotFound({ provider }));
        }
        return key;
      });

    const set: KeyStoreShape['set'] = (provider, key) =>
      Effect.sync(() => {
        store.set(provider, key);
      });

    const del: KeyStoreShape['delete'] = (provider) =>
      Effect.sync(() => {
        store.delete(provider);
      });

    const list: KeyStoreShape['list'] = Effect.sync(() => [...store.keys()].sort());

    const isConfigured: KeyStoreShape['isConfigured'] = (provider) =>
      Effect.sync(() => store.has(provider));

    return KeyStore.of({ resolve, set, delete: del, list, isConfigured });
  }),
);
