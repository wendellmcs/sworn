# AAA rubric — the eight screen lenses

One lens per inspector. Each inspector answers **the question of its lens**, cites **mandatory
evidence**, and classifies each finding as P0 / P1 / P2.

**Rule that holds for all eight:** a finding that does not cite `arquivo:linha` or `viewport + coordinate of the
screenshot` is not a finding. It is opinion, and does not count in the verdict.

**How this file works.** The *question* and the *severity cutoff* of each lens are universal and
are written here. The *values* compared against belong to the project and come in by slice. A lens
whose slice is empty **says it is empty** and judges only internal consistency — it never invents the ruler.

---

## Lens 1 — Design system fidelity

**Question:** does every visual value used exist in the declared ruler, or was it invented?

**Ruler:** `{{texto:reguaDeComparacao}}`. To be usable, it needs to enumerate, with literal values:
**colors** (action, neutrals, semantic) · **radii** · **spacings** · **type
scales** (family, size, weight, line height) · **named shadows** · recurring **fixed
measures**. Any value outside these lists is a finding.

**Principles that usually accompany a ruler** — confirm which hold here, do not presume:

- **action color has meaning**: the primary color marks action, active state, focus or selection; in
  decoration, it is removed;
- **contrast before elegance**: text and placeholder legible before subtle;
- **semantic state is only state**: the success/warning/error/info colors never become a category
  nor decoration;
- **product scale**: fixed typography, not fluid by viewport, when the product is dense;
- **elevation has a closed vocabulary**: shadow only where the ruler says so (modal, dropdown, focus, real
  hover); a surface at rest uses border or tone.

**P0:** illegible contrast. **P1:** invented value, shadow outside the vocabulary, action color used
as decoration. **P2:** valid value but inconsistent with the reference artifact.

---

## Lens 2 — Required states

**Question:** does every control and every region with data have the states it needs, or only the happy path?

**Checklist (universal):** default · hover · focus-visible · disabled (reduced opacity but still
legible) · loading/busy (marked semantically, repeated clicks blocked) · error · empty ·
selected.

**Content rules of the states:**

- **Error** declares the source, the category of the cause and the **next safe action**. A generic error is a finding.
- **Empty** explains which source or filter is missing. Silent empty is a finding.
- **Loading** uses skeleton or local progress when the content has a known shape.
- **Partial success is a first-class state** — when the data comes from several sources and one fails,
  this never collapses into a generic error.

**Evidence of the states:** the component seen alone, with all the checklist states side by side
— its page in the project's component catalog, if there is one; without a catalog, a states page
assembled for the review (it can be the Artifact page of the visual choice). A state that only appears by
navigating the whole flow goes unnoticed.

**P0:** async action with no loading that allows a destructive double click. **P1:** any state of the
checklist missing, or error/empty without the required information. **P2:** state present but with microcopy
that can be improved.

---

## Lens 3 — Responsiveness and overflow

**Question:** does any operational value leak, or does any layout break, at any of the viewports?

**Mandatory viewports:** `{{texto:viewports}}`. Without this slice, test the ones the project
demonstrably supports — and **say which were tested**. Inventing a viewport the product does not
serve produces a false finding; omitting one it serves lets a real bug through.

**Check:** `min-width: 0` on flex/grid children; **intentional** wrap, truncate or scroll for
email, domain, protocol, JSON, command, long name, chip and button; multi-column layout collapsing
structurally at the **declared collapse point** — `{{texto:pontoDeColapso}}`; dropdown out of
context with clipped overflow (or `fixed`/portal/native).

**With no declared collapse point, the lens does not go quiet: it demands collapse below tablet
(`max-width: 768px`) and says in its opinion that it used the default.** An empty slice authorizes declaring the absence;
it never authorizes abandoning the check. Measured on 2026-08-17: with the criterion written as *"at the declared
point"* and no point declared in the adapter, the inspector let through a two-column header
that does not collapse even at the smallest supported viewport — the ruler that carried the concrete criterion caught
the same defect. **A criterion without a value is not a criterion.**

**Overflow of an operational value is a design bug, not a detail.**

**P0:** visible overflow or inaccessible content at any viewport in the list. **P1:** horizontal
scroll on the body, collapse that hides a control. **P2:** density outside the reference artifact's
standard.

---

## Lens 4 — Accessibility

**Question:** does it work by keyboard and is it perceivable without depending on color?

**Checklist (universal):** practical WCAG AA on contrast · **visible** focus (never just removing the native
outline; if the ruler names a focus ring, that is it) · every control reachable and operable by
keyboard · accessible label or native semantics where the element is not self-explanatory · status
**never** by color alone (icon, text or shape alongside) · short motion, driven by state, respecting
`prefers-reduced-motion` · targets sized for repeated use, and at minimum **24 × 24 px** (WCAG
2.2, criterion 2.5.8, level AA), except the criterion's exceptions: a smaller target whose 24 px
diameter circle, centered on it, crosses neither another target nor the circle of another smaller target; link inside a
sentence; the same function in another control on the page that meets the 24 px; size decided by the
browser, with no author styling; or size essential to the information.

**"Status by color alone" has a literal example, and it is P0.** A badge, dot, ball, bar or cell
**with no text and no accessible label**, distinguished only by background color, **is** status by color alone.
That is **P0** — it is not a P1 of "accessible label missing". The question that decides: *if the color is removed,
is any information left?* If none is left, it is P0.

> Measured on 2026-08-17: without this example written down, **two independent inspectors** found the two
> empty colored badges and classified both as P1 for a missing label. Both rulers already
> mandated P0 for "status never by color alone" — and both were downgraded in application. A rule without
> an example is a rule that gets applied wrong.

**"Selection by class alone" is also a finding, and the question that decides is the same.** A tab, chip, list
item or segment button whose *selected* state exists only as a style class (`.active`,
`.selected`), with nothing that exposes that state to the accessibility layer, **is P1** — whoever uses a screen
reader hears the selected item exactly the same as the others. It becomes **P0** when, removing the color, nothing
tells the selected from the unselected. **It does not apply** when the native control already carries the
state; there, demanding an extra attribute is a false positive.

> Measured on 2026-08-17: in a real project, a modal's active tab marked selection only by the class
> `active`, and that class's style changed only background, color and border. **14 blind inspectors**
> went through that tab and none opened a finding — neither of the two rulers measured named the case.
> Selection is the most common state of every tabbed interface, and it was the only one the lens did not cite.

**P0:** focus removed with no substitute, control unreachable by keyboard, status by color alone.
**P1:** contrast below AA, accessible label missing where semantics are not enough, selection state only in
a style class, target below 24 × 24 px outside the exceptions. **P2:** target that meets
the minimum but is small for repeated use.

---

## Lens 5 — Microcopy

**Question:** is the text the language the target user of this product already knows?

**Checklist:** **canonical labels preserved exactly** — `{{texto:rotulosCanonicos}}` · tone
consistent with the rest of the product · placeholder describes the expected value · no marketing jargon,
no exclamation marks, no infantilizing treatment · error message names the source · uniform interface
language.

**P0:** canonical label altered. **P1:** language switched mid-UI, tone outside the standard,
decorative placeholder. **P2:** sentence that can be improved.

---

## Lens 6 — Visual anti-references

**Question:** does this look like what this product is, or like another category of product?

**What this product must not look like:** `{{texto:antiReferencias}}`.

Without this slice, the lens asks the weak version — *"is there a visual system here parallel to the one that already
exists in the product?"* — and **declares that it has no list**. The list matters because it inverts per
project: what is a defect in an operational panel is a requirement on a marketing page.

Starter list for a **dense operational product**, to be confirmed with the owner: card-heavy decoration ·
nested card · glassmorphism · gratuitous gradient · ornamental motion · exaggerated corners · text
with gradient · decorative background grid · "sketchy" illustration · striped background · hero-metric
template · thick side border as generic card decoration · landing-page layout.

**P1** for any item of the declared list. **P2** for subtle density drift.

---

## Lens 7 — Correctness and regression

**Question:** does what already worked keep working?

**Checklist:** the area's done-proof passes (`{{campo:provaDePronto}}`) · names, IDs and storage
keys intact · load order and entry points preserved · structured data
handled by parser/API, not by fragile text · no opportunistic refactoring in the diff · no
change in a file unrelated to the goal · nothing touched in `{{campo:intocaveis}}` · response to a
click: on a web screen, the **INP** (Interaction to Next Paint, the time from the click until the screen responds) is
good up to **200 ms** and bad above **500 ms** (web.dev, 75th percentile); without a measurement, the lens says it
did not measure, and does not presume.

**P0:** functional regression, load order altered, storage key renamed, untouchable
touched. **P1:** failing test, removed test, INP measured above 500 ms. **P2:** technical debt
observed, INP measured between 200 and 500 ms.

---

## Lens 8 — Governance and security

**Question:** are permission and secrecy still correct?

**Checklist:** the project's source of truth for permission is respected · restricted UI **does not render**
before effective access is confirmed · turning the permission off hides the UI **and** blocks the
service path behind it · every destructive mutation goes through explicit confirmation · no
secret in log, screenshot, network capture, report, prompt context or derived documentation ·
new visible feature updates permissions, admin screens, help, tests and docs **in the same
change set**.

**P0:** exposed secret, restricted UI rendered before confirmation, destructive mutation without
confirmation. **P1:** permission without a mirror in the places that declare it. **P2:** governance
observation.

**The threat model belongs to the project, not to the lens** — `{{campo:modeloDeAmeaca}}` and
`{{texto:guardaCorposDoProjeto}}`. In a project that declared the risk as accepted, **proposing unrequested
hardening is a finding this lens raises, not a merit of the work**. In a public project, or one that is itself a
security mechanism, the rule inverts. Read the slice before judging.

**Before opening a security P0, three mandatory checks.** First, the **real callers**,
not the hypothetical path: if none reaches the state you assumed, there is no finding. Second, **reading
is not mutation**: the mutation gate not blocking a read is the design, not the defect. Third,
**deliberate design is not a flaw**: a pattern repeated and coherent across the whole module is intent until proven
otherwise. **If you cannot confirm the intent, the finding is born P2 with a question, never P0** — P0
blocks delivery, and blocking over an approved design is the harm the lens exists to avoid.

---

## Application by type of change

| Change | Mandatory lenses |
|---|---|
| Style / layout / visual component | 1, 2, 3, 4, 6, 7 |
| UI text | 1, 5 |
| New visible feature | the 8 screen lenses and the 10 code lenses |
| Logic without UI | the 10 code lenses |
| Contract between systems | the 10 code lenses |
| Release | the 8 screen lenses and the 10 code lenses |

Numbers 1 to 8 are the screen lenses of this rubric. The code ones are those of `/sworn:review`,
with each one's question in `LENTES`, in `scripts/lib/veredito.js` of the plugin.

**Do not run all eight when only four apply.** A lens without an object returns an empty opinion, and an empty
opinion contaminates the round count.
