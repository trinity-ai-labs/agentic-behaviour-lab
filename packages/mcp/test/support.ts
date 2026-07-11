// Shared test wiring: a throwaway ABL_HOME and a ManagedRuntime carrying
// the stub-backed engine — the same shape main.ts builds, with
// StubAdapterLive in place of the real Claude CLI so no agent is ever
// spawned and every trial is deterministic.
import { EngineLive, StubAdapterLive } from '@abl/engine';
import { NodeContext } from '@effect/platform-node';
import { Layer, ManagedRuntime } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LabRuntime } from '../src/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const fixturesRoot = path.join(__dirname, 'fixtures');
const subjects = path.join(fixturesRoot, 'mcp-min', 'subjects');

export const stubScripts = {
  'stub-complete': path.join(subjects, 'complete.mjs'),
  'stub-partial': path.join(subjects, 'partial.mjs'),
};

export interface TestLab {
  readonly runtime: LabRuntime;
  readonly ablHome: string;
  readonly dispose: () => Promise<void>;
}

export const makeTestLab = (): TestLab => {
  const ablHome = mkdtempSync(path.join(tmpdir(), 'abl-mcp-test-'));
  const runtime: LabRuntime = ManagedRuntime.make(
    EngineLive({
      ablHome,
      scenarioRoots: [fixturesRoot],
      adapters: { 'claude-cli': StubAdapterLive(stubScripts) },
    }).pipe(Layer.provideMerge(NodeContext.layer)),
  );
  return {
    runtime,
    ablHome,
    dispose: async () => {
      await runtime.dispose();
      rmSync(ablHome, { recursive: true, force: true });
    },
  };
};
