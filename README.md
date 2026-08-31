# Zydus SEZ-1 — Single Line Diagram

An interactive SLD rendered as a tree-structure graph on an infinite canvas,
implemented from the Figma frame
[`Frame 1000004277`](https://www.figma.com/design/3abjmjs7Yzzhzsjtrb3p2z/Zydus?node-id=4142-84514)
(node `4142:84514`).

A [Next.js](https://nextjs.org) app (App Router) that builds to a **static
export**. Needs Node 18.18+, 19.8+ or 20+.

```sh
npm install
npm run dev        # → http://localhost:3000, with hot reload
npm run build      # → out/, plain HTML/CSS/JS for any static host
npm run preview    # serve out/ to check the build
```

`next build` writes `out/` — there is no server to run, since the diagram is a
canvas over a model that ships with the page.

Next.js supplies the page shell and the build; the diagram itself is plain ES
modules in `js/`, with no framework and no runtime library. `app/page.js`
renders the same elements the canvas has always been drawn into and then, once
mounted, imports `js/app.js` — which is why the diagram's code is untouched by
the framework and could be lifted back out of it whole.

## Interaction

The header carries the title and meter count on the left, the search field in
the middle and the canvas controls on the right; below about 1000 px the search
drops to its own row, and below 720 px the buttons keep their icons and give up
their captions.

| Action | Input |
| --- | --- |
| Find a meter | Type in the header search, then `↑`/`↓` and `Enter`, or click a result |
| Pan | Drag anywhere on the canvas, scroll / two-finger swipe, or arrow keys |
| Zoom | `⌘`/`Ctrl` + scroll, trackpad pinch, the `−` / `+` buttons, `+` / `-` keys, or double-click |
| Fit to screen | **Fit** button or `0` |
| Expand / collapse a section | Click the chevron under a card |
| Expand / collapse everything | **Expand all** / **Collapse all** |

### Search

Matching is a case-insensitive substring test over the meter names, ranked so
that a title start beats a word start beats a match anywhere, with breadcrumb
matches last. Every row carries the meter's own colour and the two names above
it in the tree, because several cards in the diagram share a title and only
their place tells them apart.

Picking one opens every folded ancestor on the way to it — its own section is
left as it was — then travels to the card, zooming in far enough to read it if
the reader was further out than that, and rings it until they move on.

Panning is unbounded — the canvas has no edges. Zoom runs from 1 % to 1200 %.
Loading the page with `#collapsed` starts with every branch off the bus folded.

### Accordion

Every parent node carries the chevron from the design. Collapsing hides that
node's **complete connected section** — the whole subtree below it, not just its
direct children — and the card then shows a `+N` badge with the number of nodes
folded away.

Expanding goes the other way, **one level at a time**: it reveals the meters
wired directly below the card, each of them shut in turn. Opening a card is
always a fresh step down the hierarchy — folding a section away drops what was
open inside it rather than remembering it, so a card never springs back to a
shape the reader has since collapsed. After *Expand all*, collapsing
`IN 11KV INCOMER-1` and clicking it again gives you its four outgoing meters,
not the 150 cards that were on screen before.

Two nodes are special:

* **`IN HT MAIN`** opens the whole 415 V section in one click — the bar, its
  incomer chains and every outgoing feeder through to `42FA OG SPARE-2`, and no
  deeper. What hangs below a feeder waits for that feeder's own chevron.
* **`OG TR-1/2/3 (3 MVA)`** carry no chevron: a transformer main is never read
  without the LT main under it, so each pair shows as one unit.

The layout is recomputed on every toggle, so a collapsed branch leaves no gap;
cards and connectors are tweened together so the wiring never detaches from the
cards while it animates.

#### Where the canvas goes

A re-layout re-packs the whole tree — a card that opens is re-centred over the
children it just gained, and the trunk re-centres over the bus, which on
`IN HT MAIN` alone is a 4 665 px slide. So each toggle names one card to hold
still and offsets the canvas by however far that card travelled:

* **Expanding** pins the card that was clicked to the pixel it already occupies.
  The section grows around the reader; the canvas never travels.
* **Collapsing** pins it too — unless folding the branch away has left that card
  against an edge of the screen, in which case the canvas travels to it. Under
  *Collapse all*, where the card nearest the middle of the screen may itself be
  folded away, the anchor walks up the hierarchy to the closest meter still
  drawn.
* **Searching** is the one move that is meant to travel: the canvas goes to the
  meter that was picked and zooms in far enough to read it.

The canvas rides the card tween's own clock, so the anchor holds its pixel on
every frame rather than only at the two ends. Pan, zoom or *Fit* at any point
and the move still owed to the toggle is dropped — the reader always has the
last word on where the canvas sits.

## Structure

```
app/layout.js         <html>, the font links, the page title
app/page.js           the shell — header, canvas, hint — then imports js/app.js
next.config.mjs       output: 'export', so a build lands in out/
css/styles.css        design tokens + card, chevron, bus, header and canvas styles
js/data.js            the tree: every card, colour pair and connection
js/layout.js          contour-based tidy-tree layout (incl. the 415 V bus)
js/app.js             canvas pan/zoom, accordion, rendering, tweening
js/search.js          header search: match, rank and list the meters
public/assets/        SVGs exported from Figma, copied to out/assets/ as they are
```

`js/app.js` reads the DOM and starts drawing the moment it is evaluated, so
`app/page.js` imports it from an effect rather than at the top of the file —
after the shell is on screen, and never while the page is being rendered on
the server.

The SVGs live under `public/` because the code builds their URLs at runtime
(`assets/meter-${tone}.svg`), which no bundler can rewrite — `public/` is the
one place Next copies through untouched, so the same path works in dev and in
an export.

### Data model (`js/data.js`)

Node ids mirror the Figma component names (`Component 411` → `C411`) so the two
can be diffed. Each node is:

```js
{ id, title, tone, kind: 'card' | 'device' | 'bus', metrics, children }
```

* `tone` indexes `TONES`, the bg/border colour pairs used in the design. The
  border doubles as the tone's solid colour: the chevron under a card takes it,
  and the card's meter icon is the matching `public/assets/meter-<tone>.svg` export.
* `edgeSymbol` puts a transformer symbol on the link **into** that node.
* `tieTo` draws the extra connection a UPS bypass makes back into its output
  section — the one place the diagram is not a pure tree.

### The 415 V bus

The bus is a node of its own, drawn as a horizontal bar. Everything on the bar
is one ordered run — `BUS.items` in `js/data.js` — listed left to right exactly
as drawn in the design:

* **feeder** — one of the 32 outgoing sections, hanging below the bar and the
  root of its own accordion subtree.
* **incomer** — a source rising above the bar: a transformer chain fed from
  `IN HT MAIN`, or a standalone DG main, each dropping onto the bar through a
  breaker symbol.
* **coupler** — a GEB/DG section breaker sitting on the bar itself.

Nothing on the bar is placed at a fixed offset or a fraction of the bar's
width; each item is packed into its own slot in that run. So `GEB`/`DG BUS
COUPLER-1` always follow `15FA OG APFCR-1` and `COUPLER-2` always follows
`32FA OG MLDB PANEL`, however wide the bar works out to be.

Slot widths come from content: a feeder takes its subtree's width, an incomer a
card width, and a coupler the width of its own measured caption
(`busSlotWidth` in `js/app.js`), so labels never crowd each other.

Hiding the meter above the bus — `IN HT MAIN`, or anything above it — hides the
bar, its label, every coupler and every DG/transformer breaker along with the
feeders. The bar carries no chevron of its own: everything standing on it is
`IN HT MAIN`'s to open and close.

### Layout (`js/layout.js`)

A tidy top-down tree layout. Each subtree carries its left and right silhouette
so sibling branches stay separated at *every* level and can never interleave —
which matters because tie lines run straight down through their own branch.
Card heights are measured from the DOM, so two- and three-line titles stack
correctly.

## Assets

`public/assets/` holds the SVGs exported from the Figma file, used at their designed
sizes:

| File | Used for | Size |
| --- | --- | --- |
| `meter-<tone>.svg` | card icon, one per colour tone (14) | 40 × 40 |
| `chevron.svg` | accordion chevron | 22 × 22 in a 20 × 20 box |
| `transformer.svg` | transformer on a link | 42 × 66.36 |
| `source-breaker.svg` | incomer breaker on the bar | 63 × 35 |
| `bus-coupler.svg` | bus coupler on the bar | 63 × 35 |

`transformer.svg` is the design's `Group 27080` re-authored upright (Figma
exports it rotated); the circle geometry, stroke colour and weight are
unchanged.

## Notes

* PF `0.8` / kWh `178.67` are the sample readings carried by every metered card
  in the design; swap them per node in `data.js` when wiring up live data.
* Connectors use the design's stroke — black, 1.5 px — and are drawn with
  `vector-effect: non-scaling-stroke` so they stay hairline at any zoom.
