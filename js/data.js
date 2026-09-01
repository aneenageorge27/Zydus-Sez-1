/**
 * Zydus SEZ-1 — Single Line Diagram
 * Tree model transcribed from Figma `Frame 1000004277` (node 4142:84514).
 *
 * Every card, its title, its metrics, its colour pair and its parent/child
 * relationship is taken directly from the design. Node ids match the Figma
 * component names (Component 411 -> C411) so the two can be cross-checked.
 *
 *   n(id, title, tone, children)   full card  (icon + title + PF + kWh)
 *   d(id, title, tone)             device card (icon + title only)
 */

/**
 * Colour pairs lifted from the design (bg / border). The border is also each
 * tone's "solid" colour: the chevron under a card takes it, and the card's
 * meter icon is the matching per-tone export in `assets/meter-<tone>.svg`.
 */
export const TONES = {
  /* HV trunk — 66 kV incomer down through the transformer and DG mains.
     colors/other/white on colors/text, per `Component 409`. */
  white: { bg: '#ffffff', border: '#323232' },
  yellow: { bg: '#fffae0', border: '#ffc300' },
  yellowSoft: { bg: '#fffce5', border: '#ffe100' },
  lime: { bg: '#edfce4', border: '#4bc323' },
  green: { bg: '#e5fbef', border: '#00a251' },
  teal: { bg: '#e5faf9', border: '#00b9aa' },
  sky: { bg: '#ebfaff', border: '#00aaf0' },
  steel: { bg: '#f0f5ff', border: '#90aee7' },
  blue: { bg: '#ebf3ff', border: '#1e69f5' },
  purple: { bg: '#f9f5ff', border: '#7832e1' },
  magenta: { bg: '#fef1fb', border: '#e123af' },
  pink: { bg: '#ffebf1', border: '#fa276c' },
  rose: { bg: '#ffebf1', border: '#f53c78' },
  orange: { bg: '#fff1e0', border: '#ff8c19' },
  /* Status tones — see the legend in the header. */
  off: { bg: '#ffe4dc', border: '#e4553d' },
  disconnected: { bg: '#eeeeee', border: '#8f9391' },
};

/* Every metered card in the design carries the same sample readings. */
const PF = '0.8';
const KWH = '178.67';

let seq = 0;
function n(id, title, tone, children) {
  return {
    id,
    uid: `${id}#${seq++}`,
    title,
    tone,
    kind: 'card',
    metrics: [
      ['PF', PF],
      ['kWh', KWH],
    ],
    children: children || [],
  };
}
function d(id, title, tone, children) {
  const node = n(id, title, tone, children);
  node.kind = 'device';
  node.metrics = null;
  return node;
}

/* ------------------------------------------------------------------ *
 * 415 V main bus.
 *
 * Everything that sits on the bar is one ordered run, in the left-to-right
 * order of the design, so each coupler and each incomer keeps its place in
 * the sequence relative to the feeders either side of it:
 *
 *   feeder   an outgoing section, hanging below the bar
 *   incomer  a source rising above the bar (transformer chain or DG)
 *   coupler  a section breaker sitting on the bar itself
 * ------------------------------------------------------------------ */

const TR1 = n('C407', 'OG TR-1 (3 MVA)', 'white', [
  n('C361', '9FA IN TR-1 MAIN', 'white'),
]);
TR1.children[0].edgeSymbol = {
  type: 'transformer',
  label: '11/0.415 KV 3 MVA Transformer-1',
};

const TR2 = n('C408', 'OG TR-2 (3 MVA)', 'white', [
  n('C381', '21FA IN TR-2 MAIN', 'white'),
]);
TR2.children[0].edgeSymbol = {
  type: 'transformer',
  label: '11/0.415 KV 3 MVA Transformer-2',
};

const TR3 = n('C409', 'OG TR-3 (3 MVA)', 'white', [
  n('C392', '36FA IN TR-3 MAIN', 'white'),
]);
TR3.children[0].edgeSymbol = {
  type: 'transformer',
  label: '11/0.415 KV 3 MVA Transformer-3',
};

/* A transformer chain carries no chevron of its own: the OG card is never read
   without the LT main under it, so the pair shows as one unit whenever the bus
   section is open. */
for (const tr of [TR1, TR2, TR3]) tr.alwaysOpen = true;

const DG1 = n('C362', '14FA IN DG 1 MAIN', 'white');
const DG2 = n('C398', '27FA IN DG 2 MAIN', 'white');
const DG3 = n('C399', '37FA IN DG 3 MAIN', 'white');

/* The outgoing sections, as authored in the design. */
const BUS_FEEDERS = [
    // 33FA ------------------------------------------------------------
    n('C372', '33FA OG GN-7 PDB PANEL 5 (C)', 'yellow', [
      n('C412', 'IN GN-7 PDB PANEL 5 (C) MAIN', 'sky', [
        n('C413', 'OG GN-7 PDB PANEL 5 (C) HVAC', 'sky'),
        n('C414', 'OG GN-7 SPARE-5', 'sky'),
      ]),
    ]),
    // 1FA -------------------------------------------------------------
    n('C371', '1FA OG FIRE SYSTEM', 'yellow'),
    // 2FA -------------------------------------------------------------
    n('C370', '2FA OG GN-4 PDB PANEL-3 L5', 'yellow', [
      n('C415', 'IN GN-4 PDB PANEL-3 L5 MAIN', 'lime', [
        n('C416', 'OG GN4 (H5) HVAC', 'green'),
      ]),
    ]),
    // 3FA -------------------------------------------------------------
    n('C369', '3FA OG GN-1 PDB PANEL-1 LINE T1', 'yellow', [
      n('C417', 'IN GN-1 PDB PANEL-1 LINE T1 MAIN', 'lime', [
        n('C418', 'OG GN1 (T1) HVAC', 'green'),
      ]),
    ]),
    // 4FA -------------------------------------------------------------
    n('C368', '4FA OG SUB PCC PANEL-1 (GOSD+ONCO HVAC)', 'yellow', [
      n('C419', 'IN GN-1 SUB PCC PANEL MAIN', 'orange', [
        n('C424', 'OG OLD ONCO + HVAC', 'orange', [
          n('C425', 'IN ONCO MAIN PANEL MAIN', 'orange', [
            n('C426', 'IN ONCO PDB PANEL MAIN', 'orange'),
            n('C427', 'IN ONCO AHU PANEL MAIN', 'orange'),
            n('C428', 'IN ONCO CHILLER PANEL MAIN', 'orange'),
          ]),
        ]),
        n('C423', 'OG GEN UTILITY PANEL- 1', 'orange'),
        n('C422', 'OG GN PDB BUILDING', 'orange'),
        n('C421', 'OG GEN PDB GF', 'orange'),
        n('C420', 'OG GEN HVAC', 'orange'),
      ]),
    ]),
    // 5FA -------------------------------------------------------------
    n('C367', '5FA OG UTILITY MCC PANEL-1', 'yellow', [
      n('C429', 'IN UTILITY MCC PANEL 1 MAIN', 'magenta', [
        n('C430', 'OG AIR COMPRESSOR 2', 'magenta'),
        n('C431', 'OG 7.5 TON  BOILER-2', 'magenta'),
        n('C432', 'OG CHILLER PANEL TERRACE', 'magenta'),
      ]),
    ]),
    // 6FA -------------------------------------------------------------
    n('C366', '6FA OG GN-2 PDB PANEL-6 LINE H2', 'yellow', [
      n('C433', 'IN GN-2 PDB PANEL-6 LINE H2 MAIN', 'lime', [
        n('C434', 'OG GN-2 (H2) HVAC', 'green'),
      ]),
    ]),
    // 7FA -------------------------------------------------------------
    n('C365', '7FA OG PROCESS CUM HVAC PANEL (ONCO SF)', 'yellow', [
      n('C435', 'IN ONCO PROCESS CUM HVAC PANEL MAIN', 'lime', [
        n('C436', 'OG ONCO PROCESS CUM HVAC PANEL HVAC', 'green'),
      ]),
    ]),
    // 8FA — UPS system 1 ----------------------------------------------
    n('C364', '8FA OG UPS SYSTEM-1', 'yellow', [
      n('C437', 'OG UPS 1 INPUT', 'pink', [
        d('C439', '625 KVA UPS-1', 'pink', [
          n('C440', 'IN UPS 1 OUTPUT', 'pink', [
            n('C445', 'IN ONCO UPS PANEL-1 MAIN', 'pink'),
            n('C443', 'IN GN-7 UPS PCC PANEL MAIN', 'pink'),
            n('C442', 'IN GN-7 UPS PANEL B SF MAIN', 'pink'),
            n('C441', 'IN ADMIN UPS PANEL MAIN', 'pink'),
            n('C444', 'IN GN-2 UPS PDB PANEL 1 MAIN', 'pink'),
          ]),
        ]),
      ]),
      /* The bypass runs down beside the UPS and rejoins the output. */
      Object.assign(n('C438', 'IN UPS 1 BYPASS', 'pink'), { tieTo: 'C440' }),
    ]),
    // 10FA ------------------------------------------------------------
    n('C373', '10FA OG HARMONIC FILTER', 'yellow'),
    // 11FA ------------------------------------------------------------
    n('C374', '11FA OG PDB/ 2ND PKG + TECH AREA', 'yellow', [
      n('C446', 'IN PDB/ 2ND PKG + TECH AREA MAIN', 'purple', [
        n('C447', 'IN PDB/ 2ND PKG + TECH AREA AHU MAIN', 'purple', [
          n('C449', 'OG HEAT PUMP-1', 'purple'),
          n('C448', 'OG HOT WATER PUMP 1 VFD', 'purple'),
          n('C450', 'OG HOT WATER PUMP 3', 'purple'),
          n('C451', 'OG SPARE-4', 'purple'),
        ]),
      ]),
    ]),
    // 12FA ------------------------------------------------------------
    n('C375', '12FA OG CHILLER MCC PANEL-1', 'yellow', [
      n('C452', 'IN CHILLER MCC 1 INCOMER', 'teal', [
        n('C455', 'OG CHILLER 2', 'teal'),
        n('C453', 'OG CHILED WATER PUMP- 1', 'teal'),
        n('C454', 'IN COOLING TOWER FAN 2 MAIN', 'teal'),
      ]),
    ]),
    // 13FA ------------------------------------------------------------
    n('C376', '13FA OG CHILLER MCC PANEL-3', 'yellow', [
      n('C456', 'IN CHILLER MCC 3 MAIN', 'purple', [
        n('C457', 'OG CHILLER 3', 'purple'),
        n('C458', 'OG NEW AIR DRYER BEKO', 'purple'),
        n('C459', 'IN COOLING TOWER FAN 1 MAIN', 'purple'),
        n('C460', 'IN COOLING TOWER PUMP 1 MAIN', 'purple'),
      ]),
    ]),
    // 15FA / 18FA -----------------------------------------------------
    n('C377', '15FA OG APFCR-1', 'yellow'),
    n('C378', '18FA OG APFCR-2', 'yellow'),
    // 19FA ------------------------------------------------------------
    n('C379', '19FA OG GN-5 PDB PANEL-7  L7', 'yellow', [
      n('C461', 'IN GN-5 PDB PANEL-7  L7 MAIN', 'lime', [
        n('C462', 'OG GN-5 HVAC', 'green'),
      ]),
    ]),
    // 20FA ------------------------------------------------------------
    n('C380', '20FA OG CHILLER MCC PANEL-2', 'yellow', [
      n('C463', 'IN CHILLER MCC 2 MAIN', 'steel', [
        n('C467', 'OG CHILLER 1', 'steel'),
        n('C466', 'OG CHILLED WATER PUMP- 2', 'steel'),
        n('C465', 'OG CHILED WATER PUMP- 3', 'steel'),
      ]),
      n('C464', 'IN COOLING TOWER PUMP 2 MAIN', 'yellowSoft', [
        n('C468', 'OG COOLING TOWER PUMP 3', 'yellowSoft'),
      ]),
    ]),
    // 22FA ------------------------------------------------------------
    n('C382', '22FA OG GN-7 PDB PANEL 2 (A) (SF)', 'yellow', [
      n('C470', 'IN GN-7 PDB PANEL 2 (A) MAIN', 'yellow', [
        n('C471', 'OG GN-7 PDB PANEL 2 (A) HVAC', 'yellow', [
          n('C473', 'IN GN-7 HVAC PANEL 2 (A) MAIN', 'yellow'),
        ]),
        n('C472', 'OG GN-7 PDB PANEL 3 (B) SF', 'yellow', [
          n('C474', 'IN GN-7 PDB PANEL 3 (B) MAIN', 'yellow', [
            n('C476', 'IN GN-7 PDB PANEL 4 (B) MAIN', 'yellow', [
              n('C477', 'OG GN-7 PDB PANEL 4 (B) HVAC', 'yellow'),
            ]),
            n('C475', 'OG GN-7 PDB PANEL 3 (B) HVAC', 'yellow'),
          ]),
        ]),
      ]),
    ]),
    // 23FA — UPS system 2 ---------------------------------------------
    n('C383', '23FA OG PDB PANEL 1 FOR GN7 (FF)', 'yellow', [
      n('C478', 'IN GN-7 PDB PANEL 1 FF MAIN', 'teal', [
        n('C479', 'OG UPS SYSTEM-2', 'teal', [
          Object.assign(n('C485', 'IN UPS 2 BYPASS', 'teal'), { tieTo: 'C488' }),
          n('C486', 'IN UPS 2 INPUT', 'teal', [
            d('C487', '65 KVA UPS 2', 'rose', [
              n('C488', 'IN UPS 2 OUTPUT', 'rose', [
                n('C489', 'OG ATLAS COMPRESSOR 400CFM', 'rose'),
              ]),
            ]),
          ]),
        ]),
        n('C480', 'OG HEAT PUMP-2', 'teal'),
        n('C481', 'OG GN7 HVAC+HEAT PUMP', 'teal'),
        n('C482', 'OG WATER SYSTEM', 'teal'),
        n('C483', 'OG SPARE-3', 'teal'),
      ]),
    ]),
    // 24FA ------------------------------------------------------------
    n('C384', '24FA OG PROCESS MCC (PHASE-1) ONCO FF', 'yellow', [
      n('C490', 'IN ONCO PROCESS MCC (PHASE-1) MAIN', 'lime', [
        n('C491', 'IN ONCO HVAC MCC PANEL MAIN', 'green'),
      ]),
    ]),
    // 25FA ------------------------------------------------------------
    n('C385', '25FA OG UTILITY MCC PANEL-2', 'yellow', [
      n('C492', 'IN UTILITY MCC PANEL 2 MAIN', 'purple', [
        n('C493', 'OG AIR COMPRESSOR 1', 'purple'),
        n('C494', 'OG AIR COMPRESSOR 3', 'purple'),
        n('C495', 'OG BOREWELL DB BOX', 'purple'),
        n('C496', 'OG RO PLANT', 'purple'),
        n('C497', 'OG ETP + STP', 'purple'),
        n('C498', 'IN BOILER 8TPH MAIN', 'purple'),
      ]),
    ]),
    // 26FA ------------------------------------------------------------
    n('C386', '26FA OG GN 6 DEDICATED', 'yellow', [
      n('C499', 'IN GN-6 PDB PANEL MAIN', 'blue'),
      n('C500', 'IN GN-6 630A PDB MAIN', 'blue'),
      n('C501', 'IN GN-6 HVAC MAIN', 'blue'),
    ]),
    // 28FA ------------------------------------------------------------
    n('C387', '28FA OG GN-3 PDB PANEL-2 L4', 'yellow', [
      n('C502', 'IN GN-3 PDB PANEL-2 L4 MAIN', 'lime', [
        n('C503', 'OG GN3 (H4) HVAC', 'green'),
      ]),
    ]),
    // 29FA ------------------------------------------------------------
    n('C388', '29FA OG PDB ADMIN BLOCK', 'yellow', [
      n('C504', 'IN PDB ADMIN BLOCK MAIN', 'lime', [
        n('C505', 'OG PDB ADMIN BLOCK HVAC', 'green'),
      ]),
    ]),
    // 30FA ------------------------------------------------------------
    n('C389', '30FA OG GN-2 PDB PANEL-5 LINE H1', 'yellow', [
      n('C506', 'IN GN-2 PDB PANEL-5 LINE H1 MAIN', 'lime', [
        n('C507', 'OG GN-2 (H1) HVAC', 'green'),
      ]),
    ]),
    // 31FA ------------------------------------------------------------
    n('C390', '31FA OG PDB WARE HOUSE', 'yellow', [
      n('C508', 'IN PDB WARE HOUSE MAIN', 'lime', [
        n('C509', 'OG WARE HOUSE HVAC', 'green'),
      ]),
    ]),
    // 32FA ------------------------------------------------------------
    n('C391', '32FA OG MLDB PANEL', 'yellow', [
      n('C510', 'IN MLDB MAIN', 'sky', [
        n('C511', 'OG STREET LIGHT', 'sky'),
        n('C512', 'OG PMLDB ADMIN', 'sky'),
        n('C513', 'OG LT ROOM LSDB', 'sky'),
        n('C514', 'OG PMLDB DEDICATED BLOCK', 'sky'),
        n('C515', 'OG PMLDB PRODUCTION BLOCK', 'sky', [
          n('C516', 'IN GN-2 PMLDB PANEL MAIN', 'sky'),
        ]),
      ]),
    ]),
    // 38FA — 42FA -----------------------------------------------------
    n('C393', '38FA OG APFCR-3', 'yellow'),
    n('C394', '39FA OG 66KV SWITCH YARD', 'yellow', [
      n('C517', 'IN ACDB INCOMER MAIN', 'purple'),
    ]),
    n('C395', '40FA OG ATLAS AIR COMPRESSOR 5', 'yellow'),
    n('C396', '41FA OG SPARE-1', 'yellow'),
    n('C397', '42FA OG SPARE-2', 'yellow'),
];

const feederById = new Map(BUS_FEEDERS.map((node) => [node.id, node]));
const out = (id) => ({ kind: 'feeder', node: feederById.get(id) });
const src = (chain, extra) => ({ kind: 'incomer', chain, ...extra });
const cpl = (label) => ({ kind: 'coupler', label });

const BUS = {
  id: 'BUS415',
  uid: 'BUS415#bus',
  kind: 'bus',
  title: '415 V MAIN BUS',
  tone: 'white',
  children: BUS_FEEDERS,
  /* Left-to-right order along the bar, exactly as drawn in the design:
     both bus couplers follow `15FA OG APFCR-1`, the second pair follows
     `32FA OG MLDB PANEL`, and each DG / transformer drops in between the
     feeders it sits between in the frame. */
  items: [
    out('C372'),
    out('C371'),
    out('C370'),
    out('C369'),
    out('C368'),
    out('C367'),
    out('C366'),
    out('C365'),
    out('C364'),
    src(TR1, { fromParent: true }),
    out('C373'),
    out('C374'),
    out('C375'),
    out('C376'),
    src(DG1, { label: '2500 KVA DG-1' }),
    out('C377'),
    cpl('GEB BUS COUPLER-1'),
    cpl('DG BUS COUPLER-1'),
    out('C378'),
    out('C379'),
    out('C380'),
    src(TR2, { fromParent: true }),
    out('C382'),
    out('C383'),
    out('C384'),
    out('C385'),
    out('C386'),
    src(DG2, { label: '2500 KVA DG-2' }),
    out('C387'),
    out('C388'),
    out('C389'),
    out('C390'),
    out('C391'),
    cpl('GEB BUS COUPLER-2'),
    cpl('DG BUS COUPLER-2'),
    src(TR3, { fromParent: true }),
    src(DG3, { label: '2500 KVA DG-3' }),
    out('C393'),
    out('C394'),
    out('C395'),
    out('C396'),
    out('C397'),
  ],
};

BUS.incomers = BUS.items.filter((item) => item.kind === 'incomer');

/* ------------------------------------------------------------------ *
 * 66 kV incomer down to the 415 V bus.
 * ------------------------------------------------------------------ */

export const ROOT = n('C411', 'IN 66KV GELLOPS LINE INCOMER', 'white', [
  n('C400', 'OG 66KV TRANSFORMER-1', 'off', [
    n('C401', 'IN 11KV INCOMER- 1', 'white', [
      n('C402', 'OG ZLL ONCOLOGY F OG- 1', 'disconnected', [
        n('C406', 'IN HT MAIN', 'white', [BUS]),
      ]),
      n('C403', 'OG ALIDAC OG- 2', 'white'),
      n('C404', 'OG ZLL (ZTL) OG- 5', 'white'),
      n('C405', 'OG 11KV CAPACITOR BANK OG- 3', 'white'),
    ]),
  ]),
]);

/* 66/11 kV transformer sits on the incomer -> 11 kV bus link. */
ROOT.children[0].children[0].edgeSymbol = {
  type: 'transformer',
  label: '66/11 KV 12MVA Transformer-1',
};

/* ------------------------------------------------------------------ *
 * SLD selection zones — the highlighted sections from the design, each a
 * fixed set of meters. `groups` is an array of boxes a zone draws (every
 * zone here is one box); a box only draws once every one of its own
 * meters is actually on screen; see `updateZones` in `app.js`.
 *
 * The HT panel box stops at `OG TR-1/2/3` — it does not reach down to the
 * `IN TR-x MAIN` cards underneath them, which sit at the same height as
 * the DG mains directly above the 415 V bus. Reaching that far would
 * both sweep the DG mains into the box (they sit in the gaps between the
 * three transformer chains, which are spread across the bus's full
 * width) and run the box into the LTPCC zone below it.
 * ------------------------------------------------------------------ */
export const ZONES = [
  {
    id: 'substation',
    title: '66 KV Substation',
    color: '#4bc323',
    text: '#323232',
    groups: [['C411', 'C400', 'C401', 'C402', 'C403', 'C404', 'C405']],
  },
  {
    id: 'htPanel',
    title: 'HT PANEL (HT ROOM)',
    color: '#e123af',
    text: '#ffffff',
    groups: [['C406', 'C407', 'C408', 'C409']],
  },
  {
    id: 'ltpcc',
    title: 'LTPCC PANEL (LT ROOM)',
    color: '#ffc300',
    text: '#323232',
    groups: [[DG1.id, DG2.id, DG3.id, ...BUS_FEEDERS.map((f) => f.id)]],
  },
];

/** Depth-first walk over the model, including bus incomer chains. */
export function walk(node, visit, parent = null) {
  visit(node, parent);
  if (node.kind === 'bus') {
    for (const inc of node.incomers) walk(inc.chain, visit, node);
  }
  for (const child of node.children) walk(child, visit, node);
}
