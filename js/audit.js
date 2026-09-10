/**
 * Audit sheet.
 *
 * The canvas shows three numbers per card and nothing about where they came
 * from. This is the other half: every meter the page knows about, the devID it
 * resolved to, the channel id behind each metric, and — for kWh — the two
 * datapoints the figure is the difference of. It is a checking tool, so it
 * shows what is missing as plainly as what is present.
 *
 * Deliberately quiet. The trigger is a grey glyph in the corner of the canvas
 * and the sheet is behind a password, because this is for the handful of people
 * commissioning the site, not for the operations display it sits on top of.
 *
 * Owns nothing but its own overlay: the data comes from `live.js` through
 * `auditSnapshot()`, and the diagram underneath is never touched.
 */

import { deviceUrl } from './device-map.js';

/** Case-insensitive, so nobody is locked out by a caps-lock key. */
const PASSWORD = 'ZYDUS';

/** Unlock lasts the tab session — reopening the sheet should not re-ask. */
const UNLOCK_KEY = 'sld.audit.unlocked';

/** Readings and register values, to match the cards. */
const DECIMALS = 3;

/* Which rows the filter chips keep. Predicates rather than a switch so a new
   chip is one entry, and so the counts beside each label come from the same
   test that does the filtering. */
const FILTERS = {
  all: () => true,
  unmapped: (row) => !row.devID,
  offline: (row) => row.status === 'offline',
  fault: (row) => row.status === 'fault',
  nokwh: (row) => Boolean(row.devID) && !row.kwh,
  offdiagram: (row) => !row.onDiagram,
};

const FILTER_LABELS = {
  all: 'All',
  unmapped: 'Unmapped',
  offline: 'Offline',
  fault: 'Fault',
  nokwh: 'No kWh',
  offdiagram: 'Not on diagram',
};

const ui = {
  root: null,       // the overlay, built once on first open
  snapshot: null,
  filter: 'all',
  query: '',
};

/**
 * What the sheet shows before — or without — a live layer to read.
 *
 * A complete snapshot rather than a bare `{rows: []}`: the sheet renders its
 * summary line from these fields, and "0/0 cards mapped" is a truthful answer
 * where `undefined/undefined` is a bug report.
 */
const EMPTY = {
  at: Date.now(),
  rows: [],
  mapped: 0,
  cards: 0,
  register: 0,
  kwhCovered: 0,
  kwhProblem: null,
  connected: false,
};

/** Set by `setAuditSource`, so this module never imports live.js itself. */
let readSnapshot = () => ({ ...EMPTY, at: Date.now() });

/* ---- formatting ---------------------------------------------------
   Everything here returns a string for the cell and never throws: a sheet
   whose job is to expose gaps must be able to render a row that is mostly
   gaps. `null` is drawn as an em dash, styled faint. */

const DASH = '—';

function num(value, decimals = DECIMALS) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(decimals);
}

function clockOf(input) {
  if (input === null || input === undefined) return null;
  const at = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** A cell: the value, or a faint dash when there is nothing to show. */
function cell(value, className = '') {
  const classes = ['audit__cell', className, value === null ? 'is-empty' : '']
    .filter(Boolean)
    .join(' ');
  return `<td class="${classes}">${value === null ? DASH : escapeHtml(value)}</td>`;
}

/** The devID cell, linked to that meter's page — the sheet's Hyperlink column. */
function deviceCell(devID) {
  if (!devID) return cell(null, 'audit__cell--id');
  return (
    `<td class="audit__cell audit__cell--id"><a class="audit__link" ` +
    `href="${escapeHtml(deviceUrl(devID))}" target="_blank" rel="noopener noreferrer">` +
    `${escapeHtml(devID)}</a></td>`
  );
}

/* ---- rows ---------------------------------------------------------- */

function matches(row) {
  if (!FILTERS[ui.filter](row)) return false;
  if (!ui.query) return true;
  const needle = ui.query.toLowerCase();
  return (
    String(row.title).toLowerCase().includes(needle) ||
    String(row.devID || '').toLowerCase().includes(needle)
  );
}

function rowMarkup(row, index) {
  const s = row.sensors || {};
  const kwh = row.kwh;

  /* The status column carries the same three states the cards use, plus
     `unmapped` for a card with no meter behind it at all. */
  const state = row.devID ? row.status : 'unmapped';

  return (
    `<tr class="audit__row audit__row--${state}${row.onDiagram ? '' : ' audit__row--offdiagram'}">` +
    `<td class="audit__cell audit__cell--index">${index}</td>` +
    cell(row.title, 'audit__cell--title') +
    deviceCell(row.devID) +
    cell(row.devID ? s.PF : null, 'audit__cell--chan') +
    cell(row.devID ? s.kW : null, 'audit__cell--chan') +
    cell(row.devID ? s.kWh : null, 'audit__cell--chan') +
    cell(row.devID ? s.fault : null, 'audit__cell--chan') +
    cell(s.rssi || null, 'audit__cell--chan') +
    cell(s.status || null, 'audit__cell--chan') +
    cell(row.pf ? num(row.pf.value) : null, 'audit__cell--num') +
    cell(row.kw ? num(row.kw.value) : null, 'audit__cell--num') +
    /* The three the sheet exists for: what was subtracted from what. */
    cell(kwh ? num(kwh.first) : null, 'audit__cell--num') +
    cell(kwh ? clockOf(kwh.firstAt) : null, 'audit__cell--time') +
    cell(kwh ? num(kwh.last) : null, 'audit__cell--num') +
    cell(kwh ? clockOf(kwh.lastAt) : null, 'audit__cell--time') +
    cell(kwh ? num(kwh.consumption) : null, 'audit__cell--num audit__cell--kwh') +
    cell(kwh ? String(kwh.points) : null, 'audit__cell--num audit__cell--faint') +
    `<td class="audit__cell audit__cell--state"><span class="audit__tag audit__tag--${state}">${state}</span></td>` +
    cell(clockOf(row.newest), 'audit__cell--time') +
    `</tr>`
  );
}

function renderTable() {
  const body = ui.root.querySelector('#auditBody');
  const rows = ui.snapshot.rows.filter(matches);

  body.innerHTML = rows.length
    ? rows.map((row, i) => rowMarkup(row, i + 1)).join('')
    : `<tr><td class="audit__none" colspan="19">No meters match this filter.</td></tr>`;

  ui.root.querySelector('#auditShown').textContent = rows.length === ui.snapshot.rows.length
    ? `${rows.length} meters`
    : `${rows.length} of ${ui.snapshot.rows.length} meters`;
}

function renderChips() {
  const host = ui.root.querySelector('#auditFilters');
  host.innerHTML = Object.entries(FILTER_LABELS)
    .map(([key, label]) => {
      const count = ui.snapshot.rows.filter(FILTERS[key]).length;
      const on = key === ui.filter;
      /* A filter that would show nothing is disabled rather than hidden, so
         "no offline meters" reads as a fact rather than a missing control. */
      return (
        `<button type="button" class="audit__chip${on ? ' is-on' : ''}" ` +
        `data-filter="${key}"${count ? '' : ' disabled'} aria-pressed="${on}">` +
        `${label}<span class="audit__chip-count">${count}</span></button>`
      );
    })
    .join('');
}

function renderMeta() {
  const s = ui.snapshot;
  const parts = [
    `${s.mapped}/${s.cards} cards mapped`,
    `${s.register} meters in register`,
    `kWh loaded for ${s.kwhCovered}`,
  ];
  if (!s.connected) parts.push('not connected — register only');
  if (s.kwhProblem) parts.push(s.kwhProblem);

  ui.root.querySelector('#auditMeta').textContent = parts.join(' · ');
  ui.root.querySelector('#auditTaken').textContent = `Snapshot ${clockOf(s.at)}`;
}

/** Re-read from the live layer and redraw everything that depends on it. */
function refresh() {
  ui.snapshot = readSnapshot();
  renderMeta();
  renderChips();
  renderTable();
}

/* ---- CSV ------------------------------------------------------------
   The exported file is the raw snapshot, not what is on screen: unrounded
   values and ISO timestamps, so a spreadsheet can re-do the subtraction and
   get the same answer. Only the filter is honoured, because filtering to the
   rows you care about and then exporting is the obvious thing to want. */

const CSV_HEADERS = [
  'Meter', 'Device ID', 'On diagram',
  'PF channel', 'kW channel', 'kWh channel', 'Fault channel', 'RSSI channel', 'Status channel',
  'PF', 'kW',
  'kWh first DP', 'kWh first DP at', 'kWh last DP', 'kWh last DP at', 'kWh', 'kWh points',
  'State', 'Last reading at',
  /* The config sheet's own Hyperlink column, so an exported row is directly
     comparable with the register it came from. */
  'Device page',
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows() {
  return ui.snapshot.rows.filter(matches).map((row) => {
    const s = row.sensors || {};
    const kwh = row.kwh;
    return [
      row.title,
      row.devID,
      row.onDiagram ? 'yes' : 'no',
      row.devID ? s.PF : null,
      row.devID ? s.kW : null,
      row.devID ? s.kWh : null,
      row.devID ? s.fault : null,
      s.rssi,
      s.status,
      row.pf ? row.pf.value : null,
      row.kw ? row.kw.value : null,
      kwh ? kwh.first : null,
      kwh ? kwh.firstAt : null,
      kwh ? kwh.last : null,
      kwh ? kwh.lastAt : null,
      kwh ? kwh.consumption : null,
      kwh ? kwh.points : null,
      row.devID ? row.status : 'unmapped',
      row.newest ? new Date(row.newest).toISOString() : null,
      deviceUrl(row.devID),
    ];
  });
}

function downloadCsv() {
  const lines = [CSV_HEADERS, ...csvRows()].map((cells) =>
    cells.map(csvCell).join(',')
  );
  /* A BOM, or Excel reads the meter names as Latin-1. */
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(ui.snapshot.at)
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, '-');

  const a = document.createElement('a');
  a.href = url;
  a.download = `zydus-sez1-audit-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---- the overlay ---------------------------------------------------- */

const SHEET_MARKUP = `
<div class="audit__backdrop" data-close></div>
<section class="audit__panel" role="dialog" aria-modal="true" aria-labelledby="auditTitle">

  <form class="audit__gate" id="auditGate">
    <h2 class="audit__gate-title">Audit sheet</h2>
    <p class="audit__gate-note">Enter the password to continue.</p>
    <input class="audit__gate-input" id="auditPassword" type="password"
           placeholder="Password" autocomplete="off" spellcheck="false"
           aria-label="Audit sheet password" />
    <p class="audit__gate-error" id="auditError" role="alert" hidden>Incorrect password.</p>
    <div class="audit__gate-actions">
      <button type="button" class="audit__btn" data-close>Cancel</button>
      <button type="submit" class="audit__btn audit__btn--primary">Unlock</button>
    </div>
  </form>

  <div class="audit__sheet" id="auditSheet" hidden>
    <header class="audit__head">
      <div class="audit__head-lead">
        <h2 class="audit__title" id="auditTitle">Audit sheet</h2>
        <span class="audit__meta" id="auditMeta"></span>
      </div>
      <div class="audit__head-tools">
        <span class="audit__taken" id="auditTaken"></span>
        <button type="button" class="audit__btn" id="auditRefresh">Refresh</button>
        <button type="button" class="audit__btn" id="auditCsv">Export CSV</button>
        <button type="button" class="audit__btn audit__btn--close" data-close>
          <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3 11 11M11 3 3 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          Close
        </button>
      </div>
    </header>

    <div class="audit__controls">
      <input class="audit__search" id="auditSearch" type="search"
             placeholder="Filter by meter name or device ID…"
             autocomplete="off" spellcheck="false" aria-label="Filter meters" />
      <div class="audit__chips" id="auditFilters"></div>
      <span class="audit__shown" id="auditShown"></span>
    </div>

    <div class="audit__scroll">
      <table class="audit__table">
        <thead>
          <tr class="audit__group">
            <th colspan="3">Meter</th>
            <th colspan="6" class="audit__group--sep">Sensor IDs</th>
            <th colspan="2" class="audit__group--sep">Live reading</th>
            <th colspan="6" class="audit__group--sep">kWh since 00:00 IST</th>
            <th colspan="2" class="audit__group--sep">Health</th>
          </tr>
          <tr>
            <th class="audit__cell--index">#</th>
            <th>Meter</th>
            <th>Device ID</th>
            <th class="audit__group--sep">PF</th>
            <th>kW</th>
            <th>kWh</th>
            <th>Fault</th>
            <th>RSSI</th>
            <th>Status</th>
            <th class="audit__group--sep">PF</th>
            <th>kW</th>
            <th class="audit__group--sep">First DP</th>
            <th>at</th>
            <th>Last DP</th>
            <th>at</th>
            <th>kWh</th>
            <th>Pts</th>
            <th class="audit__group--sep">State</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody id="auditBody"></tbody>
      </table>
    </div>

    <p class="audit__foot">
      kWh is the last D30 datapoint minus the first, over the cycle that began
      at 00:00 IST. A blank kWh usually means the rotating refresh has not
      reached that meter yet. Press <kbd>Esc</kbd>, or click outside the sheet,
      to close.
    </p>
  </div>
</section>`;

function unlocked() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    /* Private browsing can refuse storage entirely; the password still works,
       it just gets asked for again on the next open. */
    return false;
  }
}

function rememberUnlock() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* Not worth failing the unlock over. */
  }
}

/**
 * Show one of the panel's two faces and hide the other.
 *
 * The gate and the sheet share a panel that has to be narrow for one and wide
 * for the other, so the width class is set from the same call that decides
 * which is showing — never inferred from the DOM afterwards.
 */
function showFace(face) {
  const gate = face === 'gate';
  ui.root.querySelector('#auditGate').hidden = !gate;
  ui.root.querySelector('#auditSheet').hidden = gate;
  ui.root.querySelector('.audit__panel').classList.toggle('audit__panel--gate', gate);
}

function showSheet() {
  showFace('sheet');
  refresh();
  ui.root.querySelector('#auditSearch').focus();
}

function showGate() {
  showFace('gate');
  ui.root.querySelector('#auditError').hidden = true;
  const input = ui.root.querySelector('#auditPassword');
  input.value = '';
  input.focus();
}

function close() {
  if (!ui.root) return;
  ui.root.hidden = true;
  document.body.classList.remove('audit-is-open');
  const trigger = document.getElementById('auditOpen');
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }
}

function build() {
  const root = document.createElement('div');
  root.className = 'audit';
  root.id = 'audit';
  root.hidden = true;
  root.innerHTML = SHEET_MARKUP;
  document.body.appendChild(root);
  ui.root = root;

  /* One listener for every close affordance — backdrop, cancel, the × — so
     adding another is a `data-close` attribute and nothing else. */
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  root.querySelector('#auditGate').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#auditPassword');
    if (input.value.trim().toUpperCase() === PASSWORD) {
      rememberUnlock();
      showSheet();
      return;
    }
    root.querySelector('#auditError').hidden = false;
    input.select();
  });

  root.querySelector('#auditRefresh').addEventListener('click', refresh);
  root.querySelector('#auditCsv').addEventListener('click', downloadCsv);

  root.querySelector('#auditSearch').addEventListener('input', (e) => {
    ui.query = e.target.value.trim();
    renderTable();
  });

  root.querySelector('#auditFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    ui.filter = chip.dataset.filter;
    renderChips();
    renderTable();
  });

  /* Escape closes from anywhere in the sheet, including the password field. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) {
      e.stopPropagation();
      close();
    }
  });

  return root;
}

function open() {
  if (!ui.root) build();
  ui.root.hidden = false;
  /* The canvas listens on the window for drag and wheel; locking the body
     scroll keeps the page itself still while the sheet is up. */
  document.body.classList.add('audit-is-open');

  const trigger = document.getElementById('auditOpen');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');

  if (unlocked()) showSheet();
  else showGate();
}

/**
 * Point the sheet at the live layer.
 *
 * Separate from `initAudit` on purpose: the button is wired as soon as the
 * diagram is drawn, but `live.js` is loaded lazily and may never arrive. The
 * sheet opens either way — it just has nothing to report until this is called.
 *
 * @param {() => object} snapshot reads the current live-layer snapshot
 */
export function setAuditSource(snapshot) {
  readSnapshot = snapshot;
  /* If the sheet is already open when live data lands, show it rather than
     making the reader press Refresh. */
  if (ui.root && !ui.root.hidden && !ui.root.querySelector('#auditSheet').hidden) {
    refresh();
  }
}

/** Wire the corner glyph to the sheet. */
export function initAudit() {
  const trigger = document.getElementById('auditOpen');
  if (!trigger) return;
  trigger.addEventListener('click', open);
}
