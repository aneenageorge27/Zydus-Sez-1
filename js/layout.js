/**
 * Tidy top-down tree layout for the SLD.
 *
 * Cards keep a fixed width; heights are measured from the DOM and passed in,
 * so a two- and a three-line title stack correctly. Parents are centred over
 * their children; each subtree carries its left and right silhouette so
 * sibling branches stay separated at *every* level and can never interleave.
 *
 * The 415 V bus is a special node: a horizontal bar whose contents — outgoing
 * feeders, incomer chains and section couplers — are packed as one ordered
 * run in the order given by the model. Nothing on the bar is placed at a
 * fixed offset, so a coupler always keeps its position in the sequence
 * however wide the bar ends up.
 */

export const NODE_W = 240;
export const H_GAP = 28;
export const V_GAP = 78;
export const V_GAP_SYMBOL = 150; // room for a transformer symbol on the link
export const BAR_H = 4;
export const BUS_PAD = 56;
export const SYMBOL_W = 63; // bus breaker / coupler glyph
export const SYMBOL_H = 66;
export const SYMBOL_GAP = 20;
export const DROP_H = 48;

/** A node gets a chevron if it has children and is not pinned open. */
export function isCollapsible(node) {
  return node.children.length > 0 && !node.alwaysOpen;
}

/**
 * @param root       the tree root
 * @param cardSize   (node) -> { w, h }, measured from the DOM
 * @param collapsed  Set of collapsed node uids
 * @param slotWidth  (item) -> width of a non-feeder slot on the bus bar, so a
 *                   coupler's own label decides how much room it takes
 */
export function layout(root, cardSize, collapsed, slotWidth) {
  const boxes = new Map(); // uid -> { node, x, y, w, h, depth }
  const kidsOf = (node) => (collapsed.has(node.uid) ? [] : node.children);

  /* Vertical structure of one bus incomer chain, measured up from the bar. */
  function chainRows(item) {
    const stack = [item.chain];
    if (!collapsed.has(item.chain.uid) && item.chain.children.length) {
      stack.push(item.chain.children[0]);
    }
    let h = DROP_H;
    const rows = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const node = stack[i];
      const size = cardSize(node);
      rows.unshift({ node, w: size.w, h: size.h, bottomOffset: h });
      h += size.h;
      if (i > 0 && node.edgeSymbol) h += SYMBOL_GAP + SYMBOL_H + SYMBOL_GAP;
    }
    return { rows, h };
  }

  /* A fixed-width placeholder occupying one level of silhouette only. */
  const slot = (w) => ({
    node: null,
    kids: [],
    offs: [],
    x: 0,
    w,
    h: 0,
    left: [0],
    right: [w],
  });

  /* Merge a run of sibling silhouettes left to right; returns their offsets. */
  function pack(subs) {
    const offs = new Array(subs.length).fill(0);
    const accL = subs[0].left.slice();
    const accR = subs[0].right.slice();

    for (let i = 1; i < subs.length; i++) {
      const s = subs[i];
      let push = 0;
      const shared = Math.min(accR.length, s.left.length);
      for (let d = 0; d < shared; d++) {
        push = Math.max(push, accR[d] + H_GAP - s.left[d]);
      }
      offs[i] = push;
      for (let d = 0; d < s.left.length; d++) {
        const l = s.left[d] + push;
        const r = s.right[d] + push;
        if (d < accL.length) {
          accL[d] = Math.min(accL[d], l);
          accR[d] = Math.max(accR[d], r);
        } else {
          accL[d] = l;
          accR[d] = r;
        }
      }
    }
    return { offs, accL, accR };
  }

  /* Shift a subtree's silhouette so it starts at 0. */
  function normalise(sub) {
    const minL = Math.min(...sub.left);
    if (minL === 0) return sub;
    sub.x -= minL;
    for (let d = 0; d < sub.left.length; d++) {
      sub.left[d] -= minL;
      sub.right[d] -= minL;
    }
    for (let i = 0; i < sub.offs.length; i++) sub.offs[i] -= minL;
    /* A bus keeps its own copy of every item's offset and bar anchor; those
       have to move with the rest of the subtree, or the bar ends up shifted
       against the things sitting on it. */
    if (sub.parts) {
      for (const part of sub.parts) {
        part.off -= minL;
        part.anchor -= minL;
      }
    }
    return sub;
  }

  function build(node) {
    if (node.kind === 'bus') return buildBus(node);

    const size = cardSize(node);
    const kids = kidsOf(node);
    if (!kids.length) {
      return { node, kids: [], offs: [], x: 0, w: size.w, h: size.h, left: [0], right: [size.w] };
    }

    const subs = kids.map(build);
    const { offs, accL, accR } = pack(subs);
    const last = subs.length - 1;
    const firstMid = offs[0] + subs[0].x + subs[0].w / 2;
    const lastMid = offs[last] + subs[last].x + subs[last].w / 2;
    const x = (firstMid + lastMid) / 2 - size.w / 2;

    return normalise({
      node,
      kids: subs,
      offs,
      x,
      w: size.w,
      h: size.h,
      left: [x, ...accL],
      right: [x + size.w, ...accR],
    });
  }

  /**
   * The bus. Its own silhouette level is the bar; everything on the bar —
   * feeder subtrees, incomer slots, coupler slots — is packed as one run on
   * the level below, which is what holds the sequence and its spacing.
   * Feeders drop out of the run when the bus itself is collapsed, but the
   * incomers and couplers stay: the bar is still there.
   */
  function buildBus(node) {
    const showFeeders = !collapsed.has(node.uid);

    /* `index` is the item's position in the model, kept so callers can
       address a symbol by a key that survives feeders being hidden. */
    const parts = [];
    node.items.forEach((item, index) => {
      if (item.kind === 'feeder' && !showFeeders) return;
      const sub = item.kind === 'feeder' ? build(item.node) : slot(slotWidth(item));
      parts.push({ item, index, sub });
    });

    const { offs, accL, accR } = pack(parts.map((p) => p.sub));
    parts.forEach((p, i) => {
      p.off = offs[i];
      /* Where this item meets the bar. */
      p.anchor = offs[i] + p.sub.x + p.sub.w / 2;
    });

    const barLeft = accL[0] - BUS_PAD;
    const barW = accR[0] - accL[0] + BUS_PAD * 2;
    const blockH = Math.max(0, ...node.incomers.map((item) => chainRows(item).h));
    const feeders = parts.filter((p) => p.item.kind === 'feeder');

    return normalise({
      node,
      kids: feeders.map((p) => p.sub),
      offs: feeders.map((p) => p.off),
      parts,
      isBus: true,
      x: barLeft,
      w: barW,
      h: blockH + BAR_H,
      blockH,
      left: [barLeft, ...accL],
      right: [barLeft + barW, ...accR],
    });
  }

  /* ---- assign absolute x, keeping bus parts alongside ---------------- */
  const busSubs = [];

  function assign(sub, originX, depth) {
    boxes.set(sub.node.uid, {
      node: sub.node,
      x: originX + sub.x,
      y: 0,
      w: sub.w,
      h: sub.h,
      depth,
    });
    if (sub.isBus) {
      busSubs.push({ sub, depth });
      for (const part of sub.parts) {
        part.absAnchor = originX + part.anchor;
        if (part.item.kind === 'feeder') assign(part.sub, originX + part.off, depth + 1);
      }
      return;
    }
    sub.kids.forEach((k, i) => assign(k, originX + sub.offs[i], depth + 1));
  }

  assign(build(root), 0, 0);

  /* ---- row heights and vertical placement -------------------------- */
  const rowH = [];
  const gapAbove = [];
  for (const box of boxes.values()) {
    rowH[box.depth] = Math.max(rowH[box.depth] || 0, box.h);
    const g = box.node.edgeSymbol ? V_GAP_SYMBOL : V_GAP;
    gapAbove[box.depth] = Math.max(gapAbove[box.depth] || 0, g);
  }

  const rowY = [];
  for (let d = 0; d < rowH.length; d++) {
    rowY[d] = d === 0 ? 0 : rowY[d - 1] + rowH[d - 1] + (gapAbove[d] || V_GAP);
  }
  for (const box of boxes.values()) box.y = rowY[box.depth];

  /* ---- bus internals: bar line, incomer chains, coupler anchors ----- */
  const buses = busSubs.map(({ sub, depth }) => {
    const box = boxes.get(sub.node.uid);
    const barY = box.y + sub.blockH;

    const items = sub.parts.map((part) => {
      const entry = { item: part.item, index: part.index, x: part.absAnchor };
      if (part.item.kind === 'incomer') {
        const { rows } = chainRows(part.item);
        for (const row of rows) {
          row.x = part.absAnchor - row.w / 2;
          row.y = barY - row.bottomOffset - row.h;
          boxes.set(row.node.uid, {
            node: row.node,
            x: row.x,
            y: row.y,
            w: row.w,
            h: row.h,
            depth,
            inBus: true,
          });
        }
        entry.rows = rows;
      }
      return entry;
    });

    return { box, barY, barLeft: box.x, barW: box.w, items };
  });

  /* ---- bounds ------------------------------------------------------ */
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const b of boxes.values()) {
    minx = Math.min(minx, b.x);
    miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w);
    maxy = Math.max(maxy, b.y + b.h);
  }

  return {
    boxes,
    buses,
    bounds: { minX: minx, minY: miny, maxX: maxx, maxY: maxy },
  };
}
