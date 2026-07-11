# Canonical `Select` component — design spec

**Date:** 2026-07-11
**Package:** `@abl/web`
**Goal:** Replace every native `<select>` in the dashboard with one house-styled,
fully-accessible `Select` component driven by the semantic token system.

## Motivation

The dashboard renders four native `<select>` elements. The OS-native popup
breaks the visual language of the rest of the app (tokenised surfaces, both
themes × light/dark) — jarring enough to be worth a canonical replacement.
A single reusable component removes all four and gives every future picker a
consistent, on-brand control.

## Sites to migrate (all four)

| File | Line | Picker | Options source |
|------|------|--------|----------------|
| `src/views/Benchmarks.tsx` | ~46 | scenario | `scenarios()` → `{value: scenarioId, label: title}` |
| `src/components/RunLauncher.tsx` | ~85 | scenario | `props.scenarios` |
| `src/components/RunLauncher.tsx` | ~121 | shape | `s().declaredShapes` |
| `src/components/ThemeToggle.tsx` | ~10 | theme | `rime` / `ledger` (sr-only label) |

## Component API

`src/components/Select.tsx` — controlled, generic over the value string type.

```ts
export type SelectOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

export type SelectProps<T extends string> = {
  value: T                       // "" means nothing chosen → placeholder shown
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string           // trigger text when value is ""
  label?: string                 // visible label text (optional)
  "aria-label"?: string          // for label-less / sr-only cases (ThemeToggle)
  disabled?: boolean
  class?: string                 // optional extra class on the wrapper
}
```

Same component at every site — scenario ids, `ExecutionShape`, and `ThemeId`
all satisfy `T extends string`.

## Behaviour — full native-select parity

- **Structure:** trigger `<button aria-haspopup="listbox" aria-expanded>`;
  popup `role="listbox"`; items `role="option" aria-selected`. Focus stays on
  the trigger via `aria-activedescendant` (roving active-descendant model).
- **Keyboard:**
  - Closed: `ArrowDown` / `ArrowUp` / `Enter` / `Space` opens (active = current
    value, else first enabled).
  - Open: `ArrowDown`/`ArrowUp` move active option (skipping `disabled`),
    `Home`/`End` jump to first/last enabled, `Enter`/`Space` selects active and
    closes, `Esc` closes without selecting.
  - **Typeahead:** printable keys accumulate a short-lived buffer and jump to
    the first enabled option whose label starts with it (matches native).
- **Pointer:** click trigger toggles; click option selects; click outside
  closes. Disabled options are inert to both pointer and keyboard.
- **Focus return:** closing (Esc, select, click-outside) returns focus to the
  trigger.

## Positioning

Absolute popup directly under the trigger, `max-height` with internal
`overflow-y: auto` for long lists (scenario list can grow). No floating-ui /
collision library — deliberately out of scope; add flip-on-clip only if a real
clipping case appears.

## Styling

`src/components/Select.module.css`, **semantic tokens only** (passes
`check-token-purity.mjs`; no hex / `oklch` / `--prim-`):

- Trigger: `--input` bg, `--foreground` text, `1px solid --border`,
  `--radius-md`, `--space-2 --space-3` padding, `--text-sm` — i.e. the exact
  look the current per-module `.select` rules already have.
- Popup: `--elevated` (or `--surface`) bg, `1px solid --border`, `--radius-md`,
  subtle elevation via border only (no raw shadow colour).
- Focus ring: `--ring`. Active/hovered option: `--accent` bg; selected marker
  uses `--primary` / `--on-primary`.
- Works unchanged across both themes × light/dark (passes
  `check-theme-matrix.mjs` — the component adds no new semantic roles).

The now-unused `.select` rules in `Benchmarks.module.css`,
`RunLauncher.module.css`, and `ThemeToggle.module.css` are removed.

## Testing

`src/components/Select.test.tsx` (vitest + jsdom + `@solidjs/testing-library`):

- opens on trigger click and on `ArrowDown`/`Enter` when focused;
- selects on option click and on `Enter` over an active option;
- `ArrowDown`/`ArrowUp` skip disabled options; `Home`/`End` jump;
- `Esc` closes without selecting and returns focus to the trigger;
- typeahead jumps to the matching option;
- controlled `value` renders the right label / `aria-selected` option;
- ARIA wiring present (`aria-haspopup`, `aria-expanded`, `role="listbox"`,
  `role="option"`, `aria-activedescendant`).

## Scope boundaries (YAGNI)

- **Single-select only** — every site is single. No multi-select.
- **No search/filter input** (not a combobox); typeahead-to-jump only.
- **No optgroup / grouping** — all lists are flat.
- **No async/loading state inside** — consumers keep gating with `<Show>`.

## Verification

Scoped: `pnpm --filter @abl/web check` (tsc + token-purity + theme-matrix) and
`pnpm --filter @abl/web test`. Full `pnpm gate` runs via the merge queue.
Manual: drive the app (`seed-dev` dataset already live) and confirm each of the
four pickers opens, keyboards, and selects correctly in both themes.
