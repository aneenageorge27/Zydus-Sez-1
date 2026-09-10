/**
 * Card → IOsense meter.
 *
 * The diagram was transcribed from Figma, so a card's id is a component name
 * (`C412`) and its title is a human label — neither is a `devID`. The site's
 * device register bridges the two: its "device name" column is the card title
 * verbatim, so the table below is keyed by name and can be checked row by row
 * against `js/data.js` by eye.
 *
 * Every meter on this site exposes the same three channels, so unlike a general
 * IOsense consumer there is no per-devType channel discovery to do.
 */

/**
 * Fixed channel layout, identical on every meter here.
 *
 * `D1` carries active power and `D3` the power factor — the reverse of the
 * register's column order, confirmed against live readings: `D1` returned 354
 * and `D3` returned 0.96 on `ZADS1EM_T18`, and a power factor cannot exceed 1.
 * Read the channel names off a device with `__sldChannels(devID)` before
 * changing this.
 */
export const SENSORS = { PF: 'D3', kW: 'D1', kWh: 'D30' };

/**
 * Channel whose value below 1 marks the meter faulted, painting the card red.
 * Fetched but never displayed.
 */
export const FAULT_SENSOR = 'D6';

/**
 * The link-health channels, resolved per device by NAME rather than pinned to
 * an id: unlike D1/D3/D30 these were not given as fixed ids, and a wrong
 * channel here would silently paint cards the wrong colour.
 *
 * `\bSTATUS\b` deliberately will not match "Status Word" style compound names
 * ahead of a plain "Status" — the first exact hit wins.
 */
const LINK_PATTERNS = {
  rssi: [/^RSSI$/, /\bRSSI\b/, /SIGNAL\s*STRENGTH/],
  status: [/^STATUS$/, /\bSTATUS\b/, /\bONLINE\b/],
};

/**
 * Find the RSSI and Status channels on one device.
 *
 * @param {{sensors?: Array<{sensorId: string, sensorName: string}>}} device
 * @returns {{rssi: string|null, status: string|null}}
 */
export function resolveLinkSensors(device) {
  const sensors = (device && device.sensors) || [];
  const found = { rssi: null, status: null };

  for (const [key, patterns] of Object.entries(LINK_PATTERNS)) {
    /* Earlier patterns are more specific, so the first to hit wins. */
    for (const pattern of patterns) {
      const hit = sensors.find((s) =>
        pattern.test(String(s.sensorName || '').toUpperCase())
      );
      if (hit) {
        found[key] = hit.sensorId;
        break;
      }
    }
  }
  return found;
}

/**
 * Card titles that differ from the register only by a typo.
 *
 * `OG CHILLED WATER PUMP- 2` is spelled with two Ls on the diagram and one in
 * the register; pumps 1 and 3 use one L on both sides, and A165/A166/A167 are
 * consecutive, so this is the same meter. Aliased rather than corrected in
 * `data.js` — the titles are a faithful Figma transcription and should not
 * drift silently.
 */
const ALIASES = {
  'OG CHILLED WATER PUMP- 2': 'OG CHILED WATER PUMP- 2',
};

/** Whitespace- and case-insensitive, so stray double spaces cannot miss. */
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Device name → devID, verbatim from the site register (156 rows).
 *
 * Six rows are meters that exist but are not drawn on the diagram
 * (`OUTGOING- 4/6/7/8`, `IN 11 KV INCOMER- 2`); they simply go unused.
 */
export const DEVICE_IDS = {
  'IN HT MAIN': 'ZADS1EM_R151',
  'OG TR-1 (3 MVA)': 'ZADS1EM_R152',
  'OG TR-2 (3 MVA)': 'ZADS1EM_R153',
  'OG TR-3 (3 MVA)': 'ZADS1EM_R154',
  'IN BOILER 8TPH MAIN': 'ZADS1EM_R169',
  '1FA OG FIRE SYSTEM': 'ZADS1EM_G1',
  '2FA OG GN-4 PDB PANEL-3 L5': 'ZADS1EM_G2',
  '3FA OG GN-1 PDB PANEL-1 LINE T1': 'ZADS1EM_G3',
  '4FA OG SUB PCC PANEL-1 (GOSD+ONCO HVAC)': 'ZADS1EM_G4',
  '5FA OG UTILITY MCC PANEL-1': 'ZADS1EM_G5',
  '6FA OG GN-2 PDB PANEL-6 LINE H2': 'ZADS1EM_G6',
  '7FA OG PROCESS CUM HVAC PANEL (ONCO SF)': 'ZADS1EM_G7',
  '8FA OG UPS SYSTEM-1': 'ZADS1EM_G8',
  '9FA IN TR-1 MAIN': 'ZADS1EM_G9',
  '10FA OG HARMONIC FILTER': 'ZADS1EM_G10',
  '11FA OG PDB/ 2ND PKG + TECH AREA': 'ZADS1EM_G11',
  '20FA OG CHILLER MCC PANEL-2': 'ZADS1EM_T12',
  '13FA OG CHILLER MCC PANEL-3': 'ZADS1EM_T13',
  '19FA OG GN-5 PDB PANEL-7  L7': 'ZADS1EM_T15',
  '12FA OG CHILLER MCC PANEL-1': 'ZADS1EM_T16',
  '21FA IN TR-2 MAIN': 'ZADS1EM_T17',
  '22FA OG GN-7 PDB PANEL 2 (A) (SF)': 'ZADS1EM_T18',
  '23FA OG PDB PANEL 1 FOR GN7 (FF)': 'ZADS1EM_T19',
  '24FA OG PROCESS MCC (PHASE-1) ONCO FF': 'ZADS1EM_T20',
  '25FA OG UTILITY MCC PANEL-2': 'ZADS1EM_T21',
  '26FA OG GN 6 DEDICATED': 'ZADS1EM_T22',
  '28FA OG GN-3 PDB PANEL-2 L4': 'ZADS1EM_T24',
  '29FA OG PDB ADMIN BLOCK': 'ZADS1EM_T25',
  '30FA OG GN-2 PDB PANEL-5 LINE H1': 'ZADS1EM_T26',
  '31FA OG PDB WARE HOUSE': 'ZADS1EM_T27',
  '32FA OG MLDB PANEL': 'ZADS1EM_T28',
  '33FA OG GN-7 PDB PANEL 5 (C)': 'ZADS1EM_G154',
  '14FA IN DG 1 MAIN': 'ZADS1EM_T14',
  '27FA IN DG 2 MAIN': 'ZADS1EM_T23',
  '37FA IN DG 3 MAIN': 'ZADS1EM_R102',
  '36FA IN TR-3 MAIN': 'ZADS1EM_R101',
  '38FA OG APFCR-3': 'ZADS1EM_R103',
  '39FA OG 66KV SWITCH YARD': 'ZADS1EM_R104',
  '40FA OG ATLAS AIR COMPRESSOR 5': 'ZADS1EM_R105',
  '41FA OG SPARE-1': 'ZADS1EM_R106',
  '42FA OG SPARE-2': 'ZADS1EM_R107',
  '15FA OG APFCR-1': 'ZADS1EM_T155',
  '18FA OG APFCR-2': 'ZADS1EM_T156',
  'IN MLDB MAIN': 'ZADS1EM_E38',
  'OG PMLDB PRODUCTION BLOCK': 'ZADS1EM_E39',
  'OG PMLDB DEDICATED BLOCK': 'ZADS1EM_E41',
  'OG LT ROOM LSDB': 'ZADS1EM_E42',
  'OG PMLDB ADMIN': 'ZADS1EM_E43',
  'OG STREET LIGHT': 'ZADS1EM_E45',
  'IN UTILITY MCC PANEL 1 MAIN': 'ZADS1EM_E29',
  'OG AIR COMPRESSOR 2': 'ZADS1EM_E30',
  'OG 7.5 TON  BOILER-2': 'ZADS1EM_E31',
  'OG CHILLER PANEL TERRACE': 'ZADS1EM_E168',
  'IN UTILITY MCC PANEL 2 MAIN': 'ZADS1EM_E32',
  'OG AIR COMPRESSOR 1': 'ZADS1EM_E33',
  'OG AIR COMPRESSOR 3': 'ZADS1EM_E34',
  'OG BOREWELL DB BOX': 'ZADS1EM_E35',
  'OG RO PLANT': 'ZADS1EM_E36',
  'OG ETP + STP': 'ZADS1EM_E37',
  'IN COOLING TOWER FAN 1 MAIN': 'ZADS1EM_A157',
  'IN COOLING TOWER PUMP 1 MAIN': 'ZADS1EM_A158',
  'IN CHILLER MCC 3 MAIN': 'ZADS1EM_A159',
  'OG NEW AIR DRYER BEKO': 'ZADS1EM_A160',
  'OG CHILLER 3': 'ZADS1EM_A163',
  'IN COOLING TOWER PUMP 2 MAIN': 'ZADS1EM_A161',
  'OG COOLING TOWER PUMP 3': 'ZADS1EM_A164',
  'IN COOLING TOWER FAN 2 MAIN': 'ZADS1EM_A162',
  'IN CHILLER MCC 1 INCOMER': 'ZADS1EM_A49',
  'OG CHILLER 2': 'ZADS1EM_A50',
  'OG CHILED WATER PUMP- 1': 'ZADS1EM_A165',
  'IN CHILLER MCC 2 MAIN': 'ZADS1EM_A47',
  'OG CHILLER 1': 'ZADS1EM_A48',
  'OG CHILED WATER PUMP- 2': 'ZADS1EM_A166',
  'OG CHILED WATER PUMP- 3': 'ZADS1EM_A167',
  'IN GN-6 HVAC MAIN': 'ZADS1EM_D75',
  'IN GN-6 630A PDB MAIN': 'ZADS1EM_D76',
  'IN GN-6 PDB PANEL MAIN': 'ZADS1EM_D74',
  'IN PDB WARE HOUSE MAIN': 'ZADS1EM_P83',
  'OG WARE HOUSE HVAC': 'ZADS1EM_P67',
  'IN GN-5 PDB PANEL-7  L7 MAIN': 'ZADS1EM_P62',
  'OG GN-5 HVAC': 'ZADS1EM_P63',
  'IN GN-7 PDB PANEL 1 FF MAIN': 'ZADS1EM_P84',
  'OG UPS SYSTEM-2': 'ZADS1EM_P85',
  'OG HEAT PUMP-2': 'ZADS1EM_P86',
  'OG WATER SYSTEM': 'ZADS1EM_P87',
  'OG GN7 HVAC+HEAT PUMP': 'ZADS1EM_P88',
  'OG SPARE-3': 'ZADS1EM_P89',
  'IN GN-7 UPS PCC PANEL MAIN': 'ZADS1EM_P90',
  'IN GN-4 PDB PANEL-3 L5 MAIN': 'ZADS1EM_P60',
  'OG GN4 (H5) HVAC': 'ZADS1EM_P61',
  'IN GN-3 PDB PANEL-2 L4 MAIN': 'ZADS1EM_P58',
  'OG GN3 (H4) HVAC': 'ZADS1EM_P59',
  'IN UPS 1 BYPASS': 'ZADS1EM_S91',
  'OG UPS 1 INPUT': 'ZADS1EM_S92',
  'IN UPS 1 OUTPUT': 'ZADS1EM_S93',
  'IN UPS 2 OUTPUT': 'ZADS1EM_S94',
  'IN UPS 2 BYPASS': 'ZADS1EM_S95',
  'OG ATLAS COMPRESSOR 400CFM': 'ZADS1EM_S96',
  'IN UPS 2 INPUT': 'ZADS1EM_S97',
  'IN PDB/ 2ND PKG + TECH AREA MAIN': 'ZADS1EM_P65',
  'IN PDB/ 2ND PKG + TECH AREA AHU MAIN': 'ZADS1EM_P64',
  'OG HEAT PUMP-1': 'ZADS1EM_P66',
  'OG HOT WATER PUMP 1 VFD': 'ZADS1EM_P98',
  'OG HOT WATER PUMP 3': 'ZADS1EM_P99',
  'OG SPARE-4': 'ZADS1EM_P100',
  'IN GN-2 PDB PANEL-6 LINE H2 MAIN': 'ZADS1EM_B56',
  'OG GN-2 (H2) HVAC': 'ZADS1EM_B57',
  'IN GN-2 PMLDB PANEL MAIN': 'ZADS1EM_B58',
  'IN GN-2 PDB PANEL-5 LINE H1 MAIN': 'ZADS1EM_B53',
  'OG GN-2 (H1) HVAC': 'ZADS1EM_B54',
  'IN GN-2 UPS PDB PANEL 1 MAIN': 'ZADS1EM_B55',
  'IN GN-1 PDB PANEL-1 LINE T1 MAIN': 'ZADS1EM_B51',
  'OG GN1 (T1) HVAC': 'ZADS1EM_B52',
  'IN GN-7 PDB PANEL 2 (A) MAIN': 'ZADS1EM_V108',
  'OG GN-7 PDB PANEL 3 (B) SF': 'ZADS1EM_V109',
  'OG GN-7 PDB PANEL 2 (A) HVAC': 'ZADS1EM_V110',
  'IN GN-7 HVAC PANEL 2 (A) MAIN': 'ZADS1EM_V111',
  'IN GN-7 PDB PANEL 5 (C) MAIN': 'ZADS1EM_N117',
  'OG GN-7 PDB PANEL 5 (C) HVAC': 'ZADS1EM_N118',
  'OG GN-7 SPARE-5': 'ZADS1EM_N119',
  'IN GN-7 PDB PANEL 4 (B) MAIN': 'ZADS1EM_N112',
  'OG GN-7 PDB PANEL 4 (B) HVAC': 'ZADS1EM_N113',
  'IN GN-7 PDB PANEL 3 (B) MAIN': 'ZADS1EM_N114',
  'OG GN-7 PDB PANEL 3 (B) HVAC': 'ZADS1EM_N115',
  'IN GN-7 UPS PANEL B SF MAIN': 'ZADS1EM_N116',
  'IN GN-1 SUB PCC PANEL MAIN': 'ZADS1EM_K68',
  'OG OLD ONCO + HVAC': 'ZADS1EM_K69',
  'OG GEN PDB GF': 'ZADS1EM_K70',
  'OG GN PDB BUILDING': 'ZADS1EM_K71',
  'OG GEN UTILITY PANEL- 1': 'ZADS1EM_K72',
  'OG GEN HVAC': 'ZADS1EM_K73',
  'IN PDB ADMIN BLOCK MAIN': 'ZADS1EM_H76',
  'OG PDB ADMIN BLOCK HVAC': 'ZADS1EM_H78',
  'IN ADMIN UPS PANEL MAIN': 'ZADS1EM_H77',
  'IN ONCO PROCESS MCC (PHASE-1) MAIN': 'ZADS1EM_C79',
  'IN ONCO HVAC MCC PANEL MAIN': 'ZADS1EM_C80',
  'IN ONCO MAIN PANEL MAIN': 'ZADS1EM_C170',
  'IN ONCO PDB PANEL MAIN': 'ZADS1EM_C171',
  'IN ONCO AHU PANEL MAIN': 'ZADS1EM_C172',
  'IN ONCO CHILLER PANEL MAIN': 'ZADS1EM_C173',
  'IN ONCO PROCESS CUM HVAC PANEL MAIN': 'ZADS1EM_C201',
  'OG ONCO PROCESS CUM HVAC PANEL HVAC': 'ZADS1EM_C202',
  'IN ONCO UPS PANEL-1 MAIN': 'ZADS1EM_C203',
  'IN 66KV GELLOPS LINE INCOMER': 'ZADS1EM_W1',
  'OG 66KV TRANSFORMER-1': 'ZADS1EM_W2',
  'OG ZLL ONCOLOGY F OG- 1': 'ZADS1EM_W3',
  'OG ALIDAC OG- 2': 'ZADS1EM_W4',
  'IN 11KV INCOMER- 1': 'ZADS1EM_W5',
  'OG 11KV CAPACITOR BANK OG- 3': 'ZADS1EM_W6',
  'OUTGOING- 4': 'ZADS1EM_W7',
  'OG ZLL (ZTL) OG- 5': 'ZADS1EM_W8',
  'IN 11 KV INCOMER- 2': 'ZADS1EM_W9',
  'OUTGOING- 6': 'ZADS1EM_W10',
  'OUTGOING- 7': 'ZADS1EM_W11',
  'OUTGOING- 8': 'ZADS1EM_W12',
  'IN ACDB INCOMER MAIN': 'ZADS1EM_W13',
};

/**
 * The meter's own page on the portal.
 *
 * The config sheet carries this as a fourth "Hyperlink" column, but every one
 * of its 156 rows is this exact string with the devID substituted — checked row
 * by row against the sheet. So it is derived rather than transcribed: a fourth
 * hand-entered column is a fourth thing that can drift out of step with the
 * devID beside it, and this one cannot.
 */
const DEVICE_PAGE = 'https://iosense.io/devices/energycustom';

/**
 * @param {string|null} devID
 * @returns {string|null} the portal URL, or null if there is no meter
 */
export function deviceUrl(devID) {
  return devID ? `${DEVICE_PAGE}?devID=${encodeURIComponent(devID)}` : null;
}

/* Built once so lookup does not re-normalise 156 keys per card. */
const BY_NAME = new Map(
  Object.entries(DEVICE_IDS).map(([name, devID]) => [norm(name), devID])
);

/**
 * The devID for one card, or `null` if this card has no meter in the register.
 * @param {{title: string}} card
 * @returns {string|null}
 */
export function deviceIdFor(card) {
  const title = card && card.title;
  return BY_NAME.get(norm(ALIASES[title] || title)) || null;
}

/**
 * Resolve every card, and report what did not land.
 * @param {Array<{id: string, title: string}>} cards
 * @returns {{map: Record<string, string>, report: Array<object>}}
 */
export function resolveDevices(cards) {
  const map = {};
  const report = cards.map((card) => {
    const devID = deviceIdFor(card);
    if (devID) map[card.id] = devID;
    return {
      cardId: card.id,
      title: card.title,
      devID,
      source: devID ? (ALIASES[card.title] ? 'alias' : 'register') : 'unmapped',
    };
  });
  return { map, report };
}
