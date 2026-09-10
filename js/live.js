/**
 * Live readings.
 *
 * Owns the whole path from "the reader arrived with an SSO token" to "this
 * card shows 312.40 kW", and nothing about how a card is drawn — the DOM stays
 * app.js's, reached through the hooks passed to `initLiveData`.
 *
 * Each cycle makes two calls:
 *   getLastDPsofDevicesAndSensorCalibrated — PF and kW, instantaneous
 *   getAutoDownSampledData                 — D30 series since 00:00 IST; its
 *                                            last minus first point is kWh
 */

import { ApiError, clearToken, request } from '../iosense-sdk/api.js';
import { PORTAL_URL, ensureAuth } from '../iosense-sdk/auth.js';
import {
  AUTOSAMPLE_CHUNK,
  buildConsumptionBody,
  consumptionOf,
  fetchAllDevices,
  fetchCycleConsumption,
  fetchLatestReadings,
  isRateLimited,
} from '../iosense-sdk/devices.js';
import {
  DEVICE_IDS,
  FAULT_SENSOR,
  SENSORS,
  resolveDevices,
  resolveLinkSensors,
} from './device-map.js';

/** How often the readings are refreshed. */
const POLL_MS = 30_000;

/** No reading newer than this and the meter counts as offline. */
const STALE_MS = 5 * 60_000;

/** The site runs on IST; the consumption cycle turns over at local midnight. */
const TIMEZONE = 'Asia/Calcutta';
const CYCLE_TIME = '00:00';

/* The metrics a card carries, in the order they are drawn. */
const METRICS = ['PF', 'kW', 'kWh'];

/** Decimal places on every reading. */
const DECIMALS = 3;

/* ---- consumption pacing -------------------------------------------------
   The connector rate-limits by *device count over a rolling window*, not by
   request count: "Device rate limit exceeded: 100 of 100 devices already
   requested". Asking for all 151 meters every 30s is roughly 300 devices a
   minute and blows straight through it.

   So consumption runs on its own slower cycle, refreshing one batch of meters
   at a time and rotating through the rest. A figure measured since midnight
   does not need 30-second resolution, and every card keeps its last value
   between refreshes. */

/** Meters per consumption request — also the endpoint's hard per-request cap. */
const CONSUMPTION_BATCH = AUTOSAMPLE_CHUNK;

/** Never shrink a batch below this, or a full rotation takes all day. */
const CONSUMPTION_MIN_BATCH = 20;

/** Gap between consumption batches. 100 meters / 90s ≈ 67 a minute. */
const CONSUMPTION_POLL_MS = 90_000;

/** Backoff ceiling when the connector says we are still over the limit. */
const CONSUMPTION_MAX_MS = 15 * 60_000;

const state = {
  cards: [],            // [{ id, uid, title }]
  hooks: null,
  cardToDev: new Map(), // cardId → devID
  linkSensors: new Map(), // devID → { rssi, status } channel ids
  latest: new Map(),    // `${devID}|${sensor}` → { value, unit, at }
  consumption: new Map(), // devID → { consumption, first, last, points }
  report: [],
  kwhProblem: null,
  kwhDetail: '',
  timer: null,
  consumptionTimer: null,
  /* Where the rotating consumption refresh has got to, and how long it is
     currently waiting between batches. */
  consumptionCursor: 0,
  consumptionInterval: CONSUMPTION_POLL_MS,
  consumptionBatch: CONSUMPTION_BATCH,
  controller: null,
  started: false,
};

/** The reading for one channel, or undefined. */
const readingOf = (devID, sensor) =>
  sensor ? state.latest.get(`${devID}|${sensor}`) : undefined;

/**
 * What colour a card should be.
 *
 * Offline outranks faulted: a meter that is not talking cannot be trusted to
 * report a meaningful D6 either, so its last stale D6 must not paint the card
 * red as though it were a live fault.
 *
 * @returns {'offline'|'fault'|'ok'}
 */
function cardStatus(devID, newest, now) {
  const link = state.linkSensors.get(devID) || {};
  const rssi = readingOf(devID, link.rssi);
  const status = readingOf(devID, link.status);

  /* The device says so itself — only trustworthy when both channels resolved
     and both actually reported. */
  const saysOffline =
    rssi !== undefined &&
    status !== undefined &&
    Number(rssi.value) === -1 &&
    Number(status.value) === 0;

  /* Nothing arriving at all. A meter whose link drops entirely stops sending
     RSSI too, so this is what catches a dead device. */
  const silent = !newest || now - newest > STALE_MS;

  if (saysOffline || silent) return 'offline';

  const fault = readingOf(devID, FAULT_SENSOR);
  /* Absent D6 is not a fault: NaN < 1 is false, but say it explicitly. */
  if (fault !== undefined && Number(fault.value) < 1) return 'fault';

  return 'ok';
}

/** Fixed to DECIMALS places, but never turning a genuine 0 into a blank. */
function formatValue(value) {
  if (value === null || value === undefined) return null;
  /* Values can arrive as strings, so coerce before formatting. */
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(DECIMALS);
}

/** Every device on the diagram, once. */
function mappedDevices() {
  return [...new Set(state.cardToDev.values())];
}

/** Push the newest reading for every card into the DOM. */
function applyToCards() {
  const now = Date.now();

  for (const card of state.cards) {
    const devID = state.cardToDev.get(card.id);

    const values = {};
    let newest = 0;
    let anyReading = false;

    for (const metric of METRICS) {
      let value = null;

      if (devID) {
        if (metric === 'kWh') {
          /* Consumption since 00:00: the last D30 datapoint minus the first,
             taken from the downsampled series. */
          const computed = state.consumption.get(devID);
          value = computed ? formatValue(computed.consumption) : null;
        } else {
          const reading = state.latest.get(`${devID}|${SENSORS[metric]}`);
          value = reading ? formatValue(reading.value) : null;
        }
      }
      values[metric] = value;
      if (value !== null) anyReading = true;
    }

    /* Freshness comes from the instantaneous channels — including D30, which is
       requested for its own value and timestamp: it is both the current meter
       reading and proof the energy channel is alive. */
    if (devID) {
      const link = state.linkSensors.get(devID) || {};
      const channels = [
        ...Object.values(SENSORS),
        FAULT_SENSOR,
        link.rssi,
        link.status,
      ];
      /* Any channel reporting proves the meter is talking, so freshness looks
         at all of them, not only the three that are displayed. */
      for (const sensor of channels) {
        const reading = readingOf(devID, sensor);
        if (reading && reading.at > newest) newest = reading.at;
      }
    }

    /* An offline card greys whole — background, border and meter icon — and a
       faulted one turns red, but either way the last known values stay on
       show: the reading is the useful thing, the colour is what qualifies it. */
    const status = devID ? cardStatus(devID, newest, now) : 'offline';

    state.hooks.applyCard(card.uid, {
      values,
      status,
      unmapped: !devID,
      at: newest || null,
    });
  }
}

/** One readings cycle: PF, kW and the channels that decide card colour. */
async function refresh() {
  const devices = mappedDevices();
  if (!devices.length) {
    applyToCards();
    return;
  }

  /* Every channel in one batched call: the three displayed ones (D30 for its
     timestamp only), the fault channel, and whichever link channels resolved. */
  const pairs = devices.flatMap((devID) => {
    const link = state.linkSensors.get(devID) || {};
    const sensors = [
      ...Object.values(SENSORS),
      FAULT_SENSOR,
      link.rssi,
      link.status,
    ];
    return [...new Set(sensors.filter(Boolean))].map((sensor) => ({
      devID,
      sensor,
    }));
  });

  const rows = await fetchLatestReadings(pairs, {
    signal: state.controller.signal,
  });
  for (const row of rows) {
    if (!row || !row.devID || !row.sensor) continue;
    const at = row.time ? Date.parse(row.time) : NaN;
    state.latest.set(`${row.devID}|${row.sensor}`, {
      value: row.value,
      unit: row.unit || '',
      at: Number.isNaN(at) ? 0 : at,
    });
  }

  applyToCards();
  reportStatus();
}

/**
 * One consumption batch.
 *
 * Refreshes the next `CONSUMPTION_BATCH` meters and rotates on, so the device
 * rate limit is respected by asking for fewer meters less often rather than by
 * retrying. Results are merged, never replaced — a card keeps its last kWh
 * until its own turn comes round again.
 */
async function refreshConsumption() {
  const devices = mappedDevices();
  if (!devices.length) return;

  const start = state.consumptionCursor % devices.length;
  const size = Math.min(state.consumptionBatch, devices.length);
  const batch = [];
  for (let i = 0; i < size; i++) {
    batch.push(devices[(start + i) % devices.length]);
  }

  let result;
  try {
    result = await fetchCycleConsumption(
      batch.map((devID) => ({ devID, sensor: SENSORS.kWh })),
      {
        timezone: TIMEZONE,
        cycleTime: CYCLE_TIME,
        signal: state.controller.signal,
      }
    );
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (err instanceof ApiError && err.isAuthFailure) throw err;

    const said = err && err.message ? String(err.message) : '';

    if (isRateLimited(err)) {
      /* Still over the connector's device budget. Back off on both axes: wait
         longer AND ask for fewer meters. Lengthening the wait alone cannot
         help if the budget per window is smaller than one batch — that would
         retry the same impossible request forever. */
      state.consumptionInterval = Math.min(
        state.consumptionInterval * 2,
        CONSUMPTION_MAX_MS
      );
      state.consumptionBatch = Math.max(
        CONSUMPTION_MIN_BATCH,
        Math.floor(state.consumptionBatch / 2)
      );
      scheduleConsumption();
      const wait = Math.round(state.consumptionInterval / 1000);
      state.kwhProblem = `kWh: rate limited, retrying ${state.consumptionBatch} meters in ${wait}s`;
      state.kwhDetail = said;
      console.warn(
        `[sld] device rate limit hit. Next batch: ${state.consumptionBatch} ` +
          `meters in ${wait}s.\n      ${said}`
      );
      reportStatus();
      return;
    }

    const transport = err instanceof ApiError && err.status >= 400;
    const short = said.length > 64 ? `${said.slice(0, 63)}…` : said;
    state.kwhProblem = transport
      ? `kWh unavailable (HTTP ${err.status})`
      : `kWh: ${short || 'request rejected'}`;
    state.kwhDetail = said;
    console.error(
      '[sld] PUT /account/widget/getAutoDownSampledData was rejected.\n' +
        `      message: ${said}\n` +
        '      response body and request below.',
      err && err.body,
      err
    );
    reportStatus();
    return;
  }

  /* Merge, so meters outside this batch keep the value they already have. */
  for (const [devID, computed] of result) state.consumption.set(devID, computed);

  /* A clean batch means the pacing is working. Ease back gently — restoring
     the full rate in one step would just trip the limit again. */
  if (state.consumptionBatch < CONSUMPTION_BATCH) {
    state.consumptionBatch = Math.min(
      CONSUMPTION_BATCH,
      Math.ceil(state.consumptionBatch * 1.5)
    );
  } else if (state.consumptionInterval !== CONSUMPTION_POLL_MS) {
    state.consumptionInterval = Math.max(
      CONSUMPTION_POLL_MS,
      Math.floor(state.consumptionInterval / 2)
    );
    scheduleConsumption();
  }

  state.consumptionCursor = (start + batch.length) % devices.length;
  state.kwhProblem = state.consumption.size
    ? null
    : 'kWh: no D30 series returned';
  state.kwhDetail = '';

  if (!result.size) {
    console.warn(
      '[sld] a consumption batch returned no usable D30 series. Raw payload ' +
        'below — run __sldDiagnose(devID) for one of its devices.',
      result.lastPayload
    );
  }

  applyToCards();
  reportStatus();
}

/** Tell the header where things stand. */
function reportStatus() {
  state.hooks.onStatus({
    kind: 'live',
    at: Date.now(),
    mapped: state.cardToDev.size,
    total: state.cards.length,
    problem: state.kwhProblem,
    detail: state.kwhDetail,
  });
}

/**
 * Read the RSSI and Status channel ids off the catalogue, once at boot.
 *
 * Unlike D1/D3/D30/D6 these were never pinned to fixed ids, so they are found
 * by name per device. A failure here is not fatal: without them the offline
 * test falls back to the reading-age rule alone.
 */
async function resolveLinkChannels() {
  try {
    const catalogue = await fetchAllDevices({ signal: state.controller.signal });
    const byId = new Map(catalogue.map((d) => [d.devID, d]));

    let missing = 0;
    for (const devID of mappedDevices()) {
      const device = byId.get(devID);
      if (!device) continue;
      const link = resolveLinkSensors(device);
      state.linkSensors.set(devID, link);
      if (!link.rssi || !link.status) missing++;
    }

    if (missing) {
      console.warn(
        `[sld] ${missing} devices have no RSSI/Status channel; those cards fall ` +
          'back to the 5-minute reading-age rule for offline. ' +
          'Run __sldChannels(devID) to see what they do expose.'
      );
    }
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    console.warn(
      '[sld] could not read the device catalogue; offline detection falls back ' +
        'to the 5-minute reading-age rule.',
      err
    );
  }
}

function stopPolling() {
  if (state.timer) clearInterval(state.timer);
  if (state.consumptionTimer) clearTimeout(state.consumptionTimer);
  state.timer = null;
  state.consumptionTimer = null;
}

/**
 * Arm the next consumption batch.
 *
 * A timeout rather than an interval, because the gap changes: it doubles while
 * the connector is rate-limiting and drops back once a batch succeeds.
 */
function scheduleConsumption() {
  if (state.consumptionTimer) clearTimeout(state.consumptionTimer);
  state.consumptionTimer = setTimeout(() => {
    if (document.hidden) {
      scheduleConsumption();
      return;
    }
    refreshConsumption()
      .catch(handleCycleError)
      .finally(() => {
        /* Only re-arm if a rate-limit path has not already done so. */
        if (!state.consumptionTimer) scheduleConsumption();
      });
    state.consumptionTimer = null;
  }, state.consumptionInterval);
}

function startPolling() {
  stopPolling();
  state.timer = setInterval(() => {
    /* A hidden tab is nobody's operations display — stop asking. */
    if (document.hidden) return;
    refresh().catch(handleCycleError);
  }, POLL_MS);
  scheduleConsumption();
}

function handleCycleError(err) {
  if (err && err.name === 'AbortError') return;

  if (err instanceof ApiError && err.isAuthFailure) {
    /* No refresh path exists: the JWT is dead and only the portal can mint a
       new one. Drop it so a reload does not retry with the same dead token. */
    clearToken();
    stopPolling();
    state.hooks.onStatus({ kind: 'unauthenticated', message: 'Session expired' });
    return;
  }
  console.error('[sld] live data refresh failed', err);
  state.hooks.onStatus({
    kind: 'error',
    message: (err && err.message) || 'Could not reach IOsense',
  });
}

/**
 * One flat row per meter, for the audit sheet.
 *
 * Everything the live layer knows about a device, unrounded and unformatted:
 * which devID a card resolved to, which channel id each metric is read from,
 * and — for kWh — the two datapoints the figure is a subtraction of. The sheet
 * exists to answer "where did that number come from", so nothing is smoothed
 * over here: a channel that never resolved comes back `null` rather than as a
 * plausible-looking default, and formatting is left to the caller.
 *
 * Rows cover the register, not just the diagram: the six meters that exist on
 * site but were never drawn are included with `onDiagram: false`, because a
 * meter missing from the canvas is exactly the kind of thing an audit is for.
 *
 * Safe to call before — or without — a live session; the register half is
 * static, and the reading columns simply come back empty.
 */
export function auditSnapshot() {
  const now = Date.now();

  const channels = (devID) => {
    const link = state.linkSensors.get(devID) || {};
    return {
      PF: SENSORS.PF,
      kW: SENSORS.kW,
      kWh: SENSORS.kWh,
      fault: FAULT_SENSOR,
      rssi: link.rssi || null,
      status: link.status || null,
    };
  };

  const reading = (devID, sensor) => {
    const hit = readingOf(devID, sensor);
    if (!hit) return null;
    return { value: hit.value, unit: hit.unit, at: hit.at || null };
  };

  /* Newest timestamp across every channel — the same measure the card colour
     is decided on, so the sheet and the canvas can never disagree. */
  const newestOf = (devID) => {
    let newest = 0;
    for (const sensor of Object.values(channels(devID))) {
      const hit = readingOf(devID, sensor);
      if (hit && hit.at > newest) newest = hit.at;
    }
    return newest;
  };

  const rowFor = (devID, title, onDiagram) => {
    if (!devID) {
      return {
        title,
        devID: null,
        onDiagram,
        sensors: null,
        pf: null,
        kw: null,
        kwh: null,
        newest: null,
        status: 'unmapped',
      };
    }
    const newest = newestOf(devID);
    return {
      title,
      devID,
      onDiagram,
      sensors: channels(devID),
      pf: reading(devID, SENSORS.PF),
      kw: reading(devID, SENSORS.kW),
      /* The whole subtraction, not just its result: first, last, both
         timestamps and the point count behind them. */
      kwh: state.consumption.get(devID) || null,
      newest: newest || null,
      status: cardStatus(devID, newest, now),
    };
  };

  const rows = state.cards.map((card) =>
    rowFor(state.cardToDev.get(card.id) || null, card.title, true)
  );

  /* Register entries no card resolved to. */
  const drawn = new Set(state.cardToDev.values());
  for (const [name, devID] of Object.entries(DEVICE_IDS)) {
    if (!drawn.has(devID)) rows.push(rowFor(devID, name, false));
  }

  return {
    at: now,
    rows,
    mapped: state.cardToDev.size,
    cards: state.cards.length,
    register: Object.keys(DEVICE_IDS).length,
    /* How far the rotating kWh refresh has got: a blank kWh cell on a healthy
       meter usually means its turn has not come round yet, not a failure. */
    kwhCovered: state.consumption.size,
    kwhProblem: state.kwhProblem,
    connected: state.started && Boolean(state.timer),
    timezone: TIMEZONE,
    cycleTime: CYCLE_TIME,
  };
}

/**
 * Console helpers.
 *
 * `__sldDeviceMap()` prints what each card resolved to. `__sldVerifyDevices()`
 * is the safety net on the hand-entered register: it pulls the real catalogue
 * and reports any devID that does not exist, or whose device name disagrees
 * with the card title. It is opt-in because it costs a full catalogue fetch.
 */
function installHelpers() {
  window.__sldDeviceMap = () => {
    const unmapped = state.report.filter((r) => r.source === 'unmapped');
    console.log(
      state.report.filter((r) => r.devID).length +
        ` of ${state.report.length} cards mapped` +
        (unmapped.length ? `; unmapped: ${unmapped.map((r) => r.title).join(', ')}` : '')
    );
    return state.report;
  };

  window.__sldVerifyDevices = async () => {
    const catalogue = await fetchAllDevices();
    const byId = new Map(catalogue.map((d) => [d.devID, d]));
    const problems = [];

    for (const row of state.report) {
      if (!row.devID) {
        problems.push({ ...row, problem: 'no devID in register' });
        continue;
      }
      const device = byId.get(row.devID);
      if (!device) {
        problems.push({ ...row, problem: 'devID not in catalogue' });
        continue;
      }
      const a = String(device.devName || '').replace(/\s+/g, ' ').trim().toUpperCase();
      const b = row.title.replace(/\s+/g, ' ').trim().toUpperCase();
      if (a !== b && row.source !== 'alias') {
        problems.push({ ...row, devName: device.devName, problem: 'name mismatch' });
      }
    }

    console.log(
      problems.length
        ? `${problems.length} problem(s):`
        : `All ${state.report.filter((r) => r.devID).length} devices verified against the catalogue.`
    );
    if (problems.length) console.table(problems);
    return problems;
  };

  /**
   * What each channel on a device is actually called, straight from the
   * catalogue — the authoritative answer to "is D1 power or power factor?".
   * Accepts a devID or any part of a card title.
   */
  window.__sldChannels = async (query) => {
    const catalogue = await fetchAllDevices();
    const needle = String(query || '').toUpperCase();
    const device =
      catalogue.find((d) => d.devID === query) ||
      catalogue.find((d) => String(d.devName || '').toUpperCase().includes(needle));

    if (!device) {
      console.warn(`[sld] no device matching "${query}"`);
      return null;
    }
    const rows = (device.sensors || []).map((s) => ({
      sensorId: s.sensorId,
      sensorName: s.sensorName,
      unit: (device.unitSelected || {})[s.sensorId] || '',
      usedAs:
        Object.entries(SENSORS).find(([, id]) => id === s.sensorId)?.[0] || '',
    }));
    console.log(`${device.devID} — ${device.devName}`);
    console.table(rows);
    return rows;
  };

  /**
   * The D30 series behind one card's kWh, and the subtraction it produces.
   *
   * Prints exactly what goes over the wire and what comes back, so a blank kWh
   * row can be told apart from an empty window, a meter that has not reported
   * since 00:00, or a series so short the delta is meaningless. Also reports
   * the point count, which is what CONSUMPTION_DOWNSCALE tunes.
   */
  window.__sldDiagnose = async (devID) => {
    const entries = [{ devID, sensor: SENSORS.kWh }];
    const body = buildConsumptionBody(entries, {
      timezone: TIMEZONE,
      cycleTime: CYCLE_TIME,
    });
    const { sTime, eTime } = body.devConfig[0];

    console.log('window:', new Date(sTime).toString(), '→', new Date(eTime).toString());
    console.log('request:', JSON.parse(JSON.stringify(body)));

    let payload;
    try {
      payload = await request('/account/widget/getAutoDownSampledData', {
        method: 'PUT',
        body,
      });
    } catch (err) {
      console.error('request failed:', err);
      return { body, error: err };
    }

    console.log('response:', payload);
    const row = ((payload && payload.data) || []).find((r) => r && r.devID === devID);

    if (!row) {
      console.warn('No row for this device — check the devID against __sldDeviceMap().');
      return { body, payload };
    }

    const computed = consumptionOf(row.data);
    if (!computed) {
      console.warn(
        'The series is empty: this meter has reported no D30 datapoint since ' +
          '00:00, so there is nothing to subtract.'
      );
      return { body, payload, row };
    }

    console.log(
      `points: ${computed.points}` +
        (computed.points > 500
          ? '  ← large; raise CONSUMPTION_DOWNSCALE in iosense-sdk/devices.js'
          : '')
    );
    console.log(`first: ${computed.first}  @ ${computed.firstAt}`);
    console.log(`last : ${computed.last}  @ ${computed.lastAt}`);
    console.log(
      `kWh = ${computed.last} − ${computed.first} = ` +
        `${computed.consumption.toFixed(DECIMALS)}`
    );
    if (computed.points === 1) {
      console.warn('Only one datapoint in the window, so the delta is 0.');
    }
    if (computed.consumption < 0) {
      console.warn('Negative delta — the meter counter appears to have reset.');
    }
    return { body, payload, row, ...computed };
  };
}

/**
 * Wire the diagram to live IOsense data.
 *
 * Never throws: a failure here must leave the diagram drawn and readable, just
 * without live numbers.
 *
 * @param {object} hooks
 * @param {Array<{id: string, uid: string, title: string}>} hooks.cards
 * @param {(uid: string, reading: object) => void} hooks.applyCard
 * @param {(status: object) => void} hooks.onStatus
 */
export async function initLiveData(hooks) {
  if (state.started) return;
  state.started = true;
  state.hooks = hooks;
  state.cards = hooks.cards;
  state.controller = new AbortController();

  /* The register is static, so resolution happens before any network call and
     an unmapped card is known immediately. */
  const { map, report } = resolveDevices(state.cards);
  state.cardToDev = new Map(Object.entries(map));
  state.report = report;
  installHelpers();

  const unmapped = report.filter((r) => r.source === 'unmapped');
  if (unmapped.length) {
    console.warn(
      `[sld] ${unmapped.length} of ${state.cards.length} cards are not in the ` +
        'device register: ' + unmapped.map((r) => r.title).join(', ')
    );
  }

  try {
    const { token, source } = await ensureAuth();
    if (!token) {
      hooks.onStatus({
        kind: 'unauthenticated',
        message: 'Open from the IOsense portal to see live readings',
        portal: PORTAL_URL,
      });
      return;
    }

    hooks.onStatus({ kind: 'connecting', source });
    await resolveLinkChannels();
    await refresh();
    /* First batch immediately so the kWh column is not blank while the first
       90-second gap elapses; the rotation takes over from there. */
    await refreshConsumption().catch(handleCycleError);
    startPolling();

    document.addEventListener('visibilitychange', () => {
      /* Coming back to the tab, the numbers on screen are up to POLL_MS old —
         refresh immediately rather than making the reader wait it out. */
      if (!document.hidden && state.timer) refresh().catch(handleCycleError);
    });
  } catch (err) {
    handleCycleError(err);
  }
}

/** Stop polling and abort anything in flight. */
export function stopLiveData() {
  stopPolling();
  if (state.controller) state.controller.abort();
}

export { DEVICE_IDS, SENSORS };
