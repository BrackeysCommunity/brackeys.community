# Layering & Elevation

Guidelines for creating visual hierarchy through layering, shadows, and elevation in our interface design.

## Overview

Layering refers to how we stack UI elements on top of one another. Think of buttons, panels, and overlays as layers existing in a three-dimensional world with a depth axis orthogonal to the display's two real axes.

**Elevation** is a UI element's position on the depth axis. Higher elevation = further from the ground plane and closer to the user. Modals and overlays float above all other content and have the highest elevation values. Elevation is analogous to `z-index` in CSS.

Layering and elevation serve to:

- Establish and reinforce the information hierarchy (primarily through the principle of common region)
- Direct the user's focus (a change in elevation makes an element stand out visually)

## Signifiers

Beyond stacking order (`z-index`), elevation is expressed visually in three ways:

### Background Color

Background colors conform to the element's elevation value. Use the design tokens (`--background`, `--card`, `--popover`, `--emboss-surface`, `--deboss-surface`, etc.) for this.

- **Higher elevation = lighter background** in both light and dark mode
- The metaphor: a light source in front of the display illuminates closer elements more than distant ones
- In dark mode, `--card` (oklch 0.21) is lighter than `--background` (oklch 0.141), and `--popover` follows the same pattern

### Borders

Borders establish and accentuate depth. We use **"chonk" borders** — thicker at the bottom for embossed/raised elements, thicker at the top for debossed/inset elements. This simulates isometric perspective: a raised button viewed from slightly below shows a thicker bottom edge.

Our implementation:
- **`chonk-emboss`**: Raised elements (buttons, toggles). Uses `--emboss-surface` and `--emboss-shadow` tokens. A `box-shadow` at the bottom creates the thick border illusion, with `translateY` lifting the element.
- **`chonk-deboss`**: Inset elements (inputs, textareas). Uses `--deboss-surface` and `--deboss-shadow` tokens. Depth is expressed via an **inset box-shadow** (`inset 0 2px 0 0 var(--deboss-shadow)`) plus a matching `border-color`.
- **`chonk-emboss-notched`**: Raised elements with notched/clipped corners, using `drop-shadow` filter instead of `box-shadow`.

Key detail: **our corners are sharp** (default `--radius: 8px`, often `rounded-xs` or smaller). We do not use large rounded corners. Notched elements use clip-paths for angular, geometric corner cuts.

### Shadows

Shadows apply only to **floating elements** (overlays, modals, tooltips, toasts) that hover above the main content. These elements cast a shadow extending the light-source metaphor. Floating elements do **not** need chonk borders.

## Element Model

UI elements are categorized into nested sets based on how they respond to elevation:

### Layers

All elements that can be stacked to compose a view: buttons, text fields, segmented controls, overlays, and elements with zero surface area (text, icons, dividers). The zero-surface-area group should **never** have background fills, chonk borders, or shadows.

### Sheets

Layers with background fills — darker than surroundings for lower elevation, lighter for higher elevation. Like tinted sheets of paper with negligible thickness. Useful for grouping elements into clearly demarcated information areas (e.g., a card grouping form fields).

In our system: `bg-card`, `bg-muted`, `bg-secondary` are sheet-level backgrounds.

### Slabs and Wells

Sheets with an **expressed thickness dimension**:

- **Slabs** (embossed): Increased bottom border via `chonk-emboss`. The thicker the border, the more the element appears to protrude. Larger buttons are thicker and have more pronounced chonk. Use `--chonk-lift` and `--chonk-lift-hover` custom properties to control lift amount.
- **Wells** (debossed): Inset top shadow via `chonk-deboss` (`inset 0 2px 0 0 var(--deboss-shadow)`). The element appears recessed. Used for inputs, textareas, and other receptacle elements.

Use slabs and wells for **interactive elements** to help them stand out.

#### Our Chonk System

```
.chonk-emboss {
  --chonk-lift: 2px;          /* resting lift */
  --chonk-lift-hover: 3px;    /* hover lift */
  --chonk-y: var(--chonk-lift);
  box-shadow: ... 0 var(--chonk-y) 0 0 var(--emboss-shadow);
  transform: translateY(calc(-1 * var(--chonk-y)));
}
/* :hover  → --chonk-y: var(--chonk-lift-hover)  (rises) */
/* :active → --chonk-y: 0px                      (presses flat) */
```

The `@property --chonk-y` registration enables smooth CSS transitions on the custom property.

### Floating Elements

Sheets that hover above the main content and cast shadows. Includes tooltips, overlays, modals, and toasts. They use `box-shadow` for the drop shadow and do **not** need a thickness dimension (no chonk border).

In our system: `bg-popover` with appropriate shadow utilities.

## Quick Reference

| Category          | Background | Chonk Border | Shadow | Examples                       |
| ----------------- | ---------- | ------------ | ------ | ------------------------------ |
| Layer (no area)   | None       | None         | None   | Text, icons, dividers          |
| Sheet             | Yes        | None         | None   | Cards, panels, grouped areas   |
| Slab (embossed)   | Yes        | Bottom       | None   | Buttons, toggles, checkboxes   |
| Well (debossed)   | Yes        | Top          | None   | Inputs, textareas, select      |
| Floating          | Yes        | None         | Yes    | Modals, tooltips, popovers     |

## Design Tokens

| Token                 | Purpose                              |
| --------------------- | ------------------------------------ |
| `--background`        | Ground-level page background         |
| `--card`              | Sheet-level elevated background      |
| `--popover`           | Floating-level background            |
| `--emboss-surface`    | Slab surface color                   |
| `--emboss-shadow`     | Slab bottom-border shadow color      |
| `--deboss-surface`    | Well surface color                   |
| `--deboss-shadow`     | Well top-border shadow color         |
| `--deboss-highlight`  | Well bottom highlight (defined, currently unused) |
| `--chonk-lift`        | Resting translateY for embossed els  |
| `--chonk-lift-hover`  | Hover translateY for embossed els    |
