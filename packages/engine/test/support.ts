// Shared test wiring: a throwaway ABL_HOME plus the StubAdapter scripts
// under fixtures/scenario-min/subjects. Not a test file itself — imported
// by the test files and by examples/smoke.ts, which exercises the same
// stub-backed engine.
import { NodeContext } from '@effect/platform-node';
import { Layer } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineLive, StubAdapterLive } from '../src/index.js';
import type { TrialRecord } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const fixturesRoot = path.join(__dirname, 'fixtures');
const scenarioMinSubjects = path.join(fixturesRoot, 'scenario-min', 'subjects');

export const stubScripts = {
  'stub-complete': path.join(scenarioMinSubjects, 'complete.mjs'),
  'stub-partial': path.join(scenarioMinSubjects, 'partial.mjs'),
  'stub-poison': path.join(scenarioMinSubjects, 'poison.mjs'),
  'stub-noop': path.join(scenarioMinSubjects, 'noop.mjs'),
  'stub-provider-degraded': path.join(scenarioMinSubjects, 'provider-degraded.mjs'),
  'stub-disposition-timeout': path.join(scenarioMinSubjects, 'disposition-timeout.mjs'),
  'stub-disposition-crashed': path.join(scenarioMinSubjects, 'disposition-crashed.mjs'),
};

/** A fresh ABL_HOME under the OS temp dir. Pair with `cleanupTempHome`. */
export const makeTempHome = (): string => mkdtempSync(path.join(tmpdir(), 'abl-engine-test-'));
export const cleanupTempHome = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** The full stub-backed engine against a given ABL_HOME, ready to provide as-is. */
export const stubEngine = (ablHome: string) =>
  EngineLive({
    ablHome,
    scenarioRoots: [fixturesRoot],
    adapters: { 'claude-cli': StubAdapterLive(stubScripts) },
  }).pipe(Layer.provide(NodeContext.layer));

/**
 * Two distinct stub harnesses registered under different ids, each reporting
 * its own harnessId — for tests proving a run fans across harnesses (trials
 * differ only in fingerprint.harness), independent of the model axis.
 */
export const stubHarnessIds = {
  'stub-harness-a': 'stub-cli-a/1.0 (test)',
  'stub-harness-b': 'stub-cli-b/2.0 (test)',
} as const;

export const stubMultiHarnessEngine = (ablHome: string) =>
  EngineLive({
    ablHome,
    scenarioRoots: [fixturesRoot],
    adapters: {
      'stub-harness-a': StubAdapterLive(stubScripts, stubHarnessIds['stub-harness-a']),
      'stub-harness-b': StubAdapterLive(stubScripts, stubHarnessIds['stub-harness-b']),
    },
  }).pipe(Layer.provide(NodeContext.layer));

/** A fully-populated TrialRecord for store/index tests; override what a test cares about. */
export const makeTrial = (
  overrides: Partial<TrialRecord> & Pick<TrialRecord, 'trialId'>,
): TrialRecord => ({
  runId: 'run-1',
  scenarioId: 'scenario-min',
  condition: { label: 'default', params: {} },
  shape: 'one-shot',
  fingerprint: {
    modelId: 'stub-complete',
    harness: 'stub-adapter/1',
    os: 'test-os',
    scenarioVersion: 'abc',
    graderVersion: 'def',
  },
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  artifacts: {},
  verdict: { outcome: 'pass', gradedBy: 'mechanical', detail: {} },
  ...overrides,
});
