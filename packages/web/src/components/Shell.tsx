/**
 * App chrome (nav, theme toggle) — mounted inside src/app.tsx's Router
 * `root`, so it wraps every route and survives navigation without
 * remounting. Takes plain children rather than the router's
 * `RouteSectionProps` because it's one layer removed from the router (the
 * provider stack sits between them); the router's `root` component is what
 * actually receives the matched route tree.
 */
import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { ThemeToggle } from './ThemeToggle';
import styles from './Shell.module.css';

export const Shell = (props: { children?: JSX.Element }) => (
  <div class={styles.shell}>
    <header class={styles.header}>
      <div class={styles.brand}>
        <span class={styles.brandMark}>abl</span>
        <span>Agentic Behaviour Lab</span>
      </div>
      <nav class={styles.nav}>
        <A href="/" end class={styles.navLink} activeClass={styles.navLinkActive}>
          Benchmarks
        </A>
        <A href="/runs" class={styles.navLink} activeClass={styles.navLinkActive}>
          Runs
        </A>
        <A href="/scenarios" class={styles.navLink} activeClass={styles.navLinkActive}>
          Scenarios
        </A>
      </nav>
      <div class={styles.controls}>
        <ThemeToggle />
      </div>
    </header>
    <main class={styles.main}>{props.children}</main>
  </div>
);
