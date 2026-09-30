# DESIGN.md — MIDNIGHT MERIDIAN

Design brief for the UI layer. The pixel-art canvas is **not** covered by this document;
it is art-directed separately in `plan.md`. This file governs the control surface only.

---

## Product / audience / job

| | |
|---|---|
| **Product** | A generative pixel-art night-train scene: an ambient, looping, living wallpaper with a control surface. |
| **Audience** | People who leave a browser open on a second monitor, or a phone on the nightstand. It is a *thing to look at*, not a thing to operate. |
| **User job** | Glance, adjust the mood, walk away. The default state must be beautiful with zero interaction. |
| **Surface mode** | **Experience** (immersive, atmospheric), with an **Operate** panel that is deliberately hidden until summoned. |
| **Non-goals** | Not a game. No accounts, no score, no tutorial, no onboarding, no dashboard. |

The governing tension: *the art is the product; the UI is a remote control for it.* Every UI
decision is judged by whether it gets out of the way of the art.

---

## Visual thesis

**"A control panel for a diorama."** The scene is a lit miniature behind glass. The UI is the
brass-and-glass fascia of the case around it — never floating cards in a void, never a
generic dark-mode dashboard.

Concretely: the panel is a single frosted slab, anchored bottom-left, with a hairline top
edge that catches the same moonlight as the scene's rim light. It reads as *part of the
vitrine*, not as chrome laid on top. It is collapsed to a single button by default and
expands on demand.

**Explicitly rejected** (Design Sorcerer anti-slop list): purple-to-blue gradient headers,
Inter, three-identical cards in a row, drop-shadowed glassmorphism panels, emoji as icons,
invented marketing copy, motion that exists only to be motion.

---

## Palette

All tokens are CSS custom properties. Roles are semantic, never per-component hex.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#05060d` | page base, matches the scene's darkest sky |
| `--surface` | `rgba(14, 18, 32, 0.72)` | panel body |
| `--surface-raised` | `rgba(24, 30, 48, 0.82)` | raised rows, inputs |
| `--border` | `rgba(127, 227, 255, 0.16)` | hairlines |
| `--border-strong` | `rgba(127, 227, 255, 0.34)` | focus, active |
| `--text` | `#dfe7f5` | primary text |
| `--text-muted` | `#8794ad` | labels, units |
| `--accent` | `#ffb14a` | primary action (the train's window amber) |
| `--accent-ink` | `#20160a` | text on accent |
| `--info` | `#7fe3ff` | scene/cold accents, focus ring |
| `--success` | `#7ee0a8` | enabled audio |
| `--danger` | `#ff7a7a` | mute |

**Why accent = amber.** It is the *same hue* as the lit carriage windows, so the UI is
visually welded to the artwork rather than sitting beside it.

**Contrast:** `--text` on `--surface` is ~12:1; `--text-muted` on `--surface` is ~5.2:1. Both
pass WCAG AA for normal text. Focus ring is `--info` at 2px with a 2px offset.

**Grayscale check:** the hierarchy survives without colour — the accent is the only filled
surface, so the primary action is still identifiable in greyscale or with any colour vision.

---

## Typography

| Role | Stack | Treatment |
|---|---|---|
| Display | `"Bahnschrift", "DIN Alternate", "Segoe UI Semibold", system-ui` | menu title, 13px, `letter-spacing: .14em`, uppercase |
| Body / labels | `"Segoe UI", system-ui, -apple-system, sans-serif` | 12px |
| Numerics | `ui-monospace, "Cascadia Mono", Consolas, monospace` | slider values, so digits don't jitter |

No web fonts. The scene already has a strong retro-console voice; a display face on the UI
would fight it. `Bahnschrift` ships with Windows, `Segoe UI` is universal, and the stack
degrades cleanly on macOS/Linux. **This also means zero network requests for type.**

---

## Spacing & shape

4px base scale: `4 / 8 / 12 / 16 / 20 / 24`.
Radius: `4px` (controls), `10px` (panel), `999px` (pills).
Panel width `320px`, max `min(320px, calc(100vw - 32px))`.

---

## Component vocabulary

Exactly six components. No others are permitted.

1. **Panel** — the frosted slab. `backdrop-filter: blur(18px) saturate(120%)`, 1px top
   highlight via `box-shadow: inset 0 1px 0 rgba(255,255,255,.10)`, 1px hairline border,
   18px shadow. Backdrop blur is small and applied to ONE element, not a stack.
2. **Toggle row** — a labelled `<button role="switch" aria-checked>`. Groups of themes are
   a segmented radio row (`role="radiogroup"`), because a theme is a single choice, not many
   independent switches.
3. **Segmented control** — 2-4 mutually exclusive options. Text labels, never colour-only
   dots; each carries a tiny inline SVG glyph so it works without colour.
4. **Slider** — native `<input type="range">`, custom track/thumb. One per sound channel.
5. **Menu button** — the always-visible entry point, bottom-left.
6. **Mute toggle** — a single icon button, top-right, with `aria-pressed`.

---

## Motion grammar

Motion exists to explain state. Nothing moves to be pretty.

| Action | Property | Duration | Easing |
|---|---|---|---|
| Panel expand/collapse | `transform` + `opacity` | 220ms | `cubic-bezier(.22,.61,.36,1)` |
| Segmented thumb | `transform` | 180ms | `cubic-bezier(.34,1.3,.64,1)` (slight overshoot) |
| Slider thumb hover | `transform: scale(1.12)` | 120ms | `ease-out` |
| Focus ring | `opacity` | 90ms | `linear` |
| Button press | `transform: scale(.97)` | 80ms | `ease-out` |

Hard rules from Design Sorcerer:
- Only `transform` and `opacity` are animated. No animated `width`/`height`/`top`/`filter`.
- The panel's collapse animates `transform: scaleY` on a wrapper with `transform-origin: bottom`,
  which does not trigger layout.
- Every value is a duration in ms with an explicit easing. No `transition: all`.
- Hover is gated behind `@media (hover: hover) and (pointer: fine)`; touch uses `:active`.

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` sets every duration to `0.01ms`
and the panel becomes an instant show/hide. The *scene* still animates (it is the content),
but all *UI* motion stops.

---

## Layout

Mobile-first, `320px` up.

- `< 560px`: panel becomes a **bottom sheet** — full width, max-height `70dvh`, internally
  scrollable, and it does **not** scroll the page behind it.
- `>= 560px`: bottom-left slab, `320px` wide.
- The canvas is `position: fixed; inset: 0` and always fills the viewport. UI floats above it
  at `z-index: 10`. The panel never overlaps the train (which sits centre-right) at any
  breakpoint because the panel is anchored to the opposite corner.

## Accessibility

- Semantic `<button>`, `<input type=range>`, `<fieldset>`/`<legend>` for grouped controls.
- Full keyboard: `Tab` order follows visual order; every control is operable with
  `Enter`/`Space`; arrow keys adjust sliders natively; `Escape` closes the panel and returns
  focus to the menu button.
- Visible focus on everything. Focus is trapped inside the panel while open, and restored on
  close.
- Every icon-only control has `aria-label`; decorative SVGs are `aria-hidden="true"`.
- `aria-live="polite"` region announces theme changes and mute state for screen readers.
- Touch targets: minimum 36px tall, 44px on the primary menu button.
- No information conveyed by colour alone — every theme button has a glyph and a text label.

---

## Performance budget

- UI JS: **< 20 KB** uncompressed, no framework, no build step, no CDN.
- Audio: fetched once, decoded to `AudioBuffer`, then played via `AudioBufferSourceNode`
  with `loop = true`. Never re-decoded, never re-fetched.
- Music: synthesised in-browser with the Web Audio API. Zero samples, zero network.
- The renderer must stay under **16.6 ms/frame** so audio never starves. Audio graph is built
  once at first user gesture (browser autoplay policy) and never rebuilt on theme change —
  themes swap oscillator parameters, not the graph.
- `prefers-reduced-motion` and a hidden-tab check pause the UI's rAF work.

---

## Do / Don't

**Do**
- Let the art be the loudest thing on screen.
- Keep the panel collapsed by default.
- Use amber for actions so the UI belongs to the scene.
- Announce state changes for screen readers.

**Don't**
- Don't use gradients on the panel itself (the scene has plenty).
- Don't use emoji as iconography.
- Don't add a "settings" gear, a help modal, or an about dialog inside the piece — About
  lives in the README, per the repo's README rules.
- Don't animate anything that isn't communicating state.
- Don't let the UI cover the train or the moon at any breakpoint.

---

## Verification

1. Keyboard-only pass: tab to every control, toggle each with `Enter`, close with `Escape`,
   confirm focus returns to the trigger.
2. `prefers-reduced-motion` pass: confirm all UI motion stops.
3. Responsive pass at 320, 390, 768, 1440, 2560: panel never overflows, never covers the
   train, page never scrolls.
4. Contrast pass on every text/background pair in the table above.
5. Real browser: `node verify.js` (headless CDP) asserts the panel opens, sliders change gain,
   and the theme buttons actually mutate scene state.
