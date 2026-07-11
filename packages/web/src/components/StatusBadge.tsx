import type { RunRecord } from "@abl/engine"
import styles from "./StatusBadge.module.css"

type RunStatus = RunRecord["status"]

export const StatusBadge = (props: { status: RunStatus }) => (
  <span class={styles.badge} data-status={props.status}>
    {statusGlyph(props.status)} {props.status}
  </span>
)

const statusGlyph = (status: RunStatus): string =>
  status === "running" ? "●" : status === "completed" ? "✓" : "✕"
