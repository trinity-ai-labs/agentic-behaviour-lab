/**
 * The signature element (docs/DESIGN.md): a benchmark cell renders its N as
 * discrete per-trial pips, one per trial, colored by verdict — never an
 * abstract percentage bar. Ten trials = ten visible pips.
 *
 * Pips are grouped by outcome (pass, fail, inconclusive, error, then
 * pending) in a fixed group order, each group its own `<Index>` over
 * `Array(count)`. Within a live run a group's count only ever grows — a
 * trial that has landed never un-lands — so `<Index>` (keyed by position)
 * mounts a fresh DOM node only for the newly-added tail of a growing group
 * and never touches the earlier ones; that's what makes "pips materializing
 * as trials land" (the one animated moment DESIGN.md asks for) fall out of
 * the framework's own diffing instead of hand-rolled transition tracking.
 * `prefers-reduced-motion` is handled once in global.css (blanket
 * transition-duration override), so this component doesn't special-case it.
 */
import { For, Index } from 'solid-js';
import type { VerdictOutcome } from '@abl/engine';
import { landedCount, VERDICT_META, VERDICT_ORDER } from '../lib/verdict';
import styles from './PipGrid.module.css';

export interface PipGridProps {
  readonly pass: number;
  readonly fail: number;
  readonly inconclusive: number;
  readonly error: number;
  /** Trials the run config promises for this cell; the shortfall vs the landed total renders as empty "pending" pips (a live run mid-flight). Omit for a settled/aggregate cell. */
  readonly expected?: number;
  readonly size?: 'sm' | 'md';
}

const outcomeCount = (props: PipGridProps, outcome: VerdictOutcome): number => props[outcome];

export const PipGrid = (props: PipGridProps) => {
  const landed = () => landedCount(props);
  const pending = () => Math.max(0, (props.expected ?? landed()) - landed());

  return (
    <div
      class={styles.grid}
      data-size={props.size ?? 'md'}
      role="img"
      aria-label={pipGridAriaLabel(props)}
    >
      <For each={VERDICT_ORDER}>
        {(outcome) => (
          <Index each={Array.from({ length: outcomeCount(props, outcome) })}>
            {(_, i) => <VerdictPip outcome={outcome} position={i + 1} />}
          </Index>
        )}
      </For>
      <Index each={Array.from({ length: pending() })}>
        {(_, i) => <VerdictPip outcome="pending" position={i + 1} />}
      </Index>
    </div>
  );
};

const pipGridAriaLabel = (props: PipGridProps): string => {
  const total = landedCount(props);
  const parts = VERDICT_ORDER.map(
    (o) => `${outcomeCount(props, o)} ${VERDICT_META[o].label.toLowerCase()}`,
  );
  const pendingCount = Math.max(0, (props.expected ?? total) - total);
  const pendingPart = pendingCount > 0 ? `, ${pendingCount} pending` : '';
  return `${total} trials: ${parts.join(', ')}${pendingPart}`;
};

const VerdictPip = (props: { outcome: VerdictOutcome | 'pending'; position: number }) => {
  const isPending = () => props.outcome === 'pending';
  const meta = () => (props.outcome === 'pending' ? undefined : VERDICT_META[props.outcome]);
  return (
    <span
      class={styles.pip}
      data-verdict={props.outcome}
      title={
        isPending()
          ? `Trial ${props.position}: pending`
          : `Trial ${props.position}: ${meta()!.label}`
      }
    >
      {isPending() ? '' : meta()!.glyph}
    </span>
  );
};
