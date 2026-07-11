// Stands in for `claude --output-format json`: prints the same
// `{"result": "..."}` envelope a real headless authoring call would, with
// the drafted scenario fenced as ```json inside `result` (so the test also
// exercises the parser's code-fence stripping, not just the happy path).
const files = [
  {
    path: "scenario.json",
    content: JSON.stringify(
      {
        scenarioId: "authored-min",
        version: "1",
        title: "Authored minimal scenario (test fixture)",
        family: "test-fixture",
        description:
          "Drafted by the authoring test's stub CLI to exercise draft -> save -> ScenarioRepo.load end to end.",
        fixture: "fixture.mjs",
        grader: "grader.mjs",
        brief: "brief.md",
        conditions: [{ label: "default", params: {} }],
        declaredShapes: ["one-shot"],
      },
      null,
      2,
    ),
  },
  {
    path: "brief.md",
    content: "Write `marker-1` into `$WORKSPACE_DIR`.\n",
  },
  {
    path: "fixture.mjs",
    content: [
      'import { writeFileSync } from "node:fs"',
      'import { join } from "node:path"',
      'writeFileSync(join(process.env.WORKSPACE_DIR, "SEED.md"), "authored-min hermetic workspace\\n")',
      "",
    ].join("\n"),
  },
  {
    path: "grader.mjs",
    content: [
      'import { existsSync } from "node:fs"',
      'import { join } from "node:path"',
      'const found = existsSync(join(process.env.WORKSPACE_DIR, "marker-1"))',
      'process.stdout.write(JSON.stringify({ outcome: found ? "pass" : "fail", gradedBy: "mechanical", detail: { found } }))',
      "",
    ].join("\n"),
  },
]

const draft = { files, rationale: "Minimal scenario proving the draft -> save -> load loop." }
const resultText = "```json\n" + JSON.stringify(draft) + "\n```"
process.stdout.write(JSON.stringify({ result: resultText }))
