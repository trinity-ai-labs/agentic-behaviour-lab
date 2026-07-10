# Shipped themes — Rime and Ledger

Two themes, deliberately far apart in personality, both precision-instrument.
Each ships light + dark twins per the token architecture in `DESIGN.md`; the
tables below are the authoritative palettes (`role → oklch`, hex alongside
for tooling). All contrast figures were computed (sRGB→OKLab transform, WCAG
relative luminance), not estimated. Both themes hold foreground/background at
~15:1 (AAA) and muted/surface + on-primary/primary above 4.5:1 (AA) in both
schemes.

- **Rime** (default) — the cold, high-clarity half: near-black slate canvas /
  barely-blue paper white, "frost" blue primary, "aurora" violet accent.
  Mood-inspired by Nord (MIT, no values reused); surface-step discipline from
  Radix Colors (MIT, no values reused). Named for rime ice: thin, precise,
  crystalline.
- **Ledger** — the warm, analog half: ink on toned paper, warm charcoal dark
  mode (not blue-black), primary/accent deliberately re-hued to ink blue /
  ink violet so warm hues stay in status roles only. Structural concept from
  Flexoki by Steph Ango (MIT; credited per author preference:
  stephango.com/flexoki — no hex reused, accent family changed). Named for
  the bound book you record measurements in.

## Product rules that fall out of the research

1. **Verdict pips never use theme status tokens.** `danger`/`warning`/
   `success`/`info` are UI-chrome roles (validation, toasts); verdicts render
   exclusively with the fixed Okabe–Ito set. The two color systems never
   meet in one component.
2. **Every pip carries a 1px `border`/`foreground`-toned ring.** The fixed
   error color (`#CC79A7`) measures 2.70–3.01:1 against light backgrounds —
   below the 3:1 non-text floor. Edge contrast from the ring restores
   legibility in both schemes without touching the fixed verdict palette.
   Applied to all pips uniformly, both schemes.
3. **Accent hues stay ≥45° from every verdict hue.** Checked here (Rime
   accent moved off teal to violet for exactly this reason — teal sat 24°
   from the pass hue); any future theme must re-check.

## Rime

| Role | Dark | Light |
|---|---|---|
| background | `oklch(18.1% 0.016 261.5)` `#0E1219` | `oklch(95.7% 0.007 260.7)` `#EEF1F6` |
| surface | `oklch(21.4% 0.023 265.5)` `#141924` | `oklch(98.4% 0.004 258.3)` `#F8FAFD` |
| elevated | `oklch(25.2% 0.029 263.9)` `#1B2230` | `oklch(100% 0 0)` `#FFFFFF` |
| foreground | `oklch(93.4% 0.013 266.7)` `#E5E9F2` | `oklch(22.2% 0.019 266.1)` `#171B24` |
| muted | `oklch(67.5% 0.033 265.2)` `#8D97AC` | `oklch(50.1% 0.025 259.2)` `#5B6472` |
| primary | `oklch(70.7% 0.110 243.4)` `#5FA8E0` | `oklch(53.2% 0.122 251.2)` `#2E6FB0` |
| on-primary | `oklch(16.8% 0.016 261.5)` `#0B0F16` | `oklch(100% 0 0)` `#FFFFFF` |
| accent | `oklch(64.7% 0.154 287.3)` `#8A7CE6` | `oklch(48.6% 0.168 285.7)` `#5B49B8` |
| danger | `oklch(66.8% 0.165 19.1)` `#E8636B` | `oklch(54.7% 0.186 22.3)` `#C6303B` |
| warning | `oklch(76.9% 0.138 78.5)` `#E3A83D` | `oklch(50.8% 0.108 73.3)` `#8A5A00` |
| success | `oklch(72.3% 0.137 142.7)` `#6FBB6A` | `oklch(52.7% 0.115 150.5)` `#2E7D46` |
| info | `oklch(68.6% 0.140 271.8)` `#7C93F0` | `oklch(49.0% 0.157 268.0)` `#3B57B8` |
| border | `oklch(28.8% 0.030 262.8)` `#232B3A` | `oklch(89.9% 0.014 258.3)` `#D8DEE7` |
| input | `oklch(24.8% 0.030 264.9)` `#1A2130` | `oklch(93.2% 0.011 256.7)` `#E4E9F0` |
| ring | `oklch(74.5% 0.105 243.5)` `#6FB4EA` | `oklch(53.2% 0.122 251.2)` `#2E6FB0` |
| chart-1 | `oklch(70.7% 0.110 243.4)` `#5FA8E0` | `oklch(53.2% 0.122 251.2)` `#2E6FB0` |
| chart-2 | `oklch(76.3% 0.108 189.1)` `#4FC8C0` | `oklch(54.0% 0.089 188.8)` `#167F79` |
| chart-3 | `oklch(70.5% 0.119 298.1)` `#A98FE0` | `oklch(51.6% 0.167 291.5)` `#6C4FBE` |
| chart-4 | `oklch(76.9% 0.138 78.5)` `#E3A83D` | `oklch(50.8% 0.108 73.3)` `#8A5A00` |
| chart-5 | `oklch(69.2% 0.163 356.6)` `#E86B9E` | `oklch(53.5% 0.161 359.0)` `#B23A6B` |
| chart-6 | `oklch(72.4% 0.122 137.9)` `#7FB86B` | `oklch(53.0% 0.125 140.5)` `#3F7D33` |

Key pairs — dark: fg/bg 15.43:1, muted/surface 5.99:1, on-primary/primary
7.46:1. Light: fg/bg 15.22:1, muted/surface 5.72:1, on-primary/primary 5.23:1.
Light background is deliberately off-white (L 95.7%) to preserve pip margin.

## Ledger

| Role | Dark | Light |
|---|---|---|
| background | `oklch(21.8% 0.006 91.6)` `#1B1A17` | `oklch(97.4% 0.014 88.7)` `#FAF6EC` |
| surface | `oklch(24.0% 0.008 84.6)` `#211F1B` | `oklch(99.4% 0.008 91.5)` `#FFFDF7` |
| elevated | `oklch(27.2% 0.015 95.6)` `#29271F` | `oklch(100% 0 0)` `#FFFFFF` |
| foreground | `oklch(95.0% 0.014 88.7)` `#F2EEE4` | `oklch(24.4% 0.010 88.8)` `#22201B` |
| muted | `oklch(69.9% 0.024 92.6)` `#A39E8E` | `oklch(51.0% 0.025 92.7)` `#6B6656` |
| primary | `oklch(62.1% 0.104 256.4)` `#5C88C4` | `oklch(46.7% 0.089 249.8)` `#2F5D8A` |
| on-primary | `oklch(18.2% 0.009 264.3)` `#101216` | `oklch(100% 0 0)` `#FFFFFF` |
| accent | `oklch(65.0% 0.109 300.7)` `#9A7FC7` | `oklch(49.0% 0.123 298.3)` `#6A4E9C` |
| danger | `oklch(59.5% 0.184 14.3)` `#D5415C` | `oklch(48.1% 0.170 14.4)` `#A8203F` |
| warning | `oklch(71.2% 0.131 83.7)` `#C99A2E` | `oklch(52.9% 0.102 80.4)` `#8A6414` |
| success | `oklch(64.4% 0.114 127.3)` `#7A9A4A` | `oklch(48.9% 0.098 131.0)` `#4C6B2C` |
| info | `oklch(62.3% 0.072 211.2)` `#4E93A0` | `oklch(50.0% 0.068 207.4)` `#2B6E77` |
| border | `oklch(33.4% 0.018 88.8)` `#3A362C` | `oklch(89.5% 0.028 88.8)` `#E4DCC8` |
| input | `oklch(25.6% 0.018 93.4)` `#262319` | `oklch(93.5% 0.024 88.2)` `#F0E9D8` |
| ring | `oklch(71.6% 0.095 255.3)` `#7BA6DE` | `oklch(46.7% 0.089 249.8)` `#2F5D8A` |
| chart-1 | `oklch(62.1% 0.104 256.4)` `#5C88C4` | `oklch(46.7% 0.089 249.8)` `#2F5D8A` |
| chart-2 | `oklch(65.0% 0.109 300.7)` `#9A7FC7` | `oklch(49.0% 0.123 298.3)` `#6A4E9C` |
| chart-3 | `oklch(71.2% 0.131 83.7)` `#C99A2E` | `oklch(52.9% 0.102 80.4)` `#8A6414` |
| chart-4 | `oklch(64.4% 0.114 127.3)` `#7A9A4A` | `oklch(48.9% 0.098 131.0)` `#4C6B2C` |
| chart-5 | `oklch(61.5% 0.166 27.4)` `#D6544A` | `oklch(50.5% 0.146 28.9)` `#A83B30` |
| chart-6 | `oklch(62.3% 0.072 211.2)` `#4E93A0` | `oklch(50.0% 0.068 207.4)` `#2B6E77` |

Key pairs — dark: fg/bg 15.02:1, muted/surface 6.14:1, on-primary/primary
5.15:1. Light: fg/bg 15.08:1, muted/surface 5.64:1, on-primary/primary 6.88:1.
