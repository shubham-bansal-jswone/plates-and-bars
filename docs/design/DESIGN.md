# Plate & Bar design system

The visual language for the Plate & Bar app and website. The system is our own: the names, colours and rules here were written for Plate & Bar and do not copy any other product's assets.

This file replaces issue #179 as the source of truth for tokens. Change a token here first, in a `docs` PR, then in code.

## 1. Overview and principles

- **Editorial.** Pages read like a well-set magazine: big, light headlines, generous white (or black) space, short lines of body text. Content leads; chrome stays quiet.
- **Flat.** Surfaces are separated by colour and space, not shadows. Nothing has a shadow at rest. Borders are 1px hairlines, used only where a shape would otherwise be lost.
- **One blue accent.** "Plate blue" is the only accent. It marks the primary action, the active state and links. Everything else is black, white and greys, plus a small set of data and status colours.
- **Light display type.** Headlines are set in Roboto at weight 300. Weight and contrast come from size, not boldness. Body and UI text use Inter.
- **Pills and soft corners.** Every button, chip and badge is a full pill. Cards and tiles use an 8px radius.
- **No gradients on chrome.** Fills are solid. Photography and illustrations may carry their own tones; buttons, bars, bands and backgrounds never do.

## 2. Colour tokens

Token names are ours. Every value below was checked with the contrast script described in section 11; the ratios are in the table there.

### 2.1 Accent: Plate blue

| Token | Value | Role |
|---|---|---|
| `brand` | `#2457E6` | Primary button fill, active chip fill, active tab icon and label (light), progress fill for protein (light), focus ring (light) |
| `brand-pressed` | `#1D48C2` | Primary button while pressed or hovered |
| `brand-active` | `#16389A` | Primary button while selected or toggled on |
| `link-light` | `#1D48C2` | Link and blue text on light surfaces |
| `link-dark` | `#8AB0FF` | Link, blue text, blue icons and the focus ring on dark surfaces |

On the dark canvas, filled buttons keep `brand` with white text. Any blue used as text or an icon on dark uses `link-dark`, never `brand` (`brand` on black is 3.58:1, enough for a button shape, not for text).

### 2.2 Light mode

| Token | Value | Role |
|---|---|---|
| `canvas` | `#FFFFFF` | Page and screen background |
| `surface` | `#F5F7FA` | Cards, tiles, website light bands, footer |
| `surface-soft` | `#F3F3F3` | Default chip fill, disabled button fill |
| `ink` | `#000000` | Headlines, primary text, toast fill |
| `body` | `#5C5F66` | Body copy and secondary text |
| `muted` | `#6B6B6B` | Captions, hints, inactive tab labels, timestamps |
| `disabled` | `#CCCCCC` | Disabled text; secondary button border |
| `line` | `#E6E8EC` | Hairline dividers |
| `track` | `#E6E8EC` | Unfilled part of progress bars and meters |
| `outline` | `#8B8F9B` | Input border at rest |
| `tint` | `#EAF0FE` | Selected row, info callout background |

### 2.3 Dark mode

| Token | Value | Role |
|---|---|---|
| `canvas` | `#000000` | Page and screen background |
| `surface-elevated` | `#121314` | Tab bar, sheets, dialogs |
| `surface` | `#181818` | Cards, tiles |
| `surface-soft` | `#1F1F1F` | Default chip fill, disabled button fill |
| `ink` | `#FFFFFF` | Headlines, primary text, toast fill |
| `body` | `#B3B3B3` | Body copy (solid form of white at 70%; use the solid value so ratios hold on every surface) |
| `muted` | `#A3A3A3` | Captions, hints, inactive tab labels |
| `disabled` | `#5C5C5C` | Disabled text |
| `line` | `#2A2B2D` | Hairline dividers; secondary button border |
| `track` | `#2A2B2D` | Unfilled part of progress bars and meters |
| `outline` | `#63656A` | Input border at rest |
| `tint` | `#0F1A33` | Selected row, info callout background |

## 3. Semantic and data colours

| Token | Light | Dark | Role |
|---|---|---|---|
| `danger` | `#C81B3A` | `#FF6B81` | Errors, destructive actions (as text or icon, not as a fill) |
| `caution` | `#C2410C` | `#FB923C` | Over target, low coverage, stale data |
| `macro-protein` | `#2457E6` | `#6F95FF` | Protein bars, rings, legend dots |
| `macro-carbs` | `#0E8F8E` | `#2DD4BF` | Carbs bars, rings, legend dots |
| `macro-fat` | `#C86D06` | `#F5B53D` | Fat bars, rings, legend dots |

Rules:

- Text meets 4.5:1 on its surface. Bars, tracks, icons and other non-text marks meet 3:1 against what sits next to them.
- Macro colours are **data marks only** (bars, ring segments, dots, small icons). Macro numbers and labels are written in `ink` or `body`, with the colour in a dot or bar beside them. Light-mode carbs and fat do not reach 4.5:1 as text and must not be used for it.
- Colour never carries meaning alone: a status also has a word or an icon ("Over by 120 kcal", a warning glyph), and macros are always labelled.
- Protein shares the brand blue in light mode on purpose; it is the macro the app pushes hardest.

## 4. Typography

### 4.1 Fonts

| Use | Family | Weights | Licence |
|---|---|---|---|
| Display (headlines, big numbers) | Roboto | 300 | SIL Open Font License 1.1 for the current release we bundle (releases before 2023 were Apache-2.0; both allow bundling and self-hosting) |
| Body and UI | Inter | 400, 500, 600, 700 | SIL Open Font License 1.1 |

Fallback stack for both: `system-ui, -apple-system, "Segoe UI", Arial, sans-serif`.

Both fonts are **bundled with the app and self-hosted on the website**. Neither product requests fonts from a third-party server, so fonts add nothing to the privacy policy. Ship only the weights listed above. Keep the licence file of each font next to the font files.

### 4.2 App scale (mobile)

Size / weight / line height, in px (points on native). Tracking in px.

| Style | Font | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|---|
| `display` | Roboto | 34 | 300 | 1.2 | -0.1 | Screen hero, today's big number |
| `title` | Roboto | 28 | 300 | 1.25 | 0 | Screen titles |
| `heading` | Roboto | 22 | 300 | 1.25 | 0 | Section headings, card titles |
| `label` | Inter | 18 | 600 | 1.2 | 0 | Form and group labels |
| `body` | Inter | 16 | 400 | 1.5 | 0 | Body copy |
| `body-strong` | Inter | 16 | 500 | 1.5 | 0 | Emphasis in body copy, list item titles |
| `caption` | Inter | 14 | 400 | 1.5 | 0 | Supporting text, hints |
| `small` | Inter | 12 | 500 | 1.5 | 0 | Metadata, badges, tab labels |
| `button` | Inter | 16 | 700 | 1.25 | +0.4 | Buttons |
| `button-sm` | Inter | 14 | 700 | 1.25 | +0.3 | Small buttons, chips |

### 4.3 Website scale

| Style | Font | Size | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| `display-xl` | Roboto | 54 | 300 | 1.15 | +0.1 |
| `display-l` | Roboto | 44 | 300 | 1.2 | +0.1 |
| `display-m` | Roboto | 35 | 300 | 1.2 | +0.1 |
| `display-s` | Roboto | 28 | 300 | 1.25 | +0.1 |
| `display-xs` | Roboto | 22 | 300 | 1.3 | +0.1 |
| `body` | Inter | 18 | 400 | 1.5 | 0 |

Buttons, captions and small text on the website use the app styles. The hero headline steps down the breakpoints as shown in section 9.

### 4.4 Type rules

- Weight 300 is for 22px and up. Below 22px use Inter; thin strokes at small sizes fail in practice even when the colour ratio passes.
- Display text is set in `ink`, white on `brand`, or `ink` on `tint`. Never set display text in `body`, `muted` or a data colour.
- Keep body lines between 45 and 75 characters on the website.
- Sentence case everywhere, including buttons.

## 5. Spacing

Scale: `4 / 8 / 12 / 16 / 24 / 32 / 48` (tokens `space-1` to `space-7`).

- Screen side padding in the app: 16. Gap between cards: 12. Padding inside a card: 16.
- Website section rhythm (vertical padding of each band): 96 desktop, 64 tablet, 48 mobile.
- Do not invent in-between values; pick the nearest step.

## 6. Radii

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4 | Inputs, text areas, selects |
| `radius-md` | 8 | Cards, tiles, images inside cards, toasts |
| `radius-lg` | 16 | Bottom sheets (top corners), dialogs |
| `radius-full` | 9999 | Every button, chip and badge |

There are no medium-radius buttons. A button is a pill or it is a text link.

## 7. Elevation

- **At rest:** none. Cards sit on the canvas by colour (`surface`) alone.
- **Pressed or dragged:** `0 4px 12px rgba(0,0,0,0.16)`, removed on release.
- **Sheets and dialogs:** no shadow; they sit on a scrim of `rgba(0,0,0,0.5)` (both modes) and use `surface-elevated` in dark mode, `canvas` in light mode.
- **Borders:** 1px hairlines in `line`, only where two same-colour areas meet (list dividers, a card on a `surface` band).

## 8. Components

### 8.1 Buttons

All buttons are pills (`radius-full`), minimum height 48, horizontal padding 24, `button` text style. Small buttons: height 36 with a 44×44 hit area, `button-sm`, padding 16.

| Variant | Light | Dark |
|---|---|---|
| Primary | `brand` fill, white text; pressed `brand-pressed`; selected `brand-active` | Same as light |
| Secondary | Transparent, 1px `disabled` border, `ink` text | Transparent, 1px `line` border, `ink` text |
| Disabled | `surface-soft` fill, `disabled` text, no border | `surface-soft` fill, `disabled` text, no border |
| Text | No fill, `link-light` text | No fill, `link-dark` text |

- One primary button per screen or band. Everything else is secondary or text.
- The secondary button's border is decorative: the label (21:1) identifies the control. Do not use a secondary button without a visible label.
- Destructive actions use a secondary button with `danger` text, and a confirm step.
- Focus: 2px ring, 2px offset, `brand` on light and `link-dark` on dark.

### 8.2 Chips

- Pill, height 32 (44×44 hit area), padding 12, `button-sm` text (14/700, +0.3).
- Default: `surface-soft` fill, `ink` text.
- Active: `brand` fill, white text, in both modes. This is the single accent; do not colour chips by macro or category.
- Disabled: `surface-soft` fill, `disabled` text.

### 8.3 Inputs

- Height 48, `radius-sm`, padding 12 horizontal, `body` text style, `canvas` fill (light) or `surface` fill (dark).
- Border 1px `outline` at rest; focus 2px `brand` (light) or `link-dark` (dark), with the padding reduced by 1 so text does not move.
- Label above the field in `label` style; hint below in `caption`, `muted`. Placeholder text is `muted`, never the only label.
- Error: border 2px `danger`, message below in `caption` `danger` with an icon.

### 8.4 Cards and tiles

- `surface` fill, `radius-md`, padding 16, no border, no shadow.
- Card title `heading`; content `body` / `caption`.
- A whole tappable card shows the pressed shadow and a `brand-pressed` title on press. A card never contains more than one primary button.

### 8.5 Progress bars and meters

- Bar height 8, `radius-full`, `track` behind the fill.
- Fill colour is the macro colour for macro bars, `brand` for other goals, `caution` once a value passes its target.
- Ring meters: stroke 8, same colours, `track` for the unfilled arc.
- Always print the numbers next to the bar (`ink` value, `muted` target); the bar is a picture of the number, not a replacement for it.

### 8.6 Toasts

- Toasts invert the canvas: `ink` fill with `canvas` text (black toast on light, white toast on dark). Text in `body` style.
- One optional action as a text button: `link-dark` on the black toast, `link-light` on the white toast.
- `radius-md`, padding 12 × 16, pressed-level shadow (the one place a resting shadow is allowed, because the toast floats over content), bottom of the screen above the tab bar. 4 seconds, longer (8) when there is an undo action.

### 8.7 Tab bar (app)

- `canvas` fill (light) or `surface-elevated` (dark), 1px `line` top border, height 56 plus the safe area.
- Each tab: 24px icon over a `small` label, whole cell is the hit target.
- Active: `brand` icon and label (light), `link-dark` (dark). Inactive: `muted`.
- No pill or blob behind the active tab; colour alone plus the filled icon variant marks it.

### 8.8 Website bands

The website is a stack of full-width bands. Each band is one idea with one call to action.

| Band | Fill | Headline | Body | Button |
|---|---|---|---|---|
| Light | `canvas` (light) | `ink` | `body` | Primary |
| Soft | `surface` (light) | `ink` | `body` | Primary |
| Dark | `canvas` (dark) | `ink` (dark) | `body` (dark) | Primary (`brand`), links `link-dark` |
| Blue | `brand` | White | White | Secondary with white 1px border and white text |

- Alternate light and soft or dark bands; never two dark bands in a row. Use at most one blue band per page.
- Content max width 1200, centred; text columns max 680.

### 8.9 Footer

- `surface` fill (light) or `canvas` (dark), 1px `line` top border.
- Links in `body` style, `body` colour, underline on hover and focus; legal line in `caption`, `muted`.
- Holds the privacy policy, terms and account deletion links on every page.

## 9. Responsive behaviour (website)

| Breakpoint | Width | Hero headline | Section rhythm | Columns |
|---|---|---|---|---|
| Desktop large | ≥ 1280 | `display-xl` 54 | 96 | 12, gutter 24 |
| Desktop | 1024 to 1279 | `display-l` 44 | 96 | 12, gutter 24 |
| Tablet | 768 to 1023 | `display-m` 35 | 64 | 8, gutter 24 |
| Mobile | < 768 | `display-s` 28 | 48 | 4, gutter 16, side padding 16 |

- Section headings use the next step down from the hero at each breakpoint.
- Media and text that sit side by side on desktop stack on tablet and mobile, media first.
- Buttons become full width on mobile when they are the band's only action.
- No horizontal scrolling at any width down to 320.

## 10. Do's and don'ts

Do:

- Use `brand` for one thing per screen: the main action or the active state.
- Let size and space do the work; a 34px weight 300 headline is enough emphasis.
- Use the solid `body` grey rather than a translucent white so contrast holds on every dark surface.
- Pair every colour signal with a word, number or icon.

Don't:

- Add a second accent colour, or use macro colours for chrome, buttons or chips.
- Put a shadow on anything at rest (toasts excepted), or use a gradient on chrome.
- Use square or slightly rounded buttons.
- Set text in `brand` on the dark canvas, or in a macro colour anywhere.
- Load fonts from a third-party server.
- Use another company's names, logos, colours or display typefaces in the app, website or docs. (The fallback stack in 4.1 only covers fonts that fail to load.)

## 11. Accessibility

### 11.1 Targets

- Text: at least 4.5:1 against its background (WCAG 2.2 AA, 1.4.3), at every size; we do not rely on the large-text allowance.
- Non-text (bars, tracks, icons, input borders, focus rings): at least 3:1 against the adjacent colour (1.4.11).
- Disabled controls are exempt under WCAG and are intentionally low contrast (`disabled` on `surface-soft` is 1.45:1 in light mode, 2.46:1 in dark); they must also be announced as disabled to assistive technology.
- Touch targets: at least 44×44 (app and website), even when the visible shape is smaller.
- Focus is always visible (section 8.1) and never removed.
- Respect the system text size up to 200% without clipping, and honour reduced motion.

### 11.2 How the ratios were checked

A small Node script computes WCAG 2.x relative luminance and contrast for every text/background and mark/background pair this document uses. Where a pair from issue #179 failed, only the lightness was changed (hue and saturation kept), the smallest amount that passes.

Changes from issue #179:

- `macro-fat` light: `#D97706` → `#C86D06` (was 2.60:1 on `track`, needs 3:1).
- New `outline` token (light `#8B8F9B`, dark `#63656A`) for input borders, which the issue left unspecified; the existing `disabled` and `line` borders are below 3:1 and only acceptable as decoration on labelled buttons.
- New dark `surface-soft` `#1F1F1F` and dark `disabled` `#5C5C5C`, which the issue did not define.
- Macro colours are restricted to non-text marks: light carbs (3.67:1) and fat do not reach 4.5:1 as text.
- Website tablet hero uses `display-m` 35 from the scale instead of a separate 32.

### 11.3 Results

L = light mode, D = dark mode.

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| L text: ink on canvas | `#000000` | `#FFFFFF` | 21.00:1 | 4.5:1 | pass |
| L text: ink on surface | `#000000` | `#F5F7FA` | 19.57:1 | 4.5:1 | pass |
| L text: ink on surface-soft (chip, default) | `#000000` | `#F3F3F3` | 18.93:1 | 4.5:1 | pass |
| L text: body on canvas | `#5C5F66` | `#FFFFFF` | 6.40:1 | 4.5:1 | pass |
| L text: body on surface | `#5C5F66` | `#F5F7FA` | 5.96:1 | 4.5:1 | pass |
| L text: body on tint | `#5C5F66` | `#EAF0FE` | 5.60:1 | 4.5:1 | pass |
| L text: muted on canvas | `#6B6B6B` | `#FFFFFF` | 5.33:1 | 4.5:1 | pass |
| L text: muted on surface | `#6B6B6B` | `#F5F7FA` | 4.97:1 | 4.5:1 | pass |
| L text: muted on surface-soft | `#6B6B6B` | `#F3F3F3` | 4.80:1 | 4.5:1 | pass |
| L text: white on brand (button, active chip, blue band) | `#FFFFFF` | `#2457E6` | 5.86:1 | 4.5:1 | pass |
| L text: white on brand-pressed | `#FFFFFF` | `#1D48C2` | 7.61:1 | 4.5:1 | pass |
| L text: white on brand-active | `#FFFFFF` | `#16389A` | 10.16:1 | 4.5:1 | pass |
| L text: link-light on canvas | `#1D48C2` | `#FFFFFF` | 7.61:1 | 4.5:1 | pass |
| L text: link-light on surface | `#1D48C2` | `#F5F7FA` | 7.09:1 | 4.5:1 | pass |
| L text: brand on canvas (active tab label) | `#2457E6` | `#FFFFFF` | 5.86:1 | 4.5:1 | pass |
| L text: brand on tint | `#2457E6` | `#EAF0FE` | 5.14:1 | 4.5:1 | pass |
| L text: danger on canvas | `#C81B3A` | `#FFFFFF` | 5.72:1 | 4.5:1 | pass |
| L text: danger on surface | `#C81B3A` | `#F5F7FA` | 5.33:1 | 4.5:1 | pass |
| L text: caution on canvas | `#C2410C` | `#FFFFFF` | 5.18:1 | 4.5:1 | pass |
| L text: caution on surface | `#C2410C` | `#F5F7FA` | 4.83:1 | 4.5:1 | pass |
| L text: toast, white on ink | `#FFFFFF` | `#000000` | 21.00:1 | 4.5:1 | pass |
| L text: toast action, link-dark on ink | `#8AB0FF` | `#000000` | 9.73:1 | 4.5:1 | pass |
| L non-text: protein on track | `#2457E6` | `#E6E8EC` | 4.78:1 | 3:1 | pass |
| L non-text: carbs on track | `#0E8F8E` | `#E6E8EC` | 3.21:1 | 3:1 | pass |
| L non-text: fat on track | `#C86D06` | `#E6E8EC` | 3.03:1 | 3:1 | pass |
| L non-text: protein on surface | `#2457E6` | `#F5F7FA` | 5.46:1 | 3:1 | pass |
| L non-text: carbs on surface | `#0E8F8E` | `#F5F7FA` | 3.67:1 | 3:1 | pass |
| L non-text: fat on surface | `#C86D06` | `#F5F7FA` | 3.47:1 | 3:1 | pass |
| L non-text: caution on track | `#C2410C` | `#E6E8EC` | 4.22:1 | 3:1 | pass |
| L non-text: danger on track | `#C81B3A` | `#E6E8EC` | 4.66:1 | 3:1 | pass |
| L non-text: outline (input border) on canvas | `#8B8F9B` | `#FFFFFF` | 3.23:1 | 3:1 | pass |
| L non-text: outline on surface | `#8B8F9B` | `#F5F7FA` | 3.01:1 | 3:1 | pass |
| L non-text: focus (brand) on canvas | `#2457E6` | `#FFFFFF` | 5.86:1 | 3:1 | pass |
| D text: ink on canvas | `#FFFFFF` | `#000000` | 21.00:1 | 4.5:1 | pass |
| D text: ink on surface | `#FFFFFF` | `#181818` | 17.76:1 | 4.5:1 | pass |
| D text: ink on surface-elevated | `#FFFFFF` | `#121314` | 18.60:1 | 4.5:1 | pass |
| D text: ink on surface-soft (chip, default) | `#FFFFFF` | `#1F1F1F` | 16.48:1 | 4.5:1 | pass |
| D text: body on canvas | `#B3B3B3` | `#000000` | 10.02:1 | 4.5:1 | pass |
| D text: body on surface | `#B3B3B3` | `#181818` | 8.47:1 | 4.5:1 | pass |
| D text: body on surface-elevated | `#B3B3B3` | `#121314` | 8.87:1 | 4.5:1 | pass |
| D text: body on tint | `#B3B3B3` | `#0F1A33` | 8.24:1 | 4.5:1 | pass |
| D text: muted on canvas | `#A3A3A3` | `#000000` | 8.33:1 | 4.5:1 | pass |
| D text: muted on surface | `#A3A3A3` | `#181818` | 7.04:1 | 4.5:1 | pass |
| D text: muted on surface-elevated | `#A3A3A3` | `#121314` | 7.37:1 | 4.5:1 | pass |
| D text: white on brand (button, active chip) | `#FFFFFF` | `#2457E6` | 5.86:1 | 4.5:1 | pass |
| D text: link-dark on canvas | `#8AB0FF` | `#000000` | 9.73:1 | 4.5:1 | pass |
| D text: link-dark on surface | `#8AB0FF` | `#181818` | 8.23:1 | 4.5:1 | pass |
| D text: link-dark on surface-elevated | `#8AB0FF` | `#121314` | 8.62:1 | 4.5:1 | pass |
| D text: link-dark on tint | `#8AB0FF` | `#0F1A33` | 8.01:1 | 4.5:1 | pass |
| D text: danger on canvas | `#FF6B81` | `#000000` | 7.67:1 | 4.5:1 | pass |
| D text: danger on surface | `#FF6B81` | `#181818` | 6.49:1 | 4.5:1 | pass |
| D text: caution on canvas | `#FB923C` | `#000000` | 9.28:1 | 4.5:1 | pass |
| D text: caution on surface | `#FB923C` | `#181818` | 7.85:1 | 4.5:1 | pass |
| D text: toast, black on white | `#000000` | `#FFFFFF` | 21.00:1 | 4.5:1 | pass |
| D text: toast action, link-light on white | `#1D48C2` | `#FFFFFF` | 7.61:1 | 4.5:1 | pass |
| D non-text: protein on track | `#6F95FF` | `#2A2B2D` | 5.01:1 | 3:1 | pass |
| D non-text: carbs on track | `#2DD4BF` | `#2A2B2D` | 7.61:1 | 3:1 | pass |
| D non-text: fat on track | `#F5B53D` | `#2A2B2D` | 7.80:1 | 3:1 | pass |
| D non-text: protein on surface | `#6F95FF` | `#181818` | 6.27:1 | 3:1 | pass |
| D non-text: carbs on surface | `#2DD4BF` | `#181818` | 9.54:1 | 3:1 | pass |
| D non-text: fat on surface | `#F5B53D` | `#181818` | 9.77:1 | 3:1 | pass |
| D non-text: caution on track | `#FB923C` | `#2A2B2D` | 6.26:1 | 3:1 | pass |
| D non-text: danger on track | `#FF6B81` | `#2A2B2D` | 5.18:1 | 3:1 | pass |
| D non-text: outline (input border) on canvas | `#63656A` | `#000000` | 3.60:1 | 3:1 | pass |
| D non-text: outline on surface | `#63656A` | `#181818` | 3.04:1 | 3:1 | pass |
| D non-text: outline on surface-elevated | `#63656A` | `#121314` | 3.19:1 | 3:1 | pass |
| D non-text: focus (link-dark) on canvas | `#8AB0FF` | `#000000` | 9.73:1 | 3:1 | pass |
| D non-text: brand button shape on canvas | `#2457E6` | `#000000` | 3.58:1 | 3:1 | pass |

68 pairs, 0 failing
