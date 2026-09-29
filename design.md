# Design System — extracted from beta.hexly.co.nz

> Reverse-engineered directly from the site's shipped CSS custom properties and rules (not a visual
> guess). Source: `:root` token block, `html.dark` overrides, font-family declarations, and
> component rules found in the page bundle.

## Brand shape motif

The wordmark is "Hexly" and the whole design system is built around a **hexagon**, used as a
literal CSS clip-path everywhere a badge/icon/avatar container is needed:

```css
--hx: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
```

## Color tokens

### Light mode (default)
```css
--bone:   #F4F3EF   /* page background — warm off-white/cream, not pure white */
--cell:   #FFFFFF   /* card/surface background */
--ink:    #1A1917   /* primary text — near-black, warm not cool */
--violet: #5B4EDB   /* primary brand/accent color — buttons, links, focus */
--honey:  #E8A13A   /* secondary accent — warm gold/amber, used sparingly */
--soft:   rgba(26,25,23,.64)   /* secondary text */
--dim:    rgba(26,25,23,.40)   /* muted/placeholder text */
--line:   rgba(26,25,23,.13)   /* hairline borders */
--line2:  rgba(26,25,23,.30)   /* slightly stronger borders/dividers */
```

### Dark mode (`html.dark`)
```css
--vwash: #1E1B2E
--bone:  #171614
--cell:  #211F1C
--ink:   #F0EEE8
--soft:  rgba(240,238,232,.66)
--dim:   rgba(240,238,232,.42)
--line:  rgba(240,238,232,.13)
--line2: rgba(240,238,232,.32)
```

### Categorical tag colors
Used for labeling content types/categories — six-color rotation, each a distinct hue family:
```css
--m-strategic:  #3BA985   /* teal-green */
--m-conceptual: #7A6AE8   /* purple */
--m-critical:   #E39B3F   /* orange */
--m-dialogic:   #4FAACB   /* sky blue */
--m-reflective: #D56F56   /* terracotta */
--m-design:     #94B855   /* olive-green */
```

## Typography

- **Headings:** `'Schibsted Grotesk'` — a bold geometric grotesk, used with heavy weights (700/800)
  and **tight negative letter-spacing** (`-0.045em` to `-0.01em`, tighter on larger sizes).
- **Body:** `'Sora'` — clean, modern, geometric-humanist sans. Weights 400–600 for body copy.
- **Monospace/labels:** `"Space Mono"` — used for small tag/eyebrow/code-like text, often paired
  with small positive letter-spacing (`+0.02em`) for a "label" feel.
- Both Schibsted Grotesk and Sora are available on Google Fonts.

Font-weight usage observed: 300, 400, 500, 600, 700, 800 — body text stays light-to-medium (400–500),
headings and emphasis go bold-to-black (700–800). This contrast (light body / very bold display) is
a deliberate part of the visual voice.

## Shape language

- **Pills:** `border-radius: 999px` — used extensively for buttons, tags, and badges. This is the
  dominant radius convention in the system.
- **Cards:** `border-radius: 18px` — the standard surface/card corner radius.
- Smaller utility radii (4px, 6px, 8px, 14px, 20px) appear for tighter inline elements (small
  buttons, chips, inputs).

## Shadows

Shadows are **tinted with the ink color**, not pure black — this reads as "soft" rather than harsh:
```css
/* card resting state */
box-shadow: 0 2px 14px rgba(26,25,23,.06);

/* elevated/hover state */
box-shadow: 0 12px 34px rgba(26,25,23,.18);

/* modal/overlay backdrop-adjacent elements */
box-shadow: 0 20px 55px rgba(0,0,0,.5);
box-shadow: 0 30px 80px rgba(0,0,0,.6);
```

**Focus ring** (accessible, on-brand — double ring using the violet accent):
```css
box-shadow: 0 0 0 2px var(--violet), 0 0 0 8px rgba(122,106,232,.13);
```

## Spacing

Responsive fluid padding via `clamp()`, not fixed breakpoints:
```css
--pad: clamp(20px, 4.5vw, 64px);
```

## Component conventions observed

- **Ghost button:** `background: var(--bone)` — a button that blends into the page background
  rather than standing out, used for secondary actions.
- Cards use `--cell` background, `--line` hairline border, 18px radius, and the resting-state
  shadow above.
- Category/tag chips: pill-shaped (999px radius), colored via the `--m-*` categorical tokens,
  small `Space Mono` label text.

## Applying this to SpeakBack

- Swap the current generic purple (`#7c3aed`) theme for the real Hexly palette: `--bone` page
  background, `--cell` cards, `--ink` text, `--violet` (#5B4EDB) as the primary action color,
  `--honey` (#E8A13A) reserved for sparing secondary accents (e.g. a highlighted score or badge).
  This immediately shifts the overall register from "generic SaaS purple" to Hexly's warm,
  ink-on-cream aesthetic.
- Load `Schibsted Grotesk` (headings) + `Sora` (body) from Google Fonts, replacing the system-font
  stack. Apply tight negative letter-spacing to the SpeakBack title and section headers.
- Buttons become full pills (`999px` radius) instead of the current `9px`; cards move to `18px`
  radius instead of `14px`.
- Shadows shift to ink-tinted soft shadows instead of generic black-alpha shadows.
- The SpeakBack emoji logo (🗣️) is replaced with a small hexagon clip-path mark (using `--hx`),
  styled with a subtle gradient echoing the site's own loading-state hex mark (teal → violet → sky
  blue), reinforcing a literal brand/shape connection without copying Hexly's own logo content.
- Admin dashboard's class "pill" badges adopt the categorical `--m-*` color rotation instead of one
  flat purple pill, so different classes are visually distinct at a glance.
- Dark mode support added via `prefers-color-scheme`, using the extracted dark-mode token set.
