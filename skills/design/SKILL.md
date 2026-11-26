---
name: design
description: Build checklist for any screen - every state of each control (pressed included), visible focus, legible contrast, a target of at least 24 x 24 px, motion that earns its place and respects reduced motion, only the values of the project's design system, and the screen tried with worst-case data before the blind review. Use when you create or change something the user sees (markup, style, component); sworn loads it at the first screen edit of the session.
user-invocable: false
---

# `sworn:design` — building a screen

Original failure: **a screen gets built from the happy path** — the default state, the short name, the wide window,
the number that fits — and the blind review finds the rest, one round at a time. This skill is the build side of the
screen rubric: what the eight screen lenses of `/sworn:review` will judge, checked while the screen is being made.

## What this skill does NOT do

- It does not judge the finished screen: that is `/sworn:review`, with the screen lenses and the photos.
- It does not replace the project's design system or the owner's taste: a value the system lacks is the owner's call.
- It does not replace the execution manual (`sworn:playbook`): the gear, the gates and what "done" must prove stay
  there. The full screen rubric is the playbook's `references/02-rubrica-aaa.md`
  (`${CLAUDE_PLUGIN_ROOT}/skills/playbook/references/02-rubrica-aaa.md`); this skill is its checklist for the build.
- It does not pick a component library, and it does not cover native mobile, gestures or spring physics.

## When it enters

sworn's router gives the screen route once per session, at the first edit of a file the user sees (style, markup,
component), and that route loads this skill. The project's own skill with "padrao" in its name, if there is one, still
applies: the two add up. Loading the playbook does not stand in for this skill, nor this skill for the playbook.

## Step 1 — the values come from the system

- With `.claude/sworn/design.json` in the project: use only the values it lists (color, spacing, type size, radius,
  shadow, font). A value outside a category it lists is a deviation → ask the owner before using it; the owner's yes
  becomes an entry in its `desvios` (the files, the reason and, optionally, an end date).
- A category the file does not list (duration and easing are never in it) → the project's existing tokens, and without
  them the defaults of Step 3.
- A `design.json` that does not parse or lists nothing → tell the owner, and meanwhile use the project's tokens.
- Without it: reuse the project's existing tokens (CSS variables, the theme file). The closest existing value wins over
  a new one; a new raw value is the exception, said in the change.

## Step 2 — every control, every state

Each interactive element has each state that applies to it, and each one is visible on its own:

| State | What it shows | How to build it |
|---|---|---|
| default | the resting look | the system's values |
| hover | that the element reacts | only behind `@media (hover: hover) and (pointer: fine)`: a touch screen has no hover |
| focus visible | where the keyboard is | `:focus-visible` with a ring of at least 3:1 against what surrounds it; removing the outline without a replacement fails |
| pressed | that the press landed | `:active` feedback inside the press itself, such as `transform: scale(0.97)` in 100–160 ms |
| disabled | that it cannot be used now | reduced but still legible; `disabled` or `aria-disabled="true"`, and why, when it is not obvious |
| loading / busy | that work is running | `aria-busy="true"`; a repeated click does nothing until it ends; past a time limit, the error state with a retry |
| error | what went wrong and what to do | next to the field or the action, in words, not only in red |
| empty | that there is nothing yet | what is missing and the next action |
| selected | which one is chosen | `aria-selected`, `aria-pressed` or `aria-current`, plus a mark that is not color alone |

And for every control:

- Target of at least 24 x 24 CSS px (WCAG 2.2, criterion 2.5.8), or enough space around it to make up the difference.
- Text contrast of at least 4.5:1, and 3:1 for large text and for the parts of a control.
- A name a screen reader can say: the visible label, or `aria-label` when there is only an icon.

## Step 3 — motion: first whether, then how

**Whether.** Motion has to serve a purpose: show where something came from or went, show that a state changed, answer
an input, or keep the user's place while the layout moves. Decoration alone is not a purpose. How often the user sees it
decides how much there is:

| How often the user sees it | Motion |
|---|---|
| a hundred times a day or more (typing, list navigation, a command menu) | none |
| tens of times a day (hover, toggles, tabs) | little: short, opacity only, or none |
| now and then (modal, drawer, toast) | the standard below |
| rarely (first run, a milestone) | may delight, still short |

An action the user started from the keyboard → no animation on its result: the keyboard user is the fast user.

**How.** The values below are the defaults when the project has no duration or easing tokens of its own (Step 1):

| What moves | Easing | Duration |
|---|---|---|
| press feedback | ease-out | 100–160 ms |
| tooltip | ease-out | 125–200 ms |
| dropdown, popover | ease-out | 150–250 ms |
| modal, drawer | ease-out to enter and to leave | 200–500 ms |
| an element already on screen moving to a new place | ease-in-out | under 300 ms |
| hover, color change | ease | under 300 ms |
| constant motion (spinner, progress) | linear | the loop |

- An element that enters starts from `scale(0.9)`–`scale(0.97)` with `opacity: 0`, not from `scale(0)`: nothing in
  the world appears from a point.
- `transform-origin` at the trigger: the popover grows from its button. A modal is the exception, centered.
- ease-in on an entering element → swap it for ease-out: ease-in starts slow, and the interface feels late.
- A state that can reverse half way (hover, open and close) → a CSS `transition`, which can be interrupted; keyframes
  restart from the beginning. The entry on first render → `@starting-style`.
- A list that enters item by item: 30–80 ms between items, and the list can be used before the last one lands.
- `prefers-reduced-motion: reduce` → fewer and gentler, not zero: keep the opacity fades, drop the movement and the
  scale.

**Cost.** Animate `transform` and `opacity`; any other property makes the browser lay out or repaint every frame.
`transition: all` → name the properties. `will-change` only on what animates now. `filter: blur()` under 20 px. A list
of hundreds of rows → virtualize it.

## Step 4 — text, numbers and time

- Plural through `Intl.PluralRules` or the project's i18n library: "1 item" and "0 items" both read right.
- Numbers, currency and percentages through `Intl.NumberFormat` in the user's locale. Where space is short, the compact
  form (1.2M) with the full value in the accessible name and in a tooltip that opens on hover, on focus and on tap
  (`title` alone reaches neither the keyboard nor a touch screen).
- A number that changes in place (counter, price, timer) → `font-variant-numeric: tabular-nums`, so the layout does
  not jump.
- Time: relative ("2 min ago", "in 2 days") up to 7 days either way, through `Intl.RelativeTimeFormat`; after that,
  the absolute date through `Intl.DateTimeFormat`. Under a minute either way (a clock a little off) reads "now", never
  "in 3 seconds". The full timestamp in `<time datetime>` and on hover and on focus.
- Reading text no wider than about 65ch per line.
- An avatar or icon beside text gets `flex-shrink: 0`: a long name wraps or truncates, the avatar keeps its size.

## Step 5 — try the worst-case data

Before calling the screen ready, fill it with the cases of
[references/pior-caso.md](references/pior-caso.md) — the long, the empty, the huge, the right-to-left — at 320 px of
width and at 200% zoom, in light and dark when the project has both. Each case that breaks is fixed, or told to the
owner with the reason it stays. Fictitious data only: `example.com` and `.test` domains, invented names.

## Step 6 — hand it to the blind review

With the screen ready, run `/sworn:review` with `--tela-depois <page address>`, and `--tela-antes <address>` when the
HEAD version runs elsewhere. The screen lenses judge the same rubric this skill builds to, with the photos.

## Credits

The motion filter, the easing and duration table, the text and number rules and the worst-case catalog are adapted
and rewritten from Emil Kowalski's skills (`github.com/emilkowalski/skills`), under the MIT license. The copyright and
permission notice is in [LICENSE-emil-kowalski.txt](LICENSE-emil-kowalski.txt).
