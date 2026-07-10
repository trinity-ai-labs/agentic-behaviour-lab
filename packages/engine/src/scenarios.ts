/**
 * Loads scenario definitions (`scenario.json` + brief template + fixture and
 * grader scripts) from configured root directories — the repo's `scenarios/`
 * plus a user's local workspace, in precedence order. A scenario's content
 * hash (of `scenario.json` and of its grader script) becomes part of every
 * trial's environment fingerprint, so a scenario or grader edit is always
 * visible in the fingerprinted record.
 */
import { FileSystem, Path } from "@effect/platform"
import { Context, Data, Effect, Layer, Schema } from "effect"
import { createHash } from "node:crypto"
import { ScenarioDefinition } from "./schema.js"

export class ScenarioNotFound extends Data.TaggedError("ScenarioNotFound")<{
  readonly scenarioId: string
  readonly roots: ReadonlyArray<string>
}> {}

export class ScenarioInvalid extends Data.TaggedError("ScenarioInvalid")<{
  readonly scenarioId: string
  readonly dir: string
  readonly cause: unknown
}> {}

export type ScenarioLoadError = ScenarioNotFound | ScenarioInvalid

export interface LoadedScenario {
  readonly definition: ScenarioDefinition
  /** Absolute directory the scenario was loaded from. */
  readonly dir: string
  /** Absolute path to the fixture script. */
  readonly fixturePath: string
  /** Absolute path to the grader script. */
  readonly graderPath: string
  /** Raw brief markdown, `{{param}}` placeholders unresolved — see `renderBrief`. */
  readonly briefTemplate: string
  /** sha256 of `scenario.json`'s raw bytes. */
  readonly scenarioVersion: string
  /** sha256 of the grader script's raw bytes. */
  readonly graderVersion: string
}

export interface ScenarioRepoShape {
  readonly load: (scenarioId: string) => Effect.Effect<LoadedScenario, ScenarioLoadError>
  readonly list: Effect.Effect<ReadonlyArray<ScenarioDefinition>, ScenarioInvalid>
}

export class ScenarioRepo extends Context.Tag("@abl/engine/ScenarioRepo")<ScenarioRepo, ScenarioRepoShape>() {}

const contentHash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")

const ScenarioDefinitionFromJson = Schema.parseJson(ScenarioDefinition)

/**
 * `roots` are searched in order; the first root containing
 * `<root>/<scenarioId>/scenario.json` wins for `load`, and `list` merges
 * across all roots with earlier roots taking precedence on id collisions —
 * so a local workspace scenario can shadow a repo one of the same id.
 */
export const ScenarioRepoLive = (
  roots: ReadonlyArray<string>,
): Layer.Layer<ScenarioRepo, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    ScenarioRepo,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const loadFromDir = (scenarioId: string, dir: string): Effect.Effect<LoadedScenario, ScenarioInvalid> =>
        Effect.gen(function* () {
          const scenarioJsonPath = path.join(dir, "scenario.json")
          const raw = yield* fs.readFileString(scenarioJsonPath)
          const definition = yield* Schema.decodeUnknown(ScenarioDefinitionFromJson)(raw)
          const fixturePath = path.join(dir, definition.fixture)
          const graderPath = path.join(dir, definition.grader)
          const briefPath = path.join(dir, definition.brief)
          const briefTemplate = yield* fs.readFileString(briefPath)
          const graderBytes = yield* fs.readFile(graderPath)
          return {
            definition,
            dir,
            fixturePath,
            graderPath,
            briefTemplate,
            scenarioVersion: contentHash(raw),
            graderVersion: contentHash(graderBytes),
          }
        }).pipe(Effect.mapError((cause) => new ScenarioInvalid({ scenarioId, dir, cause })))

      const load: ScenarioRepoShape["load"] = (scenarioId) =>
        Effect.gen(function* () {
          for (const root of roots) {
            const dir = path.join(root, scenarioId)
            const exists = yield* fs.exists(path.join(dir, "scenario.json")).pipe(Effect.orElseSucceed(() => false))
            if (exists) return yield* loadFromDir(scenarioId, dir)
          }
          return yield* Effect.fail(new ScenarioNotFound({ scenarioId, roots }))
        })

      const list: ScenarioRepoShape["list"] = Effect.gen(function* () {
        const seen = new Set<string>()
        const definitions: Array<ScenarioDefinition> = []
        for (const root of roots) {
          const rootExists = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false))
          if (!rootExists) continue
          const entries = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))
          for (const entry of entries) {
            if (seen.has(entry)) continue
            const dir = path.join(root, entry)
            const hasScenario = yield* fs
              .exists(path.join(dir, "scenario.json"))
              .pipe(Effect.orElseSucceed(() => false))
            if (!hasScenario) continue
            const loaded = yield* loadFromDir(entry, dir)
            seen.add(entry)
            definitions.push(loaded.definition)
          }
        }
        return definitions
      })

      return ScenarioRepo.of({ load, list })
    }),
  )

/**
 * Substitutes `{{param}}` placeholders in a brief template from the
 * condition's params. A placeholder with no matching param is left
 * untouched rather than failing — an author-facing typo shows up plainly in
 * the rendered brief instead of aborting the trial.
 */
export const renderBrief = (template: string, params: Readonly<Record<string, string>>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in params ? params[key]! : match))
