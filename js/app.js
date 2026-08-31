/**
 * Zydus SEZ-1 SLD — infinite canvas + accordion tree.
 *
 *  · Every card, colour and connection comes from `data.js` (transcribed from
 *    the Figma frame).
 *  · `layout.js` re-runs on every expand/collapse so nothing is left floating.
 *  · Positions are tweened here so cards and wires stay in lock-step.
 */

import { ROOT, TONES, walk } from './data.js';
import { layout, NODE_W, SYMBOL_H, SYMBOL_W, isCollapsible } from './layout.js';
import { initSearch } from './search.js';

/* The design's chevron, recoloured per card through `currentColor`. */
const CHEVRON_SVG = `<svg class="toggle__icon" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
  <path d="M11 21C16.5228 21 21 16.5228 21 11C21 5.47715 16.5228 1 11 1C5.47715 1 1 5.47715 1 11C1 16.5228 5.47715 21 11 21Z" fill="currentColor"/>
  <path d="M15 9L11 13L7 9M21 11C21 16.5228 16.5228 21 11 21C5.47715 21 1 16.5228 1 11C1 5.47715 5.47715 1 11 1C16.5228 1 21 5.47715 21 11Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_K = 0.01;
const MAX_K = 12;
const ANIM_MS = 320;
const FOCUS_K = 0.9; // how far in a searched-for meter is worth reading at

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const wires = document.getElementById('wires');
const measureHost = document.getElementById('measure');

/* ------------------------------------------------------------------ *
 * Model index
 * ------------------------------------------------------------------ */
const nodes = [];
const byId = new Map();
const parentOf = new Map();

walk(ROOT, (node, parent) => {
  nodes.push(node);
  byId.set(node.id, node);
  parentOf.set(node.uid, parent);
});

const descendantCount = new Map();
(function countDescendants(node) {
  let total = 0;
  if (node.kind === 'bus') {
    for (const inc of node.incomers) countDescendants(inc.chain);
  }
  for (const child of node.children) total += 1 + countDescendants(child);
  descendantCount.set(node.uid, total);
  return total;
})(ROOT);

/** Nearest ancestor that is still on screen — where hidden cards fold into. */
function visibleAncestor(node, visible) {
  let cur = parentOf.get(node.uid);
  while (cur && !visible.has(cur.uid)) cur = parentOf.get(cur.uid);
  return cur;
}

const collapsed = new Set();

/* ------------------------------------------------------------------ *
 * Card markup + measurement
 * ------------------------------------------------------------------ */
function cardMarkup(node) {
  const rows = node.metrics
    ? `<div class="card__metrics"><div class="card__rule"></div>${node.metrics
        .map(
          ([k, v]) =>
            `<div class="card__row"><span>${k}</span><span>${v}</span></div>`
        )
        .join('')}</div>`
    : '';
  return `<div class="card"><div class="card__head">
      <img class="card__icon" src="assets/meter-${node.tone}.svg" alt="" width="40" height="40" />
      <p class="card__title">${escapeHtml(node.title)}</p>
    </div>${rows}</div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const cardSizes = new Map();

function measureCards() {
  const frag = document.createDocumentFragment();
  const probes = [];
  for (const node of nodes) {
    if (node.kind === 'bus') continue;
    const el = document.createElement('div');
    el.className = 'node';
    el.innerHTML = cardMarkup(node);
    frag.appendChild(el);
    probes.push([node, el]);
  }
  measureHost.appendChild(frag);
  for (const [node, el] of probes) {
    cardSizes.set(node.uid, { w: NODE_W, h: el.offsetHeight });
  }
  measureHost.textContent = '';
}

const cardSize = (node) =>
  cardSizes.get(node.uid) || { w: NODE_W, h: 129 };

/* Labels sitting on the bus bar are measured too, so a coupler claims as
   much room along the bar as its caption actually needs. */
const labelWidths = new Map();

function measureBusLabels() {
  const frag = document.createDocumentFragment();
  const probes = [];
  for (const item of BUS.items) {
    if (!item.label || labelWidths.has(item.label)) continue;
    const el = document.createElement('span');
    el.className = 'sym__label sym__label--probe';
    el.textContent = item.label;
    frag.appendChild(el);
    probes.push([item.label, el]);
  }
  measureHost.appendChild(frag);
  for (const [label, el] of probes) labelWidths.set(label, el.offsetWidth);
  measureHost.textContent = '';
}

/** Width of a non-feeder slot on the bar: the glyph, or its label if wider. */
const busSlotWidth = (item) => {
  if (item.kind === 'incomer') return cardSize(item.chain).w;
  const label = item.label ? labelWidths.get(item.label) || 0 : 0;
  return Math.max(SYMBOL_W, label);
};

/* ------------------------------------------------------------------ *
 * DOM: one element per card, created once and reused
 * ------------------------------------------------------------------ */
const nodeEls = new Map();
const symbolEls = new Map();
let busEl = null;

function buildDom() {
  const frag = document.createDocumentFragment();

  for (const node of nodes) {
    if (node.kind === 'bus') continue;
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.uid = node.uid;
    el.style.setProperty('--node-bg', TONES[node.tone].bg);
    el.style.setProperty('--node-border', TONES[node.tone].border);
    el.innerHTML = cardMarkup(node);

    if (isCollapsible(node)) {
      el.appendChild(makeToggle(node, cardSize(node).h + 12));
    }
    frag.appendChild(el);
    nodeEls.set(node.uid, el);

    if (node.edgeSymbol) {
      const sym = document.createElement('div');
      sym.className = 'sym sym--transformer';
      sym.innerHTML = `<img src="assets/transformer.svg" alt="" width="42" height="${SYMBOL_H}" />
        <span class="sym__label">${escapeHtml(node.edgeSymbol.label)}</span>`;
      frag.appendChild(sym);
      symbolEls.set(node.uid, sym);
    }
  }

  /* Bus: the bar is drawn in SVG; this element carries its label. The bar has
     no chevron of its own — the feeder run hanging off it is `IN HT MAIN`'s to
     open and close. */
  const bus = findBus(ROOT);
  busEl = document.createElement('div');
  busEl.className = 'node node--bus';
  busEl.dataset.uid = bus.uid;
  const label = document.createElement('span');
  label.className = 'bus-label';
  label.textContent = bus.title;
  busEl.appendChild(label);
  frag.appendChild(busEl);
  nodeEls.set(bus.uid, busEl);

  /* A breaker under each incomer, and the section couplers, in bar order. */
  bus.items.forEach((item, i) => {
    if (item.kind === 'feeder') return;
    const src =
      item.kind === 'coupler' ? 'assets/bus-coupler.svg' : 'assets/source-breaker.svg';
    frag.appendChild(makeBusSymbol(`bus-${i}`, src, item.label));
  });

  world.appendChild(frag);
}

function makeBusSymbol(key, src, label) {
  const el = document.createElement('div');
  el.className = 'sym sym--bus';
  el.innerHTML =
    `<img src="${src}" alt="" width="63" height="35" />` +
    (label ? `<span class="sym__label">${escapeHtml(label)}</span>` : '');
  symbolEls.set(key, el);
  return el;
}

function makeToggle(node, top) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toggle';
  btn.style.top = `${top}px`;
  btn.innerHTML = CHEVRON_SVG + `<span class="toggle__count"></span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(node);
  });
  return btn;
}

function findBus(node) {
  if (node.kind === 'bus') return node;
  for (const c of node.children) {
    const found = findBus(c);
    if (found) return found;
  }
  return null;
}

const BUS = findBus(ROOT);

/** `IN HT MAIN` — the card whose chevron opens the whole 415 V section. */
const SECTION = parentOf.get(BUS.uid);

/* ------------------------------------------------------------------ *
 * Wire geometry
 * ------------------------------------------------------------------ */
function buildWires(boxes, buses) {
  const segs = [];
  const push = (d, cls) => segs.push({ d, cls });
  const cx = (b) => b.x + b.w / 2;

  for (const box of boxes.values()) {
    const node = box.node;
    if (node.kind === 'bus') continue;
    /* Chain cards above the bar are wired by the bus block below. */
    if (box.inBus) continue;
    if (collapsed.has(node.uid)) continue;

    const kids = node.children.filter((k) => boxes.has(k.uid) && k.kind !== 'bus');
    if (kids.length) {
      const kb = kids.map((k) => boxes.get(k.uid));
      const top = Math.min(...kb.map((b) => b.y));
      const bottom = box.y + box.h;
      const midY = bottom + (top - bottom) / 2;
      push(`M ${cx(box)} ${bottom} V ${midY}`);
      if (kb.length > 1) {
        const xs = kb.map(cx);
        push(`M ${Math.min(...xs)} ${midY} H ${Math.max(...xs)}`);
      }
      for (const b of kb) push(`M ${cx(b)} ${midY} V ${b.y}`);
    }

    /* A bypass that rejoins its section further down. */
    if (node.tieTo && !collapsed.has(node.uid)) {
      const target = byId.get(node.tieTo);
      const tb = target && boxes.get(target.uid);
      if (tb) {
        const tKids = target.children.filter((k) => boxes.has(k.uid));
        let tieY = tb.y + tb.h + 26;
        if (tKids.length && !collapsed.has(target.uid)) {
          const top = Math.min(...tKids.map((k) => boxes.get(k.uid).y));
          tieY = tb.y + tb.h + (top - tb.y - tb.h) / 2;
        }
        push(`M ${cx(box)} ${box.y + box.h} V ${tieY} H ${cx(tb)}`, 'tie');
      }
    }
  }

  for (const bus of buses) {
    const busNode = bus.box.node;
    push(`M ${bus.barLeft} ${bus.barY} H ${bus.barLeft + bus.barW}`, 'bus-bar');

    for (const entry of bus.items) {
      if (entry.item.kind === 'feeder') {
        /* Outgoing feeders drop off the bar at their place in the run. */
        const b = boxes.get(entry.item.node.uid);
        if (b) push(`M ${entry.x} ${bus.barY} V ${b.y}`);
      } else if (entry.item.kind === 'incomer') {
        /* Incomer chains rise from the bar at their place in the run. */
        const rows = entry.rows;
        const last = rows[rows.length - 1];
        push(`M ${entry.x} ${last.y + last.h} V ${bus.barY}`);
        for (let i = 0; i < rows.length - 1; i++) {
          push(`M ${entry.x} ${rows[i].y + rows[i].h} V ${rows[i + 1].y}`);
        }
      }
    }

    /* HT main feeds the three transformer chains. */
    const parent = parentOf.get(busNode.uid);
    const pb = parent && boxes.get(parent.uid);
    const fed = bus.items.filter((e) => e.item.fromParent);
    if (pb && fed.length) {
      const top = Math.min(...fed.map((e) => e.rows[0].y));
      const bottom = pb.y + pb.h;
      const midY = bottom + (top - bottom) / 2;
      push(`M ${cx(pb)} ${bottom} V ${midY}`);
      const xs = fed.map((e) => e.x);
      push(`M ${Math.min(...xs)} ${midY} H ${Math.max(...xs)}`);
      fed.forEach((e) => push(`M ${e.x} ${midY} V ${e.rows[0].y}`));
    }
  }

  return segs;
}

/* ------------------------------------------------------------------ *
 * Render + tween
 * ------------------------------------------------------------------ */
let current = null; // { boxes, buses, bounds }
let placement = new Map(); // uid -> { x, y, o }
let symbolPlacement = new Map();
let animHandle = 0;
let viewTween = null; // canvas offset carried alongside a re-layout

function computeTargets(result) {
  const { boxes, buses } = result;
  const targets = new Map();
  const symTargets = new Map();

  for (const node of nodes) {
    const box = boxes.get(node.uid);
    /* A visible bus is positioned by the loop below; a hidden one still
       needs a target so its bar and label fade out with everything else. */
    if (node.kind === 'bus' && box) continue;

    if (box) {
      targets.set(node.uid, { x: box.x, y: box.y, o: 1 });
    } else {
      const anchor = visibleAncestor(node, boxes);
      const ab = anchor ? boxes.get(anchor.uid) : null;
      const isBus = node.kind === 'bus';
      targets.set(node.uid, {
        x: ab ? ab.x + ab.w / 2 - (isBus ? 0 : NODE_W / 2) : 0,
        y: ab ? ab.y + ab.h : 0,
        o: 0,
        ...(isBus ? { w: 0 } : {}),
      });
    }
  }

  for (const bus of buses) {
    targets.set(bus.box.node.uid, { x: bus.barLeft, y: bus.barY, o: 1, w: bus.barW });

    /* Breakers and couplers sit on the bar, at their slot in the run. */
    for (const entry of bus.items) {
      if (entry.item.kind === 'feeder') continue;
      symTargets.set(`bus-${entry.index}`, { x: entry.x, y: bus.barY, o: 1 });
    }
  }

  /* Anything on the bar that is no longer on screen fades out in place, so
     hiding the meter above the bus hides its couplers and DGs too. */
  for (const key of symbolEls.keys()) {
    if (!key.startsWith('bus-') || symTargets.has(key)) continue;
    const prev = symbolPlacement.get(key) || { x: 0, y: 0 };
    symTargets.set(key, { x: prev.x, y: prev.y, o: 0 });
  }

  /* Transformer symbols sit on the link above their card. */
  for (const node of nodes) {
    if (!node.edgeSymbol) continue;
    const box = boxes.get(node.uid);
    const parent = parentOf.get(node.uid);
    const pb = parent && boxes.get(parent.uid);
    if (box && pb) {
      const bottom = pb.y + pb.h;
      symTargets.set(node.uid, {
        x: box.x + box.w / 2,
        y: bottom + (box.y - bottom) / 2,
        o: 1,
      });
    } else {
      const prev = symbolPlacement.get(node.uid) || { x: 0, y: 0 };
      symTargets.set(node.uid, { x: prev.x, y: prev.y, o: 0 });
    }
  }

  return { targets, symTargets };
}

function paint(boxes, buses, frameBoxes) {
  /* Cards */
  for (const [uid, p] of placement) {
    const el = nodeEls.get(uid);
    if (!el) continue;
    if (uid === BUS.uid) {
      el.style.transform = `translate3d(${p.x + (p.w || 0) / 2}px, ${p.y}px, 0)`;
      el.style.setProperty('--bar-half', `${(p.w || 0) / 2}px`);
      el.style.opacity = p.o;
      el.style.display = p.o < 0.02 ? 'none' : '';
      continue;
    }
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    el.style.opacity = p.o;
    el.style.display = p.o < 0.02 ? 'none' : '';
  }

  /* Symbols */
  for (const [key, p] of symbolPlacement) {
    const el = symbolEls.get(key);
    if (!el) continue;
    const onBar = key.startsWith('bus-');
    const w = onBar ? SYMBOL_W : 42;
    const h = onBar ? 35 : SYMBOL_H;
    el.style.transform = `translate3d(${p.x - w / 2}px, ${p.y - h / 2}px, 0)`;
    el.style.opacity = p.o;
    el.style.display = p.o < 0.02 ? 'none' : '';
  }

  /* Wires */
  const segs = buildWires(frameBoxes, buses);
  wires.textContent = '';
  const frag = document.createDocumentFragment();
  for (const seg of segs) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', seg.d);
    if (seg.cls) path.setAttribute('class', seg.cls);
    frag.appendChild(path);
  }
  wires.appendChild(frag);
}

/* ------------------------------------------------------------------ *
 * Holding the reader's place across a re-layout
 *
 * A toggle re-packs the whole tree — a card that opens is re-centred over the
 * children it just gained, and everything to its right shifts along. Left
 * alone, that slides the diagram under the reader even though the canvas
 * itself never moved. So each toggle names one card to hold still, and the
 * canvas is offset by however far that card travelled.
 * ------------------------------------------------------------------ */
const REVEAL_PAD = 48;

/** Rect a card occupies on screen, for a given canvas position. */
function screenRect(box, v) {
  return { x: v.x + box.x * v.k, y: v.y + box.y * v.k, w: box.w * v.k, h: box.h * v.k };
}

/**
 * The card a re-layout is judged by: the one that was toggled, or — once that
 * card is itself folded away, as under *Collapse all* — the closest meter
 * above it in the hierarchy that is drawn both before and after. The bus bar
 * is skipped; it is not a card, and its box is anchored to the bar rather
 * than to the block above it.
 */
function resolveAnchor(node, fromBoxes, toBoxes) {
  let cur = node;
  while (
    cur &&
    (cur.kind === 'bus' || !fromBoxes.has(cur.uid) || !toBoxes.has(cur.uid))
  ) {
    cur = parentOf.get(cur.uid);
  }
  return cur;
}

/** Put a card in the middle of the canvas, close enough in to be read. */
function centredOn(box, k, yFraction = 0.5) {
  return {
    x: viewport.clientWidth / 2 - (box.x + box.w / 2) * k,
    y: viewport.clientHeight * yFraction - (box.y + box.h / 2) * k,
    k,
  };
}

/**
 * Where the canvas should end up.
 *
 *  · pin — the anchor keeps the pixel it already occupies, so a section
 *    expands around the reader and the canvas never travels.
 *  · reveal — used on collapse: pinned as well, unless folding the branch
 *    away has left the card against an edge of the screen, in which case the
 *    canvas travels to it, since that card is now the section.
 *  · focus — used by search: travel to the card wherever it is, zooming in
 *    far enough to read it if the reader was further out than that.
 */
function targetView(anchor, fromBoxes, toBoxes) {
  if (anchor.mode === 'focus') {
    const to = toBoxes.get(anchor.node.uid);
    return to ? centredOn(to, Math.min(MAX_K, Math.max(view.k, FOCUS_K))) : null;
  }

  const node = resolveAnchor(anchor.node, fromBoxes, toBoxes);
  if (!node) return null;

  const to = toBoxes.get(node.uid);
  /* Where the card is *right now*, not where the last layout left it: a
     second click landing mid-tween must anchor to what is on screen. */
  const live = placement.get(node.uid) || fromBoxes.get(node.uid);
  const from = fromBoxes.get(node.uid);
  const pinned = {
    x: view.x + (live.x + from.w / 2 - (to.x + to.w / 2)) * view.k,
    y: view.y + (live.y + from.h / 2 - (to.y + to.h / 2)) * view.k,
    k: view.k,
  };
  if (anchor.mode !== 'reveal') return pinned;

  const r = screenRect(to, pinned);
  const inView =
    r.x >= REVEAL_PAD &&
    r.y >= REVEAL_PAD &&
    r.x + r.w <= viewport.clientWidth - REVEAL_PAD &&
    r.y + r.h <= viewport.clientHeight - REVEAL_PAD;

  /* A little above centre, leaving the room the section needs to open again. */
  return inView ? pinned : centredOn(to, view.k, 0.38);
}

/** The visible card nearest the middle of the screen. */
function centreNode() {
  if (!current) return null;
  const cx = viewport.clientWidth / 2;
  const cy = viewport.clientHeight / 2;
  let best = null;
  let bestD = Infinity;
  for (const box of current.boxes.values()) {
    if (box.node.kind === 'bus') continue;
    const r = screenRect(box, view);
    const d = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
    if (d < bestD) {
      bestD = d;
      best = box.node;
    }
  }
  return best;
}

function render(animate = true, anchor = null) {
  const result = layout(ROOT, cardSize, collapsed, busSlotWidth);
  const { targets, symTargets } = computeTargets(result);

  const from = new Map(placement);
  const symFrom = new Map(symbolPlacement);
  const startBoxes = current ? current.boxes : null;

  cancelAnimationFrame(animHandle);

  /* The canvas rides the same clock as the cards. Both interpolate linearly
     in `t`, so the anchor holds its pixel on every frame in between, not just
     at the two ends. */
  viewTween = null;
  if (anchor && startBoxes) {
    const to = targetView(anchor, startBoxes, result.boxes);
    if (to) viewTween = { from: { x: view.x, y: view.y, k: view.k }, to };
  }

  const finish = () => {
    if (viewTween) {
      Object.assign(view, viewTween.to);
      viewTween = null;
      applyView();
    }
    placement = targets;
    symbolPlacement = symTargets;
    current = result;
    paint(result.boxes, result.buses, result.boxes);
    updateToggles(result.boxes);
    updateWorldSize(result.bounds);
  };

  if (!animate || !startBoxes) {
    finish();
    return;
  }

  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const step = (now) => {
    /* Clamp both ends: a frame timestamped before t0 would otherwise drive
       the easing out of range and push opacities outside 0..1. */
    const raw = Math.max(0, Math.min(1, (now - t0) / ANIM_MS));
    const t = ease(raw);

    if (viewTween) {
      const { from: v0, to: v1 } = viewTween;
      view.x = v0.x + (v1.x - v0.x) * t;
      view.y = v0.y + (v1.y - v0.y) * t;
      view.k = v0.k + (v1.k - v0.k) * t;
      applyView();
    }

    placement = new Map();
    for (const [uid, to] of targets) {
      const a = from.get(uid) || to;
      const aw = a.w ?? to.w;
      placement.set(uid, {
        x: a.x + (to.x - a.x) * t,
        y: a.y + (to.y - a.y) * t,
        o: (a.o ?? 0) + ((to.o ?? 1) - (a.o ?? 0)) * t,
        w: to.w === undefined ? undefined : aw + (to.w - aw) * t,
      });
    }
    symbolPlacement = new Map();
    for (const [key, to] of symTargets) {
      const a = symFrom.get(key) || to;
      symbolPlacement.set(key, {
        x: a.x + (to.x - a.x) * t,
        y: a.y + (to.y - a.y) * t,
        o: (a.o ?? 0) + ((to.o ?? 1) - (a.o ?? 0)) * t,
      });
    }

    /* Wires follow the interpolated card positions. */
    const frameBoxes = new Map();
    for (const [uid, box] of result.boxes) {
      const p = placement.get(uid);
      frameBoxes.set(uid, p ? { ...box, x: p.x, y: p.y } : box);
    }
    const frameBuses = result.buses.map((bus) => {
      const p = placement.get(bus.box.node.uid);
      const dx = p ? p.x - bus.barLeft : 0;
      const dy = p ? p.y - bus.barY : 0;
      return {
        ...bus,
        barLeft: bus.barLeft + dx,
        barW: p && p.w !== undefined ? p.w : bus.barW,
        barY: bus.barY + dy,
        items: bus.items.map((entry) => ({
          ...entry,
          x: entry.x + dx,
          rows: entry.rows
            ? entry.rows.map((r) => {
                const rp = placement.get(r.node.uid);
                return rp ? { ...r, x: rp.x, y: rp.y } : r;
              })
            : undefined,
        })),
      };
    });

    paint(result.boxes, frameBuses, frameBoxes);

    if (raw < 1) {
      animHandle = requestAnimationFrame(step);
    } else {
      finish();
    }
  };

  animHandle = requestAnimationFrame(step);
}

function updateToggles(boxes) {
  for (const node of nodes) {
    if (!isCollapsible(node)) continue;
    const el = nodeEls.get(node.uid);
    if (!el) continue;
    const btn = el.querySelector('.toggle');
    if (!btn) continue;
    const open = !collapsed.has(node.uid);
    const hidden = descendantCount.get(node.uid);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute(
      'aria-label',
      `${open ? 'Collapse' : 'Expand'} ${node.title} (${hidden} nodes)`
    );
    const badge = btn.querySelector('.toggle__count');
    badge.textContent = open ? '' : `+${hidden}`;
    badge.style.display = open ? 'none' : '';
    btn.style.visibility = boxes.has(node.uid) ? '' : 'hidden';
  }
}

function updateWorldSize(bounds) {
  world.style.width = `${bounds.maxX - bounds.minX}px`;
  world.style.height = `${bounds.maxY - bounds.minY}px`;
  wires.setAttribute('width', `${bounds.maxX - bounds.minX}`);
  wires.setAttribute('height', `${bounds.maxY - bounds.minY}`);
}

/* ------------------------------------------------------------------ *
 * Accordion
 * ------------------------------------------------------------------ */
/** Shut every section in `run`, so the level above it opens on its own. */
function foldAll(run) {
  for (const node of run) {
    if (isCollapsible(node)) collapsed.add(node.uid);
  }
}

/**
 * Open the section under `IN HT MAIN` in one click: the bus bar, its incomer
 * chains and every outgoing feeder through to `42FA OG SPARE-2` — and no
 * deeper. What hangs below a feeder waits for that feeder's own chevron.
 */
function expandSection() {
  collapsed.delete(SECTION.uid);
  foldAll(BUS.children);
}

/**
 * Open one level: the meters wired directly below the card, each of them shut
 * in turn. Opening a card is always a fresh step down the hierarchy — folding
 * a section away drops what was open inside it rather than remembering it, so
 * a card never springs back to a shape the reader has since collapsed.
 */
function expandOneLevel(node) {
  collapsed.delete(node.uid);
  foldAll(node.children);
}

function toggle(node) {
  const folding = !collapsed.has(node.uid);
  if (folding) collapsed.add(node.uid);
  else if (node === SECTION) expandSection();
  else expandOneLevel(node);
  /* Opening grows the section around the card that was clicked; folding one
     away travels back to that card if its branch took the view with it. */
  render(true, { node, mode: folding ? 'reveal' : 'pin' });
}

/**
 * Travel to one meter — what the header search hands back. Every ancestor
 * that is folded away is opened so the card is on the canvas at all; its own
 * section is left as it was, since naming a meter says nothing about wanting
 * everything under it.
 */
function focusNode(node) {
  for (let cur = parentOf.get(node.uid); cur; cur = parentOf.get(cur.uid)) {
    collapsed.delete(cur.uid);
  }
  render(true, { node, mode: 'focus' });
  flashFound(node);
}

let flashTimer = 0;

/** Ring the card the reader asked for, so it is obvious which one it is. */
function flashFound(node) {
  clearTimeout(flashTimer);
  for (const el of nodeEls.values()) el.classList.remove('is-found');
  const el = nodeEls.get(node.uid);
  if (!el) return;
  void el.offsetWidth; // restart the pulse when the same card is picked twice
  el.classList.add('is-found');
  flashTimer = setTimeout(() => el.classList.remove('is-found'), 3400);
}

document.getElementById('expandAll').addEventListener('click', () => {
  const node = centreNode();
  collapsed.clear();
  render(true, node && { node, mode: 'pin' });
});

/** Keep the trunk down to the bus open; fold every branch hanging off it. */
function collapseBranches() {
  collapsed.clear();
  for (const child of BUS.children) if (isCollapsible(child)) collapsed.add(child.uid);
  for (const inc of BUS.incomers) if (isCollapsible(inc.chain)) collapsed.add(inc.chain.uid);
}

document.getElementById('collapseAll').addEventListener('click', () => {
  const node = centreNode();
  collapseBranches();
  render(true, node && { node, mode: 'reveal' });
});

/* ------------------------------------------------------------------ *
 * Pan / zoom — unbounded canvas
 * ------------------------------------------------------------------ */
const view = { x: 0, y: 0, k: 1 };

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  document.getElementById('zoomLevel').textContent = `${Math.round(view.k * 100)}%`;
}

/** The reader has taken the canvas over: drop any move still owed to a toggle. */
function stopViewTween() {
  viewTween = null;
}

/** A pointer position in canvas coordinates — the header offsets the canvas. */
function localPoint(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function zoomAt(px, py, factor) {
  stopViewTween();
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
  const scale = k / view.k;
  view.x = px - (px - view.x) * scale;
  view.y = py - (py - view.y) * scale;
  view.k = k;
  applyView();
}

function fit(animate = false) {
  if (!current) return;
  stopViewTween();
  const b = current.bounds;
  const pad = 80;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const k = Math.min(
    (viewport.clientWidth - pad * 2) / w,
    (viewport.clientHeight - pad * 2) / h
  );
  const target = {
    k: Math.min(MAX_K, Math.max(MIN_K, k)),
    x: 0,
    y: 0,
  };
  target.x = (viewport.clientWidth - w * target.k) / 2 - b.minX * target.k;
  target.y = (viewport.clientHeight - h * target.k) / 2 - b.minY * target.k;

  if (!animate) {
    Object.assign(view, target);
    applyView();
    return;
  }
  const from = { ...view };
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = ease(Math.max(0, Math.min(1, (now - t0) / ANIM_MS)));
    view.x = from.x + (target.x - from.x) * t;
    view.y = from.y + (target.y - from.y) * t;
    view.k = from.k + (target.k - from.k) * t;
    applyView();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const p = localPoint(e.clientX, e.clientY);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
    } else {
      stopViewTween();
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      applyView();
    }
  },
  { passive: false }
);

let drag = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest('.toggle')) return;
  stopViewTween();
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('is-panning');
});

viewport.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  view.x = drag.vx + (e.clientX - drag.x);
  view.y = drag.vy + (e.clientY - drag.y);
  applyView();
});

const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  viewport.classList.remove('is-panning');
};
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

viewport.addEventListener('dblclick', (e) => {
  if (e.target.closest('.toggle')) return;
  const p = localPoint(e.clientX, e.clientY);
  zoomAt(p.x, p.y, 1.5);
});

document.getElementById('zoomIn').addEventListener('click', () =>
  zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.3)
);
document.getElementById('zoomOut').addEventListener('click', () =>
  zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1 / 1.3)
);
document.getElementById('fit').addEventListener('click', () => fit(true));

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const cx = viewport.clientWidth / 2;
  const cy = viewport.clientHeight / 2;
  const pan = e.shiftKey ? 300 : 100;
  switch (e.key) {
    case '+':
    case '=':
      zoomAt(cx, cy, 1.3);
      break;
    case '-':
    case '_':
      zoomAt(cx, cy, 1 / 1.3);
      break;
    case '0':
      fit(true);
      break;
    case 'ArrowLeft':
      stopViewTween();
      view.x += pan;
      applyView();
      break;
    case 'ArrowRight':
      stopViewTween();
      view.x -= pan;
      applyView();
      break;
    case 'ArrowUp':
      stopViewTween();
      view.y += pan;
      applyView();
      break;
    case 'ArrowDown':
      stopViewTween();
      view.y -= pan;
      applyView();
      break;
    default:
      return;
  }
  e.preventDefault();
});

/* Pinch-to-zoom on touch. */
const touches = new Map();
let pinch = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, e);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    const p = localPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    pinch = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      cx: p.x,
      cy: p.y,
    };
    drag = null;
  }
});
viewport.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    zoomAt(pinch.cx, pinch.cy, dist / pinch.dist);
    pinch.dist = dist;
  }
});
const dropTouch = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
};
viewport.addEventListener('pointerup', dropTouch);
viewport.addEventListener('pointercancel', dropTouch);

/* ------------------------------------------------------------------ *
 * Header search
 * ------------------------------------------------------------------ */
/** The two nearest ancestors, which is what tells same-named cards apart. */
function breadcrumb(node) {
  const trail = [];
  for (let cur = parentOf.get(node.uid); cur && trail.length < 2; cur = parentOf.get(cur.uid)) {
    trail.push(cur.title);
  }
  return trail.join(' ‹ ');
}

function buildSearch() {
  const meters = nodes.filter((node) => node.kind !== 'bus');
  document.getElementById('nodeCount').textContent = `${meters.length} meters`;
  initSearch(
    meters.map((node) => ({ node, title: node.title, path: breadcrumb(node), tone: node.tone })),
    focusNode,
    TONES
  );
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
/** Re-measure and re-lay-out; used once the web font finishes loading. */
function remeasure() {
  cardSizes.clear();
  labelWidths.clear();
  measureCards();
  measureBusLabels();
  for (const node of nodes) {
    if (node.kind === 'bus') continue;
    const btn = nodeEls.get(node.uid)?.querySelector('.toggle');
    if (btn) btn.style.top = `${cardSize(node).h + 12}px`;
  }
  /* New metrics move every row a little; hold whatever the reader is on, in
     case the font lands after they have already gone looking for something. */
  const node = centreNode();
  render(false, node && { node, mode: 'pin' });
}

function showBootError(err) {
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.textContent = `The diagram failed to load: ${err && err.message ? err.message : err}`;
  document.body.appendChild(box);
  console.error(err);
}

function start() {
  /* Draw straight away with whatever font is available. The diagram must
     never wait on the network to paint — a slow or blocked webfont used to
     leave the canvas blank for as long as the request took. */
  try {
    measureCards();
    measureBusLabels();
    buildDom();
    buildSearch();
    if (location.hash === '#collapsed') collapseBranches();
    render(false);
    fit(false);
  } catch (err) {
    showBootError(err);
    return;
  }

  /* Noto Sans measures differently from the fallback stack, so once it has
     settled re-measure and re-fit — but leave the view alone if the reader
     has already started moving around. */
  if (!document.fonts || !document.fonts.ready) return;
  const settled = { x: view.x, y: view.y, k: view.k };
  document.fonts.ready
    .then(() => {
      const untouched =
        view.x === settled.x && view.y === settled.y && view.k === settled.k;
      remeasure();
      if (untouched) fit(false);
    })
    .catch(() => {
      /* keep the fallback-metric layout */
    });
}

start();
