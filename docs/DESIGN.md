# Design — identity and theming architecture

Binding for `@abl/web` (and any future surface). Two halves: the _direction_
(what the product looks and feels like) and the _token architecture_ (how
themes are built so that multiple themes × dark/light stays clean forever).

## Direction: the instrument, not the admin panel

This is a measurement instrument for agent behaviour — the design language is
precision-lab, not SaaS dashboard. Calm surfaces, disciplined type, and data
rendered with scientific honesty. The interface recedes; evidence is loud.

**Type.** IBM Plex family — a genuinely instrument-heritage triad that pairs
by design: **Plex Sans** for UI and prose, **Plex Mono** for everything that
is data (trial ids, model ids, verdicts, state logs, transcripts, table
numerics — this product is mono-heavy and that's part of its character).
Display type is Plex Sans at heavy weight with tight tracking — no third
novelty face; the identity risk is spent elsewhere (below).

**The signature: the pip grid.** Rates are never abstract bars or lone
percentages — a benchmark cell renders its N as **discrete trial pips**, one
per trial, colored by verdict. Ten trials = ten visible pips. The
statistical-honesty rule ("a claim without its N is folklore") becomes the
visual identity: you _see_ the evidence count, small N looks appropriately
thin, and a live run is pips materializing one by one. This is the one
memorable element; everything around it stays quiet.

**Verdict semantics** (fixed hues across ALL themes, derived from the
colorblind-safe Okabe–Ito palette; themes may tune lightness/chroma to sit on
their surfaces, never the hue meaning):

- `pass` — bluish green (Okabe–Ito #009E73 family)
- `fail` — vermilion (#D55E00 family)
- `inconclusive` — neutral grey, deliberately unexciting
- `error` — reddish purple (#CC79A7 family): infrastructure broke, not the agent

Verdicts are never color-only: each pairs with a glyph (✓ ✕ ◦ ‼) and a label.
Chart categorical colors (model series, etc.) also draw from Okabe–Ito.

**Shipped themes.** Two, per `THEMES.md` (the authoritative palettes):
**Rime** (default; cold slate + frost blue + aurora violet) and **Ledger**
(warm paper-and-ink; ink blue + ink violet). Verdict pips always carry a 1px
`border`-toned ring (edge-contrast insurance where fill contrast dips on
light surfaces), and never use the theme's danger/warning/success/info roles.

**Scheme default.** Dark is the default (transcript- and log-reading product;
`prefers-color-scheme` respected, manual override persisted). Light is an
equal citizen — every token defined for both from day one, enforced (below).

**Motion.** One orchestrated moment: pips appearing as trials land during a
live run. Everything else near-static; `prefers-reduced-motion` respected.

**Copy.** Plain verbs, sentence case, user-side vocabulary ("Run 10 trials",
"Compare models"), errors say what happened and what to do. "Inconclusive" is
presented as a legitimate result, never styled as a failure.

## Token architecture — the three layers and the two axes

A lesson from a prior production codebase, encoded as structure: theme and scheme are **independent
axes**, and tokens come in **three strict layers**. What went wrong before —
flat `theme-dark`/`theme-light` class enumerations, `:root` doubling as the
default theme, semantic names holding raw values with no primitive layer —
is prevented here by construction and by lint.

**Axes.** `<html data-theme="…" data-scheme="dark|light">` — two attributes,
never a combined class. Adding a theme touches one file; adding a scheme
variant of a token touches each theme file's two blocks; components never
know either axis exists. `color-scheme:` is set alongside `data-scheme` so
native controls follow.

**Layer 1 — primitives** (`tokens.primitives.css`): raw, theme-agnostic
material. Numbered oklch ramps (`--neutral-0…12`, `--teal-…`, `--verm-…`),
spacing scale, radii, type scale, font stacks. Components and themes share
them; components never reference them directly.

**Layer 2 — semantic** (one file per theme, e.g. `themes/meridian.css`): the
ONLY names components may use. The vocabulary adopts the researched canonical
role set from researched design-token extraction across real codebases (portable across
shadcn/Material/Tailwind conventions; its backbone is the surface +
on-surface contrast pairing):

- _Surfaces:_ `background`, `surface`, `elevated`
- _Content:_ `foreground`, `muted`
- _Brand:_ `primary`, `on-primary`, `accent`
- _Feedback:_ `danger`, `warning`, `success`, `info`
- _Chrome:_ `border`, `input`, `ring`
- _Lab extensions (open vocabulary):_ `verdict-pass`, `verdict-fail`,
  `verdict-inconclusive`, `verdict-error`, `chart-1…6`

Each theme file contains exactly two blocks —
`[data-theme="x"][data-scheme="light"] { … }` and the dark twin — each
mapping every role to primitives, values in **oklch**. `:root` defines **no
colors**: the default theme is just a theme.

Deliberate portability: a theme's two blocks are exactly a
`{ light: role→oklch, dark: role→oklch }` palette map (extra roles allowed;
typography = `display`/`body`/`mono`) — a shape design-token tooling can
produce and consume, so palettes extracted from real products can be dropped
in as lab themes. When
authoring a scheme twin, use the researched synthesis heuristics: brand hues
keep their hue and mirror lightness tone 40 ↔ 80 (chroma eased at high L to
stay in gamut); near-neutrals invert lightness (`L' ≈ 1 − L`); tokens
identical across modes stay identical.

**Layer 3 — components**: consume semantic tokens only.

**Enforcement — checks, not discipline** (both wired into `pnpm check`):

1. _No raw color, no primitives in components:_ a script fails the check if
   any file in `packages/web/src` outside `tokens/` contains a hex/oklch
   literal or a Layer-1 token name.
2. _Matrix completeness:_ a script parses the semantic contract (the token
   list) and every theme file, and fails if any theme × scheme block is
   missing any token. Adding a half-defined theme is a build error, not a
   surprise in production.

**Quality floor** (unannounced, always): responsive to mobile, visible
`:focus-visible` on everything interactive, WCAG AA contrast in both schemes
(verdict colors validated on both surface sets), reduced motion respected.
