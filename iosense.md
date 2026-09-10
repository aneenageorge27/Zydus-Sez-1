# IOsense integration

Source of truth for every IOsense functionId and flow this project uses.

Base URL: `https://connector.iosense.io/api`

## Flow

```
validateSSOToken ─┬─ getLastDPsofDevicesAndSensorCalibrated   (PF, kW + timestamps)
                  └─ getAutoDownSampledData                  (D30 series since 00:00)
                     ↑ both every 30s
```

`findUserDevices` runs **once at boot**, not per cycle: the device register and
the data channels are hardcoded, but the RSSI and Status channels are resolved
by name (see *Extra channels*). It is also used on demand by
`__sldVerifyDevices()` and `__sldChannels()`.

## Functions

| functionId | Method + path | Used for | Implemented in |
|---|---|---|---|
| `validateSSOToken` | `GET /retrieve-sso-token/{token}` | Exchange the one-time SSO token for a Bearer JWT | [iosense-sdk/auth.js](iosense-sdk/auth.js) |
| `getLastDPsofDevicesAndSensorCalibrated` | `PUT /account/deviceData/getLastDPsofDevicesAndSensorProcessed` | Latest PF and kW, plus the timestamp of all three channels | [iosense-sdk/devices.js](iosense-sdk/devices.js) |
| `getDeviceAutoDownSampledData` | `PUT /account/widget/getAutoDownSampledData` | The D30 series since 00:00; its last minus first point is today's kWh | [iosense-sdk/devices.js](iosense-sdk/devices.js) |
| `findUserDevices` | `PUT /account/devices/{skip}/{limit}` | Once at boot, to resolve the RSSI/Status channels by name; also `__sldVerifyDevices()` and `__sldChannels()` | [iosense-sdk/devices.js](iosense-sdk/devices.js) |

## Channels

Every meter on this site shares one channel layout, so there is no per-devType
resolution:

| Metric | Sensor | Read as |
|---|---|---|
| PF | `D3` | instantaneous |
| kW | `D1` | instantaneous |
| kWh | `D30` | **last datapoint − first datapoint** since 00:00, not the raw counter |

**`D1` is active power and `D3` is power factor** — the reverse of the order the
site register lists them in. Confirmed against live readings: on `ZADS1EM_T18`,
`D1` returned `354` and `D3` returned `0.96`, and a power factor cannot exceed 1.
Check with `__sldChannels(devID)` before ever changing this.

`D30` also comes through `getLastDPs…`, not to display but for its timestamp:
it is how the offline rule knows the energy channel is still reporting.

## Consumption

```
today's kWh = last D30 datapoint − first D30 datapoint,   over 00:00 IST → now
```

Computed here from the series `getAutoDownSampledData` returns, never asked of a
server-side delta operator.

```
PUT /account/widget/getAutoDownSampledData
{ devConfig: [ { devID, sensor: 'D30', sTime, eTime, downscale } ] }

→ { data: [ { devID, sensor, data: { '<ISO>': value, … } } ] }
```

Only the **first and last** points of each series are read; `downscale`
(`CONSUMPTION_DOWNSCALE`, currently 100) exists solely to keep the payload small
across 151 meters, since everything between the ends is discarded.

### Two separate limits on this endpoint

**Per request:** at most 100 devices, or the whole request is rejected —
`Too many devices in a single request (150). A maximum of 100 devices…`.
`AUTOSAMPLE_CHUNK = 100` is that ceiling, deliberately separate from
`PAIR_CHUNK` (150), which `getLastDPs` accepts.

**Per rolling window:** a budget on *device count*, not request count —
`Device rate limit exceeded: 100 of 100 devices already requested`. Both arrive
as HTTP 200 with `success: false`.

The second is why consumption has its own slower cycle. Asking for all 151
meters every 30s is ~300 devices a minute and cannot succeed. Instead:

- one batch of `CONSUMPTION_BATCH` (100) meters every `CONSUMPTION_POLL_MS`
  (90s), **rotating** through the rest — a full pass over 151 meters takes two
  batches;
- results are **merged, never replaced**, so a card keeps its last kWh until
  its own turn comes round;
- on a rate-limit rejection the app backs off on **both axes** — the interval
  doubles (to a 15-minute ceiling) *and* the batch halves (to a floor of 20).
  Lengthening the wait alone cannot help when the budget per window is smaller
  than a single batch: it would retry the same impossible request forever.
- a clean batch eases the backoff off again, batch size first.

PF, kW and the colour channels are unaffected — they stay on the 30s cycle
through `getLastDPs`, which has its own, looser limit.

`consumptionOf()` **sorts by timestamp before taking the ends.** The series
arrives as an object keyed by ISO string, and object key order is insertion
order rather than chronological — trusting key order would silently yield a
negative or wrong delta.

Edge cases: an empty series shows `—` (the meter has not reported since 00:00,
and the count is warned about); a single datapoint yields `0`; a negative delta
is surfaced by `__sldDiagnose` as a probable counter reset.

`cycleStart()` in [iosense-sdk/devices.js](iosense-sdk/devices.js) computes the
boundary through `Intl`, so it is correct regardless of the viewer's own
timezone and across DST.

Response hazards, all handled:
- **Key order is not chronological** — sorted before the ends are taken.
- **Values may be strings** — coerced before arithmetic.
- **Errors arrive with HTTP 200** — the envelope's `success` flag is what the
  wrapper branches on.

## Auth

- SSO token arrives as `?token=xxx`, is exchanged once, then stripped from the
  URL. One-time use, 60s expiry — never retried.
- The JWT comes back **already prefixed `Bearer `**. Stored verbatim under
  `localStorage.bearer_token`; never concatenate another `Bearer `.
- No refresh path. On 401/403 the token is cleared, polling stops, and the
  reader is told to mint a new one from the portal.

## Card → meter

[js/device-map.js](js/device-map.js) holds the site register verbatim: 156 rows
of device name → `ZADS1EM_*`, keyed by name because the register's name column
is the card title. All **151 metered cards resolve**; no two share a meter.

One alias covers a typo in the diagram — card `OG CHILLED WATER PUMP- 2` (two
Ls) against register `OG CHILED WATER PUMP- 2` (`ZADS1EM_A166`). Pumps 1 and 3
spell it with one L on both sides.

Six register rows are meters not drawn on the SLD (`OUTGOING- 4/6/7/8`,
`IN 11 KV INCOMER- 2`) and go unused. The two `d()` device cards (the UPS units)
carry no metrics and are correctly absent.

## Card colour

```
IF  (RSSI == -1 AND Status == 0)  OR  no reading in 5 min
        GRAY    tone `disconnected`, glyph meter-disconnected.svg
ELSE IF  D6 < 1
        RED     tone `off`,          glyph meter-off.svg
ELSE
        the tone the design gave the card
```

**Gray outranks red.** A meter that is not talking cannot be trusted to report a
meaningful `D6` either, so its last stale `D6` must not paint the card red as
though it were a live fault.

The 5-minute reading-age test is a second, independent route to gray: a meter
whose link drops entirely stops sending RSSI too, so the timestamp is what
catches a dead device.

Both tones and both glyphs already existed — they are the `Off` and
`Disconnected` keys in the header legend.

## Extra channels

| Channel | Id | Purpose |
|---|---|---|
| Fault | `D6` | `< 1` paints the card red. Fetched, never displayed |
| RSSI | resolved by name | with Status, the device's own offline report |
| Status | resolved by name | " |

`D1`/`D3`/`D30`/`D6` are pinned ids. **RSSI and Status are resolved per device by
`sensorName`**, because they were never given as fixed ids and a wrong channel
would silently paint cards the wrong colour. That is why `findUserDevices` runs
once at boot. If a device exposes neither, that card falls back to the
reading-age rule alone and a console warning names the count.

## Display rules

- Refresh every 30s; skipped while the tab is hidden, immediate on return.
- Values are shown to **3 decimals** (`23.347`).
- A gray or red card keeps its last known values — the colour qualifies the
  reading, it does not replace it.
- A metric with no reading shows `—`.

## Console helpers

| Helper | Does |
|---|---|
| `__sldDeviceMap()` | What each card resolved to, and anything unmapped |
| `__sldVerifyDevices()` | Fetches the real catalogue and reports any devID missing from it or whose `devName` disagrees with the card title |
| `__sldChannels(devID or title)` | The real `sensorName` and unit of every channel on a device, with a `usedAs` column showing which row this app feeds from it — the authoritative answer to "is `D1` power or power factor?" |
| `__sldDiagnose(devID)` | Prints the request and response for one device's D30 series, then the subtraction — first and last values with their timestamps, the point count (what `CONSUMPTION_DOWNSCALE` tunes), and the resulting kWh. Warns on an empty series, a single point, or a negative delta |
