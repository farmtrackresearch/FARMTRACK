# FarmTrack — Mobile App

> Part of the [FarmTrack](../README.md) project. The tracker firmware lives in [`../firmware`](../firmware).

GPS-enabled virtual fencing and livestock monitoring, built with Expo Router
and a Supabase/PostGIS backend. Admins draw geofences on a live OpenStreetMap
map; the app tracks collared livestock and raises alerts on boundary
breaches, approach warnings, low battery, and stationary animals.

---

## 1. Stack

- **Expo SDK 57 / React Native 0.86** — file-based routing under `src/app`,
  with `(auth)` and `(tabs)` route groups. New Architecture enabled.
- **Map rendering** — [`@maplibre/maplibre-react-native`](https://maplibre.org/maplibre-react-native/)
  in [RanchMap.tsx](src/components/map/RanchMap.tsx). MapLibre renders
  **vector** tiles on the GPU, so the map stays smooth while panning and sharp
  at any zoom. Fences and livestock are pushed to the map as **GeoJSON
  sources** feeding `fill` / `line` / `circle` style layers, rather than one
  native view per feature — this is what lets the map scale to a real herd.
- **Map source** — OpenStreetMap data, served by **MapTiler**
  ([src/lib/mapStyle.ts](src/lib/mapStyle.ts)). See §3 for why OSM's own tile
  server cannot be used.
- **Supabase** — Postgres + PostGIS, defined in
  [supabase/schema.sql](supabase/schema.sql), accessed through
  [src/lib/supabase.ts](src/lib/supabase.ts).
- **Audio** — `expo-audio` (not `expo-av`, which was removed in SDK 55).
- **State** — [`useFarmData`](src/hooks/useFarmData.ts) exposed app-wide via
  [`FarmDataContext`](src/stores/FarmDataContext.tsx) (`useFarm()`), plus a
  [`zustand`](src/stores/authStore.ts) auth store.

**Platforms: iOS and Android.** The web build intentionally has *no* map —
[RanchMap.web.tsx](src/components/map/RanchMap.web.tsx) renders a "open on
your phone" card instead, and carries no mapping dependency. Every other
screen (livestock, alerts, analytics) works in a browser.

### Demo mode

If `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset or
still placeholders, `isSupabaseConfigured` is `false` and the app runs on the
fixtures in [src/data/mockData.ts](src/data/mockData.ts) — useful for demoing
without a backend.

---

## 2. Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` (it is gitignored — never put real keys in `.env.example`,
which **is** committed):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_MAPTILER_KEY=your-maptiler-key
```

Get a free MapTiler key at [cloud.maptiler.com](https://cloud.maptiler.com)
(100k tiles/month, no credit card). Paste **only the key** — not a URL. It is
interpolated into `…/style.json?key=<value>`, so a URL there produces a
malformed request and a blank map.

Then run [supabase/schema.sql](supabase/schema.sql) once in the Supabase SQL
editor (or `supabase db push`).

> **Expo inlines `EXPO_PUBLIC_*` at bundle time.** After changing any key,
> restart with `npx expo start --clear` or the old value persists.

---

## 3. Map source: why not `tile.openstreetmap.org`?

The app renders **OpenStreetMap data**. OSM is a *database*, not a picture
service — something must render it into tiles.

OSM's own tile server refuses app traffic. It returns
`x-blocked: Access denied` and serves a **403 "Access blocked" placeholder
image** rather than map data, per the
[OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Verified directly — a browser User-Agent does not help. Point the app at it
and every tile becomes that warning graphic.

So OSM data is served through a host licensed for app traffic:

| Key set | Source | Max zoom | Notes |
|---|---|---|---|
| Yes | MapTiler `streets-v2` **vector** | 20 | GPU-rendered, sharp, fast |
| No | OpenTopoMap **raster** fallback | 17 | ~1s/tile, volunteer-run, dev only |

Without a key the app still runs, and shows a dismissible **"Preview
basemap"** banner explaining the limitation. Zoom 17 is roughly 1.2 m/pixel —
too coarse to place fence corners accurately, so set the key.

---

## 4. Running the app

### You need a development build — Expo Go will not work

FarmTrack **cannot run in Expo Go**, for two independent reasons:

1. **MapLibre is a native module.** Expo Go ships a fixed set of compiled-in
   native modules and MapLibre isn't one. Its binding runs at import
   (`TurboModuleRegistry.getEnforcing("MLRNLocationModule")`), which *throws*
   when the module is absent — so the map route fails to load entirely.
2. **The core feature needs background execution.** Background location,
   Android foreground services, `UIBackgroundModes`, and critical alerts are
   all ignored in Expo Go. Breach detection while the phone is pocketed —
   the entire point of FarmTrack — can never work there.

A development build is your own compiled app with Metro attached. **JavaScript
edits still hot-reload exactly as before.** You only rebuild when native code
changes: adding/removing a native package, or editing `app.json` plugins and
permissions.

### iOS simulator (macOS + Xcode)

Requires Xcode. Note this project builds against the **iOS 27 SDK**, which
makes UIScene lifecycle adoption mandatory — handled by `enableSceneSupport`
in [app.json](app.json) (see §8). Without it the app crashes instantly at
launch with `EXC_BREAKPOINT`.

```bash
npx expo run:ios
```

First build takes several minutes (all pods, including MapLibre's map SDK);
later ones are much quicker.

**Opening the simulator window.** In **Xcode 27 the Simulator app was renamed
to Device Hub**:

```bash
open "/Applications/Xcode.app/Contents/Applications/DeviceHub.app"
```

Or **Xcode → Open Developer Tool → Device Hub**. `open -a Simulator` no longer
works — the old app does not exist.

**The simulator has no GPS.** It reports nothing until you give it a location,
so the breach alarm stays idle:

```bash
# park the device at the ranch
xcrun simctl location booted set 9.3065,123.3077

# or walk it in a line at 8 m/s to cross a fence and fire the alarm
xcrun simctl location booted start --speed=8 9.3065,123.3077 9.3140,123.3200

xcrun simctl location booted clear
```

Zoom in the simulator: **⌥ Option + drag** to pinch, or **double-click**. The
in-app **+ / −** buttons on the right edge are usually easier.

### Android emulator

Requires Android Studio and the Android SDK, with `ANDROID_HOME` set.

```bash
npx expo run:android
```

Set a location via the emulator's **⋯ → Location** panel, which also supports
importing a GPX route to simulate movement.

### Physical devices — the important one

**A simulator cannot meaningfully test a geofencing system.** Simulated GPS
has no drift, no accuracy loss under tree cover, no signal gaps. Validate on
real hardware.

| | Cost | How |
|---|---|---|
| **Android phone** | **Free** | `eas build -p android --profile development`, download the APK, install it. Or plug in via USB with developer mode on and run `npx expo run:android`. |
| **iPhone** | **$99/yr** | Requires the Apple Developer Program. Register each device UDID into an ad-hoc provisioning profile (100 devices/year cap; Apple takes 24–72h to process a new device the first time), then `eas build -p ios --profile development`. |

[EAS Build](https://docs.expo.dev/build/internal-distribution/) compiles in
Expo's cloud, so **no local Xcode is needed for a physical iPhone** — but
there is no way to run an iOS *simulator* without Xcode, since the simulator
*is* Xcode.

**Recommended:** test on a real **Android** phone. It's free, needs no
developer programme, and a real device walking across a real boundary is the
only convincing proof the system works.

---

## 5. Database schema ([supabase/schema.sql](supabase/schema.sql))

- **`profiles`** — extends `auth.users`; `role` is `admin` or `staff`,
  auto-created by the `handle_new_user()` trigger on signup.
- **`geofences`** — PostGIS `POLYGON` with a GIST index;
  `get_geofences_geojson()` returns them as GeoJSON for the client.
- **`location_logs`** — every collar fix; `sync_location_point()` maintains
  the geometry column, and `detect_geofence_events()` raises alerts on
  insert using `ST_Contains` / `ST_Distance`.
- **`latest_livestock_locations`** — view joining livestock + collars + most
  recent fix, returning plain lat/lng (no WKB parsing on the client).
- **RLS** — 21 policies: all authenticated users read; only `admin` (via
  `is_admin()`) writes collars/livestock/geofences.

---

## 6. Fence drawing & the map screen

[`src/app/(tabs)/map.tsx`](src/app/(tabs)/map.tsx) wires together
[`RanchMap`](src/components/map/RanchMap.tsx),
[`FenceDrawingPanel`](src/components/map/FenceDrawingPanel.tsx),
[`CreateFenceModal`](src/components/map/CreateFenceModal.tsx),
[`FenceListPanel`](src/components/map/FenceListPanel.tsx) and
[`useAlarm`](src/hooks/useAlarm.tsx).

Drawing is **tap-to-place**. Vertices drag via a `PanResponder` on each
marker, converting the pixel delta back to a coordinate with local Web
Mercator maths — the camera is stationary during a vertex drag, so this is
exact and avoids awaiting MapLibre's async `unproject()` per frame.

Coordinates are `{ latitude, longitude }` (`MapLatLng`) throughout the app,
converted to/from GeoJSON `[lng, lat]` rings at the Supabase boundary by
`geoJsonToLatLngs` / `latLngsToRing` in [src/lib/utils.ts](src/lib/utils.ts).

`RANCH_REGION` in [src/constants/theme.ts](src/constants/theme.ts) sets the
opening camera position (currently Dumaguete, 9.3065 N / 123.3077 E). It is
only the *initial* view — the map auto-fits to real fences once data loads.

---

## 7. Realtime

`useFarmData` subscribes to Postgres changes on `alerts` (new alerts pop a
live banner/alarm) and on `location_logs`.

---

## 8. Platform gotchas worth knowing

- **iOS 27 / Xcode 27 requires the UIScene lifecycle.** Expo SDK 57's default
  template still uses the legacy app-delegate window, so builds crash at
  launch with `EXC_BREAKPOINT` in
  `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Fixed by
  `["expo-build-properties", { "ios": { "enableSceneSupport": true } }]` in
  [app.json](app.json). It is a no-op from SDK 58 onward, so it can stay.
- **No spaces in the project path.** Apple's build scripts read some paths
  unquoted, so `FARMTRACK V2` splits at the space and `xcodebuild` fails with
  error 65. Keep the folder hyphenated.
- **Android still links Google Maps' SDK?** No — that was the old
  `react-native-maps`. MapLibre has no Google dependency at all.
- **`expo-av` is gone** (removed in SDK 55). The alarm uses `expo-audio`;
  its tones are shipped as `assets/sounds/*.wav` because `expo-audio` does not
  accept `data:` URIs.

---

## 9. Known trade-offs

- **Fence logic exists twice.** PostGIS `detect_geofence_events()` decides
  breaches server-side; the client mirrors it in
  [`evaluateAgainstFences`](src/lib/utils.ts) for instant feedback. Two
  implementations of one safety-critical rule *will* drift. The database is
  the source of truth for persisted alerts; the client copy is for the
  on-device GPS probe only.
- **Breach flapping** is mitigated per-fence via `warning_buffer_meters`,
  not a global buffer. There is no "N consecutive readings" debounce yet if
  GPS jitter near a boundary becomes a problem in practice.
- **Realtime refetch is coarse.** Every `location_logs` insert currently
  triggers a full reload of all five tables in
  [useFarmData.ts](src/hooks/useFarmData.ts). Fine for a demo herd; wasteful
  once many collars report at once.
- **`EXPO_PUBLIC_*` keys ship inside the app bundle.** That is by design and
  fine for MapTiler, but restrict the key by origin in the MapTiler dashboard
  before any public release.

---

## 10. Gaps and future work

Ordered by what blocks what. Items 1 and 2 gate everything else.

### 1. Close the hardware loop — *the critical path*

The app currently consumes data that no collar produces. `../firmware` holds
only per-component bring-up tests (board, GPS, LoRa TX, LoRa RX); nothing
carries a real fix into Supabase. **Until this exists, FarmTrack is a
convincing demo rather than a working system.**

- Merge the GPS and LoRa sketches into one collar firmware that reads a fix
  and transmits on a duty cycle
- Build the base station: LoRa receive → WiFi/Ethernet → Supabase
- Define the uplink packet: collar id, lat, lon, fix quality, battery,
  sequence number
- Ingest via a Supabase **Edge Function**, so collars never hold the anon key
- Handle duplicate and out-of-order packets (LoRa delivery is not ordered)

### 2. Field-readiness

- **Offline tile cache** — a rancher out of coverage still needs the pasture
  outline. MapLibre ships an `OfflineManager` for exactly this.
- **Offline write queue** so fences drawn without signal sync later
- **Stale-fix handling** — a collar silent for an hour should read *unknown*,
  not *grazing*. There is currently no staleness concept at all.
- **Push notifications** via Expo, so a breach reaches a locked phone
- **Battery strategy** — continuous `BestForNavigation` GPS will not survive
  a working day; needs duty-cycling or significant-change monitoring

### 3. Map features

- Location **history trails** — draw an animal's last 24 hours
- **Grazing heatmap** so pasture rotation has evidence behind it
- **Exclusion zones** (dams, roads, cliffs) alongside containment fences
- **Snap-to-vertex** and a live distance readout while drawing
- **Marker clustering** once the herd outgrows a dozen collars

### 4. Analytics that mean something

The analytics screen is currently a placeholder. With real history it could
answer: is the warning tone actually turning animals back? Which collars need
charging this week? Which animal has stopped moving — often the first sign of
illness?

### 5. Engineering debt

- **There are no tests.** Start with the geometry in
  [src/lib/utils.ts](src/lib/utils.ts) — pure functions, safety-critical,
  trivially testable. `pointInPolygon` and `distanceToRingMeters` decide
  whether an alarm fires.
- **13 outstanding lint errors**, mostly `set-state-in-effect` in the data
  hooks
- **No error boundaries** — one throw in a provider takes down the whole app,
  exactly as `expo-av` did
- **Android has never been built.** Run `npx expo run:android` before you are
  short on time; first builds surface SDK and JDK issues.
- **`.DS_Store` is committed.** Add it to `.gitignore` and
  `git rm --cached` it.

### 6. Security and deployment

- Restrict the MapTiler key by origin/bundle id
- Rotate the Supabase anon key if this repo was ever public
- Decide on iOS distribution: the Apple Developer Program ($99/yr) is
  required for any on-device iOS testing or release
