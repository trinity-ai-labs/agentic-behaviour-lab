/**
 * Scenario-root resolution as a pure function, so the repo-library vs
 * local-workspace precedence is a named, testable rule rather than a side
 * effect of the entrypoint.
 */
import * as NodePath from "node:path"

/**
 * An explicit ABL_SCENARIO_ROOTS value (path-delimiter-separated) wins;
 * otherwise the invoking project's `scenarios/` directory is searched
 * first, then the ABL home's — so a local workspace scenario can shadow a
 * repo-library one of the same id.
 */
export const resolveScenarioRoots = (
  env: string | undefined,
  cwd: string,
  ablHome: string,
): ReadonlyArray<string> =>
  env !== undefined && env.length > 0
    ? env.split(NodePath.delimiter).filter((root) => root.length > 0)
    : [NodePath.join(cwd, "scenarios"), NodePath.join(ablHome, "scenarios")]
