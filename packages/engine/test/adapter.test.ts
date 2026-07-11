// Unit coverage for AdapterRegistry's resolve path. No real CLI is invoked
// anywhere in this suite — StubAdapterLive stands in, per package convention.
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, Layer } from "effect"
import { AdapterRegistry, AdapterRegistryLive, StubAdapterLive } from "../src/index.js"

describe("AdapterRegistry", () => {
  const registryLayer = AdapterRegistryLive({
    "harness-a": StubAdapterLive({}, "harness-a/1"),
    "harness-b": StubAdapterLive({}, "harness-b/2"),
  }).pipe(Layer.provide(NodeContext.layer))

  it.effect("resolves each registered harness to its own adapter", () =>
    Effect.gen(function* () {
      const registry = yield* AdapterRegistry
      const a = yield* registry.resolve("harness-a")
      const b = yield* registry.resolve("harness-b")
      expect(yield* a.harnessId).toBe("harness-a/1")
      expect(yield* b.harnessId).toBe("harness-b/2")
    }).pipe(Effect.provide(registryLayer)),
  )

  it.effect("fails with UnknownHarnessError for an unregistered harness", () =>
    Effect.gen(function* () {
      const registry = yield* AdapterRegistry
      const result = yield* Effect.either(registry.resolve("does-not-exist"))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("UnknownHarnessError")
        expect([...result.left.known].sort()).toEqual(["harness-a", "harness-b"])
      }
    }).pipe(Effect.provide(registryLayer)),
  )
})
