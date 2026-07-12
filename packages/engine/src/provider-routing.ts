/**
 * Provider-aware model routing — resolves which environment variables to inject
 * per trial so third-party providers that speak the Anthropic Messages API
 * (DeepSeek, Qwen, Moonshot, etc.) route through the Claude CLI harness
 * transparently, and OpenAI/xAI route through the Codex CLI harness.
 *
 * Mirrors Trinity's `resolveModelEnv` in `trinity/src/lib/agent/model.ts` but
 * adapted for the lab's single-user, local-first model.
 */
import { parseModelId } from './catalog.js';
import type { ModelProvider } from './schema.js';

// ---------------------------------------------------------------------------
// Provider env tables
// ---------------------------------------------------------------------------

interface ProviderEnv {
  /** The env var names + values to inject for this provider. */
  readonly env: Record<string, string>;
  /**
   * Required key name for auth. When present, the caller must supply this
   * from the key store or env vars — the value is substituted at injection
   * time, not hardcoded here.
   */
  readonly keyName?: string;
  /** Auth env var to set (where the key value goes). */
  readonly authVar?: string;
}

/**
 * Provider env config — maps provider → the env vars to inject for
 * Anthropic-compat routing. Providers NOT in this map (anthropic, openai, xai)
 * need no env override — they authenticate via OAuth or their own CLI config.
 *
 * All Anthropic-compat providers set ANTHROPIC_BASE_URL to the provider's
 * endpoint. The auth key is injected as ANTHROPIC_API_KEY (or
 * ANTHROPIC_AUTH_TOKEN for Z.ai). The key value comes from the caller at
 * injection time — never stored here.
 */
const PROVIDER_ENV: Record<string, ProviderEnv> = {
  deepseek: {
    env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
    keyName: 'DEEPSEEK_API_KEY',
    authVar: 'ANTHROPIC_API_KEY',
  },
  moonshot: {
    env: { ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic' },
    keyName: 'MOONSHOT_API_KEY',
    authVar: 'ANTHROPIC_API_KEY',
  },
  zai: {
    env: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      API_TIMEOUT_MS: '3000000',
    },
    keyName: 'ZAI_API_KEY',
    authVar: 'ANTHROPIC_AUTH_TOKEN',
  },
  qwen: {
    env: { ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic' },
    keyName: 'QWEN_API_KEY',
    authVar: 'ANTHROPIC_API_KEY',
  },
  xiaomi: {
    env: { ANTHROPIC_BASE_URL: 'https://api.xiaomimimo.com/anthropic' },
    keyName: 'XIAOMI_API_KEY',
    authVar: 'ANTHROPIC_API_KEY',
  },
  ollama: {
    env: {
      ANTHROPIC_BASE_URL: '',
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_API_KEY: '',
    },
    keyName: 'OLLAMA_BASE_URL',
  },
  xai: {
    env: {},
    keyName: 'XAI_API_KEY',
    authVar: 'XAI_API_KEY',
  },
};

/** Providers that REQUIRE a configured API key — OAuth-based providers are absent. */
const KEY_REQUIRED_PROVIDERS = new Set([
  'deepseek',
  'xiaomi',
  'moonshot',
  'qwen',
  'zai',
  'xai',
]);

/** Does this provider require a stored API key? */
export const providerRequiresKey = (provider: ModelProvider): boolean =>
  KEY_REQUIRED_PROVIDERS.has(provider);

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ModelEnvResult {
  /** The model flag to pass as `--model` (the short model name, never compound). */
  readonly modelFlag: string;
  /** Env vars to inject into the subprocess. Empty when no routing is needed. */
  readonly env: Record<string, string>;
}

/**
 * Resolve the env vars to inject for a given compound model value.
 *
 * - For Anthropic-compat providers (DeepSeek, Qwen, …): sets ANTHROPIC_BASE_URL
 *   + the auth var (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN).
 * - For Ollama: uses the stored base URL or defaults to localhost.
 * - For native providers (anthropic, openai): returns empty env — the CLI
 *   handles auth via its own OAuth/login flow.
 * - For xAI: returns only the key var — Codex's custom-provider config handles
 *   the endpoint routing (in the lab, this is done via the adapter's existing
 *   CLI flags).
 *
 * `secrets` is a flat map of key_name → value (from KeyStore or env vars).
 * When a key is missing, the auth var is simply omitted — the subprocess will
 * fail naturally with a provider auth error, which the degradation pattern
 * matcher catches.
 */
export const resolveModelEnv = (
  modelValue: string,
  secrets?: Record<string, string>,
): ModelEnvResult => {
  // Strip optional ?effort=X suffix before parsing the model identity.
  const effortMatch = /\?effort=(low|medium|high|xhigh|max)$/.exec(modelValue);
  const effort = effortMatch?.[1];
  const cleanValue = effortMatch ? modelValue.slice(0, effortMatch.index) : modelValue;

  const { provider, model } = parseModelId(cleanValue);
  const config = PROVIDER_ENV[provider];
  const getKey = (keyName: string): string | undefined => secrets?.[keyName];

  let env: Record<string, string> = {};

  if (config === undefined) {
    // Native providers (anthropic, openai) — no routing env override needed.
  } else if (provider === 'ollama') {
    const baseUrl = getKey('OLLAMA_BASE_URL') || 'http://localhost:11434';
    env = {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_API_KEY: '',
    };
  } else {
    // Anthropic-compat providers — static base env + optional auth key.
    env = { ...config.env };
    if (config.keyName && config.authVar) {
      const key = getKey(config.keyName);
      if (key !== undefined) {
        env[config.authVar] = key;
      }
    }
  }

  // Effort level (from ?effort=X suffix on the model string). Sets
  // CLAUDE_CODE_EFFORT_LEVEL which the Claude harness reads.
  if (effort !== undefined) {
    env['CLAUDE_CODE_EFFORT_LEVEL'] = effort;
  }

  return { modelFlag: model, env };
};

/**
 * Resolve which harness to use for a given model value.
 * Routes Anthropic-compat providers to claude-cli, OpenAI/xAI to codex-cli.
 * Raw (non-compound) model IDs default to claude-cli for backward compatibility.
 */
export const resolveModelHarness = (modelValue: string): string => {
  const { provider } = parseModelId(modelValue);

  switch (provider) {
    case 'openai':
    case 'xai':
      return 'codex-cli';
    default:
      return 'claude-cli';
  }
};
