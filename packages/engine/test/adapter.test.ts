// Unit coverage for AdapterRegistry's resolve path. No real CLI is invoked
// anywhere in this suite — StubAdapterLive stands in, per package convention.
import { NodeContext } from '@effect/platform-node';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Either, Layer } from 'effect';
import {
  AdapterRegistry,
  AdapterRegistryLive,
  AgentAdapter,
  StubAdapterLive,
} from '../src/index.js';
import { stubScripts } from './support.js';

describe('AdapterRegistry', () => {
  const registryLayer = AdapterRegistryLive({
    'harness-a': StubAdapterLive({}, 'harness-a/1'),
    'harness-b': StubAdapterLive({}, 'harness-b/2'),
  }).pipe(Layer.provide(NodeContext.layer));

  it.effect('resolves each registered harness to its own adapter', () =>
    Effect.gen(function* () {
      const registry = yield* AdapterRegistry;
      const a = yield* registry.resolve('harness-a');
      const b = yield* registry.resolve('harness-b');
      expect(yield* a.harnessId).toBe('harness-a/1');
      expect(yield* b.harnessId).toBe('harness-b/2');
    }).pipe(Effect.provide(registryLayer)),
  );

  it.effect('fails with UnknownHarnessError for an unregistered harness', () =>
    Effect.gen(function* () {
      const registry = yield* AdapterRegistry;
      const result = yield* Effect.either(registry.resolve('does-not-exist'));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('UnknownHarnessError');
        expect([...result.left.known].sort()).toEqual(['harness-a', 'harness-b']);
      }
    }).pipe(Effect.provide(registryLayer)),
  );
});

describe('StubAdapter disposition', () => {
  const adapterLayer = StubAdapterLive({
    'stub-complete': stubScripts['stub-complete'],
    'stub-provider-degraded': stubScripts['stub-provider-degraded'],
    'stub-disposition-crashed': stubScripts['stub-disposition-crashed'],
    'stub-disposition-timeout': stubScripts['stub-disposition-timeout'],
  }).pipe(Layer.provide(NodeContext.layer));

  it.effect('returns completed for a normal stub script', () =>
    Effect.gen(function* () {
      const adapter = yield* AgentAdapter;
      const result = yield* adapter.run({
        modelId: 'stub-complete',
        brief: 'test',
        workspaceDir: '/tmp',
      });
      expect(result.disposition).toBe('completed');
      expect(result.finalMessage.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.effect('returns provider-degraded when the script emits DISPOSITION:provider-degraded', () =>
    Effect.gen(function* () {
      const adapter = yield* AgentAdapter;
      const result = yield* adapter.run({
        modelId: 'stub-provider-degraded',
        brief: 'test',
        workspaceDir: '/tmp',
      });
      expect(result.disposition).toBe('provider-degraded');
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.effect('returns timeout when the script emits DISPOSITION:timeout', () =>
    Effect.gen(function* () {
      const adapter = yield* AgentAdapter;
      const result = yield* adapter.run({
        modelId: 'stub-disposition-timeout',
        brief: 'test',
        workspaceDir: '/tmp',
      });
      expect(result.disposition).toBe('timeout');
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.effect('returns crashed when the script emits DISPOSITION:crashed', () =>
    Effect.gen(function* () {
      const adapter = yield* AgentAdapter;
      const result = yield* adapter.run({
        modelId: 'stub-disposition-crashed',
        brief: 'test',
        workspaceDir: '/tmp',
      });
      expect(result.disposition).toBe('crashed');
    }).pipe(Effect.provide(adapterLayer)),
  );
});
