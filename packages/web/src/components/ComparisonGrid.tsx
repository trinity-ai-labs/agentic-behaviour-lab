/**
 * The Benchmarks headline: same scenario + same prompt, rates compared side
 * by side. Rows are conditions, columns are model × harness pairs — harness
 * is a first-class comparison dimension alongside model (RunConfig.harnesses
 * fans the same way models does; CellSummary.harness carries the executing
 * fingerprint harness string), not folded into the model label.
 */
import { For, Show, createMemo } from "solid-js"
import type { CellSummary, ScenarioDefinition } from "../api/client"
import { formatFailRate } from "../lib/format"
import { PipGrid } from "./PipGrid"
import styles from "./ComparisonGrid.module.css"

export interface ComparisonGridProps {
  readonly scenario: ScenarioDefinition
  readonly cells: ReadonlyArray<CellSummary>
}

interface Column {
  readonly modelId: string
  readonly harness: string
}

/** "|" can appear in a harness string ("headless -p" won't, but ids are free-form), so the joiner is a US separator control-picture character that never occurs in either field. */
const columnKey = (modelId: string, harness: string): string => `${modelId}␟${harness}`

export const ComparisonGrid = (props: ComparisonGridProps) => {
  // Column objects are cached across recomputes so a data refetch that adds
  // trials (but no new model x harness pair) hands <For> the SAME references —
  // otherwise every poll tick would remount the whole table instead of
  // patching the changed numbers.
  const columnCache = new Map<string, Column>()
  const columns = createMemo<ReadonlyArray<Column>>(() => {
    const present = new Set<string>()
    for (const cell of props.cells) {
      const key = columnKey(cell.modelId, cell.harness)
      present.add(key)
      if (!columnCache.has(key)) columnCache.set(key, { modelId: cell.modelId, harness: cell.harness })
    }
    return [...present]
      .map((key) => columnCache.get(key)!)
      .sort((a, b) => a.modelId.localeCompare(b.modelId) || a.harness.localeCompare(b.harness))
  })

  // One O(cells) pass per data change, O(1) per rendered cell after that.
  const cellsByKey = createMemo(() => {
    const map = new Map<string, CellSummary>()
    for (const cell of props.cells) {
      map.set(`${cell.condition}␟${columnKey(cell.modelId, cell.harness)}`, cell)
    }
    return map
  })

  const cellFor = (conditionLabel: string, column: Column): CellSummary | undefined =>
    cellsByKey().get(`${conditionLabel}␟${columnKey(column.modelId, column.harness)}`)

  return (
    <div class={styles.wrap}>
      <table class={styles.table}>
        <caption class={styles.caption}>
          {props.scenario.title} — rows are conditions, columns are model × harness
        </caption>
        <thead>
          <tr>
            <th scope="col" class={styles.cornerHeader}>
              Condition
            </th>
            <For each={columns()}>
              {(col) => (
                <th scope="col" class={styles.colHeader}>
                  <div class={styles.colHeaderModel}>{col.modelId}</div>
                  <div class={styles.colHeaderHarness}>{col.harness}</div>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.scenario.conditions}>
            {(condition) => (
              <tr>
                <th scope="row" class={styles.rowHeader}>
                  {condition.label}
                </th>
                <For each={columns()}>
                  {(col) => (
                    <td class={styles.cell}>
                      <Show
                        when={cellFor(condition.label, col)}
                        fallback={<span class={styles.empty}>no trials yet</span>}
                      >
                        {(c) => (
                          <div class={styles.cellBody}>
                            <PipGrid
                              size="sm"
                              pass={c().pass}
                              fail={c().fail}
                              inconclusive={c().inconclusive}
                              error={c().error}
                            />
                            <div class={styles.cellStat}>{formatFailRate(c().failRate, c().pass, c().fail)}</div>
                          </div>
                        )}
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
