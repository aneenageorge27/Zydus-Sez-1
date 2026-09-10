/**
 * Device catalogue, latest readings and cycle consumption.
 *
 * functionIds: findUserDevices, getLastDPsofDevicesAndSensorCalibrated,
 *              getDeviceAutoDownSampledData
 */

import { request } from './api.js';

/* findUserDevices is paginated; this is the page size, not a cap. */
const PAGE_SIZE = 100;

/* A hard stop so a mis-reported totalCount can never spin forever. */
const MAX_PAGES = 100;

/* getLastDPs takes every pair in one body, but 450+ pairs is a big request —
   split it so one slow chunk cannot stall the whole refresh. */
const PAIR_CHUNK = 150;

/* getAutoDownSampledData enforces its own cap and rejects the whole request
   above it: "Too many devices in a single request (150). A maximum of 100
   devices...". This is that ceiling, not a tuning knob — do not raise it. */
export const AUTOSAMPLE_CHUNK = 100;

/**
 * Whether a rejection is the connector's device-rate limit rather than a fault
 * in the request.
 *
 * It counts devices asked for over a rolling window, not requests, so the fix
 * is to ask for fewer devices less often — never to retry immediately.
 */
export function isRateLimited(err) {
  const text = `${(err && err.message) || ''}`.toLowerCase();
  return text.includes('rate limit') || text.includes('already requested');
}

/**
 * Every device the authenticated user can see.
 *
 * The array is nested at `response.data.data` — not `response.data`.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllDevices({ signal } = {}) {
  const devices = [];
  let total = Infinity;

  for (let page = 1; page <= MAX_PAGES && devices.length < total; page++) {
    const payload = await request(`/account/devices/${page}/${PAGE_SIZE}`, {
      method: 'PUT',
      organisation: true,
      signal,
      body: { search: [], filter: [], order: 'default', sort: 'AtoZ' },
    });

    const data = payload && payload.data;
    const batch = (data && data.data) || [];
    if (typeof data?.totalCount === 'number') total = data.totalCount;

    devices.push(...batch);
    /* A short page means the catalogue is exhausted, whatever totalCount said. */
    if (batch.length < PAGE_SIZE) break;
  }
  return devices;
}

/**
 * Latest calibrated datapoint for each `(devID, sensor)` pair.
 *
 * @param {Array<{devID: string, sensor: string}>} pairs
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<{devID, sensor, time, value, unit}>>}
 */
export async function fetchLatestReadings(pairs, { signal } = {}) {
  if (!pairs.length) return [];

  const chunks = [];
  for (let i = 0; i < pairs.length; i += PAIR_CHUNK) {
    chunks.push(pairs.slice(i, i + PAIR_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((devices) =>
      request('/account/deviceData/getLastDPsofDevicesAndSensorProcessed', {
        method: 'PUT',
        signal,
        body: { devices },
      })
    )
  );

  return results.flatMap((payload) => (payload && payload.data) || []);
}

/**
 * Epoch ms of the most recent cycle boundary in a given timezone.
 *
 * `Date` has no notion of another zone, so the wall-clock time *there* is read
 * back through `Intl` and subtracted from now — which keeps the boundary right
 * across DST and across the machine's own timezone being anything at all.
 *
 * @param {string} timezone  IANA zone, e.g. 'Asia/Calcutta'
 * @param {string} cycleTime 'HH:mm'
 * @param {number} [now=Date.now()]
 * @returns {number} epoch ms of the last cycleTime in that zone
 */
export function cycleStart(timezone, cycleTime, now = Date.now()) {
  const [h, m] = cycleTime.split(':').map(Number);

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const at = (type) => Number(parts.find((p) => p.type === type).value);
  /* Intl reports midnight as hour 24 in some engines. */
  const hour = at('hour') % 24;

  const sinceMidnight =
    ((hour * 60 + at('minute')) * 60 + at('second')) * 1000 +
    (now % 1000);
  const sinceCycle = sinceMidnight - (h * 60 + m) * 60_000;

  /* Before today's boundary, the current cycle began yesterday. */
  return now - (sinceCycle < 0 ? sinceCycle + 86_400_000 : sinceCycle);
}

/**
 * How hard the connector thins the returned series.
 *
 * Only the first and last points of each series are ever read, so this exists
 * purely to keep the payload small across 151 meters. Raise it if
 * `__sldDiagnose` reports large point counts.
 */
export const CONSUMPTION_DOWNSCALE = 100;

/**
 * The getAutoDownSampledData body for one cycle's worth of meter readings.
 *
 * Split out from the call so a diagnostic can show exactly what went over the
 * wire without rebuilding it and risking a different shape.
 *
 * @param {Array<{devID: string, sensor: string}>} entries
 * @param {{timezone?: string, cycleTime?: string, now?: number}} [options]
 */
export function buildConsumptionBody(entries, options = {}) {
  const {
    timezone = 'Asia/Calcutta',
    cycleTime = '00:00',
    now = Date.now(),
    downscale = CONSUMPTION_DOWNSCALE,
  } = options;

  const sTime = cycleStart(timezone, cycleTime, now);

  return {
    devConfig: entries.map(({ devID, sensor }) => ({
      sTime,
      eTime: now,
      devID,
      sensor,
      downscale,
    })),
  };
}

/**
 * Last value minus first value of one returned series.
 *
 * The series arrives as an object keyed by ISO timestamp. Object key order is
 * insertion order rather than chronological, so the timestamps are sorted
 * before the ends are taken — trusting key order would silently produce a
 * negative or wrong delta.
 *
 * @param {Record<string, number>} series
 * @returns {{consumption: number, first: number, last: number, points: number}|null}
 */
/**
 * A timestamp to epoch ms, whether it arrives as an ISO string, an epoch
 * number, or an epoch number that became a string — which it always does when
 * it is an object key, since JS object keys are strings.
 */
function parseTime(value) {
  if (typeof value === 'number') return value;
  const s = String(value ?? '');
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    /* Seconds vs milliseconds: anything below this is too old to be a real ms
       reading, so read it as seconds. */
    return n < 1e11 ? n * 1000 : n;
  }
  return Date.parse(s);
}

export function consumptionOf(series) {
  if (!series) return null;

  /* The documented shape is an object keyed by ISO timestamp, but accept the
     array forms too — a series is worthless to us if a shape difference is all
     that stands between the reading and the card. */
  let points = [];
  if (Array.isArray(series)) {
    points = series.map((p) => {
      if (Array.isArray(p)) return { iso: p[0], value: p[1] };
      if (p && typeof p === 'object') {
        return { iso: p.time ?? p.timestamp ?? p.t, value: p.value ?? p.v ?? p.data };
      }
      return null;
    });
  } else if (typeof series === 'object') {
    points = Object.entries(series).map(([iso, value]) => ({ iso, value }));
  }

  const times = points
    .filter(Boolean)
    .map((p) => ({
      iso: p.iso,
      at: parseTime(p.iso),
      value: Number(p.value),
    }))
    .filter((t) => !Number.isNaN(t.at) && Number.isFinite(t.value))
    .sort((a, b) => a.at - b.at);
  if (!times.length) return null;

  const first = times[0];
  const last = times[times.length - 1];

  return {
    consumption: last.value - first.value,
    first: first.value,
    last: last.value,
    points: times.length,
    firstAt: new Date(first.at).toISOString(),
    lastAt: new Date(last.at).toISOString(),
  };
}

/**
 * Consumption since the cycle boundary, per device.
 *
 * The connector returns a downsampled series per device; only its first and
 * last points are used, so consumption is `last − first` — computed here, never
 * asked of a server-side delta operator.
 *
 * @param {Array<{devID: string, sensor: string}>} entries
 * @param {object} [options]
 * @param {string} [options.timezone='Asia/Calcutta']
 * @param {string} [options.cycleTime='00:00']
 * @param {number} [options.downscale]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Map<string, object>>} devID → consumptionOf() result
 */
export async function fetchCycleConsumption(entries, options = {}) {
  const {
    timezone = 'Asia/Calcutta',
    cycleTime = '00:00',
    downscale = CONSUMPTION_DOWNSCALE,
    signal,
  } = options;
  const out = new Map();
  if (!entries.length) return out;

  const now = Date.now();

  const chunks = [];
  for (let i = 0; i < entries.length; i += AUTOSAMPLE_CHUNK) {
    chunks.push(entries.slice(i, i + AUTOSAMPLE_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      request('/account/widget/getAutoDownSampledData', {
        method: 'PUT',
        /* Other /account endpoints on this deployment require the organisation
           context; sending it costs nothing where it is ignored. */
        organisation: true,
        signal,
        body: buildConsumptionBody(chunk, {
          timezone,
          cycleTime,
          now,
          downscale,
        }),
      })
    )
  );

  /* Keep the first payload so a caller can show what actually came back when
     nothing parses out of it. */
  out.lastPayload = results[0] ?? null;

  for (const payload of results) {
    const rows = (payload && payload.data) || [];
    /* Documented as an array of rows; tolerate an object keyed by devID. */
    const list = Array.isArray(rows) ? rows : Object.entries(rows).map(
      ([devID, data]) => ({ devID, data })
    );
    for (const row of list) {
      if (!row || !row.devID) continue;
      const computed = consumptionOf(row.data);
      if (computed) out.set(row.devID, computed);
    }
  }
  return out;
}
