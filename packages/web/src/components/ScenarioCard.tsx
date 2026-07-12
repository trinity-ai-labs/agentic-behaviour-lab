import type { ScenarioDefinition } from '../api/client';
import styles from './ScenarioCard.module.css';

export const ScenarioCard = (props: {
  scenario: ScenarioDefinition;
  onRun?: () => void;
}) => (
  <article class={styles.card}>
    <span class={styles.family}>{props.scenario.family}</span>
    <h3 class={styles.title}>{props.scenario.title}</h3>
    <p class={styles.description}>{props.scenario.description}</p>
    <div class={styles.meta}>
      <span>{props.scenario.conditions.length} condition(s)</span>
      <span>shapes: {props.scenario.declaredShapes.join(', ')}</span>
      <span>v{props.scenario.version}</span>
    </div>
    {props.onRun && (
      <button type="button" class={styles.runBtn} onClick={props.onRun}>
        Run
      </button>
    )}
  </article>
);
