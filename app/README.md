# FarmTrack — Mobile App

> Part of the [FarmTrack](../README.md) project. The tracker firmware lives in [`../firmware`](../firmware).

GPS-enabled virtual fencing and livestock monitoring, built with Expo Router
and a Supabase/PostGIS backend. Admins draw geofences on a live map; the app
tracks collared livestock in real time and raises alerts on boundary
breaches, approach warnings, low battery, and stationary animals.

---

## 1. Stack

- **Expo Router (SDK 54)** — file-based routing under `src/app`, with
  `(auth)` and `(tabs)` route groups.
- **Map rendering** — `react-native-maps` on native via
  [RanchMap.native.tsx](src/components/map/RanchMap.native.tsx), with
  `mapType="none"` and `provider={PROVIDER_DEFAULT}` hardcoded so the native
  Apple/Google base layer never renders; OSM (standard) and Esri World
  Imagery (satellite) raster tiles are drawn instead via `UrlTile`, and the
  standard/satellite toggle only swaps that tile URL, never `mapType`. Web
  falls back to a hand-rolled `react-native-svg` renderer via
  [RanchMap.tsx](src/components/map/RanchMap.tsx) (Expo's platform file
  resolution picks the right one automatically). Both share
  [RanchMap.types.ts](src/components/map/RanchMap.types.ts) and render the
  same fence polygons / livestock markers / draft-drawing state.
- **Supabase** — Postgres + PostGIS backend, defined in
  [supabase/schema.sql](supabase/schema.sql), accessed through
  [src/lib/supabase.ts](src/lib/supabase.ts).
- **State** — [`useFarmData`](src/hooks/useFarmData.ts) hook exposed app-wide
  via [`FarmDataContext`](src/stores/FarmDataContext.tsx) (`useFarm()`), plus
  a [`zustand`](src/stores/authStore.ts) auth store.

### Demo mode

If `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset (or
still the placeholder values), `isSupabaseConfigured` is `false` and the app
runs entirely on the fixtures in [src/data/mockData.ts](src/data/mockData.ts)
— useful for demoing the UI without a backend. Once real env vars are set,
`useFarmData` loads from and subscribes to Supabase instead.

---

## 2. Setup

```bash
npm install
```

Create `.env` from `.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Run [supabase/schema.sql](supabase/schema.sql) once in the Supabase SQL
editor (or via `supabase db push`) — it creates enums, tables (`profiles`,
`collars`, `livestock`, `geofences`, `location_logs`, `alerts`), PostGIS
geometry columns, RLS policies, and the RPCs/views described below.

Start the app:
```bash
npx expo start
```

`react-native-maps` is a native module; if it isn't already included in your
Expo Go build, generate a development build:
```bash
npx expo prebuild
npx expo run:android   # or run:ios
```
No Google Maps API key is needed — the app never sets `PROVIDER_GOOGLE` or
a non-`"none"` `mapType`, so it doesn't render the native Google/Apple map.

---

## 3. Database schema ([supabase/schema.sql](supabase/schema.sql))

- **`profiles`** — extends `auth.users`; `role` is `admin` or `staff`,
  auto-created by the `handle_new_user()` trigger on signup.
- **`collars`** — hardware devices (battery, connection type, signal,
  firmware, last ping).
- **`livestock`** — animals, each optionally linked to a `collar_id`, with
  `health_status` and `animal_status` (`grazing` / `near_boundary` /
  `breach` / `resting`).
- **`geofences`** — PostGIS `geometry(Polygon, 4326)` boundaries plus a
  `warning_buffer_meters` used for approach warnings.
- **`location_logs`** — append-only GPS history per collar; a `geography`
  point is kept in sync with `latitude`/`longitude` by
  `sync_location_point()`.
- **`alerts`** — `approach_warning`, `boundary_breach`, `low_battery`,
  `stationary`, `info`, each optionally tied to a collar/livestock/geofence.

Key server-side logic:
- **`detect_geofence_events()`** — trigger on `location_logs` insert; checks
  the new point against all active geofences with `ST_DWithin`/`ST_Contains`,
  updates `livestock.animal_status`, and inserts `alerts` rows on breach or
  approach-warning transitions.
- **`get_geofences_geojson()`** — RPC returning geofences as GeoJSON so the
  client never touches raw WKB.
- **`upsert_geofence(...)`** — RPC used by admins to create/update a fence
  boundary from a GeoJSON polygon.
- **`latest_livestock_locations`** — view joining livestock + collars + most
  recent `location_logs` row, used for the map's "current position" query.
- RLS: all authenticated users can read; only `admin` role (via
  `is_admin()`) can write collars/livestock/geofences/alerts.

---

## 4. Fence drawing & the map screen

[`src/app/(tabs)/map.tsx`](src/app/(tabs)/map.tsx) wires together:
- [`RanchMap`](src/components/map/RanchMap.tsx) — renders livestock markers,
  saved fence polygons (color-coded by breach/warning state via
  [`statusMarkerColor`](src/lib/utils.ts)), and the in-progress draft ring.
- [`FenceDrawingPanel`](src/components/map/FenceDrawingPanel.tsx) — start/undo
  vertex/finish/cancel controls while drawing.
- [`CreateFenceModal`](src/components/map/CreateFenceModal.tsx) — name +
  color + warning-buffer prompt shown on finish.
- [`FenceListPanel`](src/components/map/FenceListPanel.tsx) — list of saved
  fences with delete + undo-delete toast.
- [`useAlarm`](src/hooks/useAlarm.tsx) — vibration + sound + on-screen
  overlay, fired when the device's own GPS (via `expo-location`) or a
  tracked animal crosses a fence, using
  [`evaluateAgainstFences`](src/lib/utils.ts) client-side (mirrors the
  server's breach/warning logic for instant feedback, with the DB trigger as
  the source of truth for persisted alerts).

Coordinates are handled consistently as `{ latitude, longitude }`
(`MapLatLng`) in the app and converted to/from GeoJSON `[lng, lat]` rings at
the Supabase boundary via `geoJsonToLatLngs`/`latLngsToRing` in
[`src/lib/utils.ts`](src/lib/utils.ts).

---

## 5. Realtime & polling

`useFarmData` subscribes to Postgres changes on `alerts` (new alerts pop a
live banner/alarm) and refetches `latest_livestock_locations` +
`get_geofences_geojson` on load and after mutations. Because
`latest_livestock_locations` is a plain view (not a raw `geometry` column),
Realtime payloads and refetches both come back as ready-to-use
lat/lng — there's no WKB-hex-parsing step to worry about on the client.

---

## 6. Known trade-offs

- **Map provider**: native renders raw OSM/Esri raster tiles via
  `react-native-maps`'s `UrlTile`, with the native Apple/Google base map
  disabled (`mapType="none"`, `provider={PROVIDER_DEFAULT}`) — no Google
  Maps API key needed, and behavior is consistent across iOS/Android.
  The tradeoff is the tile source: without `EXPO_PUBLIC_MAPTILER_KEY` set
  (see `.env.example`), "Standard" falls back to OpenTopoMap, a volunteer-run
  free source not meant for production traffic — get a free MapTiler key
  before shipping. See the tile-provider note in
  [RanchMap.native.tsx](src/components/map/RanchMap.native.tsx) for why
  `tile.openstreetmap.org` and CARTO's free basemap CDN don't work here
  (both looked fine at a glance — HTTP 200 — but actually reject app
  traffic).
  Web has no native maps SDK, so it falls back to a custom SVG projection
  tied to `RANCH_REGION` in
  [`src/constants/theme.ts`](src/constants/theme.ts) — fine for a
  single-ranch deployment, not a general-purpose map.
- **Geofence breach flapping**: mitigated via `warning_buffer_meters` per
  fence rather than a fixed global buffer; there's no "N consecutive
  readings" debounce yet if GPS jitter near a boundary becomes an issue in
  practice.
