# FarmTrack — Mobile App

> Part of the [FarmTrack](../README.md) project. The collar and gateway firmware is in [`../firmware`](../firmware).

FarmTrack helps you watch your livestock using GPS. You draw a virtual fence on a
map, and the app tells you when an animal gets close to it, crosses it, runs low
on battery, or stops moving.

Built with **Expo (React Native)** and **Supabase**.

## Contents

1. [What the app does](#1-what-the-app-does)
2. [Tech used](#2-tech-used)
3. [Getting started](#3-getting-started)
4. [Running the app](#4-running-the-app)
5. [Using the development build (Android)](#5-using-the-development-build-android)
6. [Database](#6-database)
7. [How the map and fences work](#7-how-the-map-and-fences-work)
8. [Live updates](#8-live-updates)
9. [Known limits](#9-known-limits)
10. [Troubleshooting](#10-troubleshooting)
11. [What changed in this version](#11-what-changed-in-this-version)

---

## 1. What the app does

- Shows your animals on a live map.
- Lets admins draw, edit, and delete fences.
- Sends alerts for:
  - **Approach warning** — an animal is near a fence.
  - **Boundary breach** — an animal crossed a fence.
  - **Low battery** — a collar needs charging.
  - **Stationary** — an animal has not moved for a while.
- Plays a sound, vibrates, and shows a banner when an alert happens.

**Demo mode:** if you do not set up Supabase, the app still runs using fake data
from [src/data/mockData.ts](src/data/mockData.ts). This is good for trying the UI.

---

## 2. Tech used

| Part | What we use |
| --- | --- |
| App framework | Expo SDK 57 + Expo Router (pages are files in `src/app`) |
| Backend | Supabase (Postgres + PostGIS) |
| Map (phone) | MapLibre (`@maplibre/maplibre-react-native`), drawing OpenStreetMap / Esri tiles. No Google Maps, no API key. |
| Map (web) | A simple SVG map |
| State | `useFarmData` hook + `zustand` for login state |

### Folder guide

```
app/
├── src/
│   ├── app/          Screens. (auth) = login, (tabs) = main tabs
│   ├── components/   UI pieces, including the map
│   ├── hooks/        useFarmData, useAlarm
│   ├── stores/       FarmDataContext, authStore
│   ├── lib/          supabase.ts, utils.ts
│   └── data/         mockData.ts (demo data)
├── supabase/
│   ├── schema.sql          original database setup (app tables + fence logic)
│   ├── verify_setup.sql    read-only health check - run this to test the DB
│   └── gateway_ingest.sql  design notes only - DO NOT RUN
├── app.json          Expo settings, permissions, plugins
└── eas.json          Cloud build settings
```

---

## 3. Getting started

### What you need first

- [Node.js](https://nodejs.org) (LTS version)
- A free [Expo account](https://expo.dev/signup) (needed for cloud builds)
- The team's Supabase URL and anon key, plus your own login (email + password).
  Ask the project owner. (Skip this to try demo mode.)
- An Android phone (for the development build)

### Step 1 — Install packages

```bash
cd app
npm install
```

### Step 2 — Add your settings

Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional — free map key from https://cloud.maptiler.com
EXPO_PUBLIC_MAPTILER_KEY=
```

Paste in the URL and anon key from the project owner. Leave the placeholder
values as they are to use demo mode. `.env` is git-ignored — never commit it.

### Step 3 — Check the database

The team shares one Supabase project that is already set up. **Do not run
`schema.sql` on it.** Instead, check it is healthy:

1. Open the Supabase dashboard → **SQL Editor** → **New query**.
2. Paste in all of [supabase/verify_setup.sql](supabase/verify_setup.sql) and click **Run**.
3. Read the `status` column. `OK` = good, `INFO` = just for reading. Anything
   else names the thing to fix.

It only reads — it never changes anything.

### Step 4 — Log in with your real account

Start the app (next section) and sign in with your **email and password**.

> The small **Admin** / **Staff** links under the Sign In button open **demo
> mode**. Demo mode never talks to Supabase, so the map stays empty. Use them
> only to look around the UI.

---

## 4. Running the app

There are two ways to run the app on your phone.

| | Expo Go | Development build |
| --- | --- | --- |
| What it is | A ready-made app from the Play Store | Your own copy of FarmTrack with dev tools inside |
| Setup | None | Build once (about 10–20 min) |
| Native features (push notifications, background location) | Limited | Full support |
| Best for | Quick look at the UI | Real testing and daily work |

**We recommend the development build.** FarmTrack uses background location and
notifications, which do not work fully in Expo Go.

To try Expo Go quickly:

```bash
npx expo start
```

Then scan the QR code with the Expo Go app.

---

## 5. Using the development build (Android)

A development build is your own app (an APK file) that connects to your computer
while you code. You build it **once**. After that, code changes show up on your
phone right away.

### Step 1 — Install `expo-dev-client`

This package is already installed in this project. If you ever need to add it
again, run:

```bash
npx expo install expo-dev-client
```

Use `npx expo install` (not `npm install`) so you get the version that matches
your Expo SDK (currently 57).

### Step 2 — Log in to Expo

```bash
npx eas-cli login
```

### Step 3 — Build the app in the cloud

```bash
npx eas-cli build --profile development --platform android
```

- The `development` profile is set up in [eas.json](eas.json) with
  `developmentClient: true`. That is what makes it a dev build.
- The first time, EAS may ask you to create an Android keystore. Say **yes** and
  let it do this for you.
- Wait for the build to finish. You get a link and a QR code.

### Step 4 — Install the APK on your phone

1. Open the build link or scan the QR code on your phone.
2. Download the APK and open it.
3. If Android asks, allow **Install unknown apps** for your browser.

When you open the app, you should see a **Development servers** screen. If the app
opens straight into FarmTrack instead, that build is not a development build. Build
again using the `development` profile above.

### Step 5 — Start the dev server

On your computer:

```bash
npx expo start --dev-client
```

(You can also run `npx expo start` and press `s` to switch to the development build.)

### Step 6 — Connect your phone

1. Make sure your phone and computer are on the **same Wi-Fi**.
2. Open FarmTrack on your phone.
3. Pick your computer from **Development servers**, or scan the QR code in the
   terminal.

The app loads. Save a file and the app updates by itself.

### When do I need to build again?

| You did this | Build again? |
| --- | --- |
| Changed a screen, style, or normal code | No |
| Changed `.env` values | No (restart `npx expo start`) |
| Added a package that has native code | **Yes** |
| Added or changed a plugin, permission, or icon in `app.json` | **Yes** |
| Upgraded the Expo SDK | **Yes** (the app and the dev build must be the same SDK) |

### Build on your own computer instead (optional)

If you have Android Studio installed, you can skip the cloud:

```bash
npx expo run:android
```

This also creates a development build, but it needs a working Android setup.

### Cloud build profiles

| Profile | Use it for |
| --- | --- |
| `development` | Daily work. Connects to your computer. |
| `preview` | A standalone APK to test or share. Does **not** connect to your computer. |
| `production` | The release build for the store. |

> A `preview` or `production` build cannot connect to your dev server. If you
> installed one of those by mistake, build again with `--profile development`.

---

## 6. Database

| File | What it is | Run it? |
| --- | --- | --- |
| [supabase/schema.sql](supabase/schema.sql) | The original setup: app tables, fence logic, security rules | Only on a **brand-new, empty** project (see the warning below) |
| [supabase/verify_setup.sql](supabase/verify_setup.sql) | Health check, plus copy-paste SQL for gateways and a no-hardware test | **Yes**, any time — it only reads |
| [supabase/gateway_ingest.sql](supabase/gateway_ingest.sql) | Early design for the gateway upload | **No — never.** It clashes with the live database |

> **Warning — `schema.sql` is not the full live database.** The live project also
> has a `gateways` table, the `ingest_telemetry()` function the gateway calls,
> `seq` / `rssi` / `snr` / `gateway_id` columns on `location_logs`, and `'LoRa'`
> as a connection type. None of that is in `schema.sql` yet, so a new project
> built from it alone will show the app but will not accept data from the
> gateway. Everyone should use the shared project.

### Tables

| Table | What it stores |
| --- | --- |
| `profiles` | Users. Role is `admin` or `staff`. Created automatically at signup. |
| `collars` | The tracking devices: battery, signal, firmware, last ping. |
| `livestock` | Animals. Each can be linked to a collar. Has a health and status. |
| `geofences` | Fence shapes (polygons) and a warning distance in meters. |
| `location_logs` | GPS history for each collar. Only added to, never edited. |
| `alerts` | Approach, breach, low battery, stationary, and info alerts. |
| `gateways` | Registered LoRa gateways and a hash of each one's secret. *(live DB only)* |

An animal's status is one of: `grazing`, `near_boundary`, `breach`, `resting`.

### Built-in logic

- **`detect_geofence_events()`** — runs every time a new GPS point is saved. It
  checks the point against all active fences, updates the animal's status, and
  creates an alert when needed.
- **`get_geofences_geojson()`** — returns fences as GeoJSON so the app can use
  them directly.
- **`upsert_geofence(...)`** — lets an admin create or update a fence.
- **`latest_livestock_locations`** — a view that gives each animal's newest
  position. The map uses it.

### Who can do what

- Any logged-in user can **read** data.
- Only **admins** can create or change collars, livestock, fences, and alerts.
- New accounts start as `staff`. To make someone an admin, run in the SQL Editor:

  ```sql
  UPDATE public.profiles SET role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'their@email.com');
  ```

### Add a new team member

1. Supabase dashboard → **Authentication** → **Users** → **Add user**.
2. Enter their email and a password. Their profile is created automatically.
3. Make them an admin if needed (SQL above).

### Register a gateway

The gateway proves who it is with a secret (`GATEWAY_SECRET` in
`firmware/src/secrets.h`). The database stores only a SHA-256 hash of it. To
register a new gateway, pick a long random secret and run:

```sql
INSERT INTO public.gateways (name, api_key_hash)
VALUES ('Barn Gateway',
        encode(digest('PASTE_YOUR_GATEWAY_SECRET_HERE', 'sha256'), 'hex'));
```

More (check a secret, change a secret, test upload without hardware) is at the
bottom of [verify_setup.sql](supabase/verify_setup.sql).

### Register a collar and pair it with an animal

When the collar starts it prints its ID, like `id=FT-EC82C34C`. Until that collar
is paired with an animal, its positions are saved but **no alerts fire**.

1. Add the collar (safe to run even if it is already there):

   ```sql
   INSERT INTO public.collars (device_hardware_id, connection_type)
   VALUES ('FT-XXXXXXXX', 'LoRa')
   ON CONFLICT (device_hardware_id) DO NOTHING;
   ```

2. Pair it with an animal:

   ```sql
   UPDATE public.livestock
   SET collar_id = (SELECT id FROM public.collars WHERE device_hardware_id = 'FT-XXXXXXXX')
   WHERE tag_id = 'YOUR-ANIMAL-TAG';
   ```

3. Run `verify_setup.sql` again. Row 12 should say `OK`.

---

## 7. How the map and fences work

The map screen is [src/app/(tabs)/map.tsx](src/app/(tabs)/map.tsx). It uses:

- [RanchMap](src/components/map/RanchMap.tsx) — draws animals, saved fences, and
  the fence you are drawing. Fences change color when there is a warning or a breach.
- [FenceDrawingPanel](src/components/map/FenceDrawingPanel.tsx) — buttons to start,
  undo a point, finish, or cancel.
- [CreateFenceModal](src/components/map/CreateFenceModal.tsx) — asks for a name,
  color, and warning distance when you finish drawing.
- [FenceListPanel](src/components/map/FenceListPanel.tsx) — list of fences, with
  delete and an undo message.
- [useAlarm](src/hooks/useAlarm.tsx) — sound, vibration, and on-screen alert when
  your phone's GPS or an animal crosses a fence.

The map frames all animals and fences when it opens. An animal's marker only
moves when its position changes by more than 6 m, so GPS jitter does not make a
standing animal wander on screen. This is display only — the database still
checks every reading.

The app checks fences on the phone too, so you get an instant alert. The database
still creates the official saved alerts.

Coordinates are `{ latitude, longitude }` inside the app. They are converted to
GeoJSON `[lng, lat]` only when talking to Supabase (see
[src/lib/utils.ts](src/lib/utils.ts)).

---

## 8. Live updates

`useFarmData` listens for new rows in the `alerts` table, so new alerts show up
right away. It reloads animal positions and fences when the app opens and after
any change you make.

---

## 9. Known limits

- **Map tiles.** On phones the map is MapLibre, which needs no API key and no
  Google Play Services. It draws OpenStreetMap and Esri tiles directly. Without
  `EXPO_PUBLIC_MAPTILER_KEY`, "Standard" uses OpenTopoMap, which is free but not
  meant for a released app, and stops at zoom 17. Get a free
  [MapTiler](https://cloud.maptiler.com) key before you ship. See the note in
  [RanchMap.native.tsx](src/components/map/RanchMap.native.tsx) for why some other
  free tile servers do not work.
- **No rubber-band preview while drawing a fence.** When you place fence points,
  there is no dashed line following your finger to preview the next segment.
  MapLibre does not report a finger position during a drag. Tapping to place
  points, dragging a point to move it, and tapping a point to delete it all work
  normally.
- **Web map.** The web version uses a simple SVG map fixed to `RANCH_REGION` in
  [src/constants/theme.ts](src/constants/theme.ts). It is fine for one ranch, not
  for general use.
- **GPS jitter.** Each fence has its own warning distance to help with this. There
  is no "wait for several readings" check yet, so an animal right on the line may
  cause repeated alerts.

---

## 10. Troubleshooting

| Problem | Try this |
| --- | --- |
| App opens straight into FarmTrack and never shows "Development servers" | You installed a `preview` or `production` build. Build again with `--profile development`. |
| Phone cannot find my computer | Use the same Wi-Fi. Or run `npx expo start --dev-client --tunnel`. |
| Changes do not show up | Shake the phone and tap **Reload**. Or restart with `npx expo start --dev-client --clear`. |
| Red error about a missing native module | You added a native package. Build a new development build. |
| Map is blank | Check your internet connection. Try adding a MapTiler key. |
| Crash: `API key not found ... com.google.android.geo.API_KEY` | An old build that still used `react-native-maps` (Google Maps). Uninstall it and install a fresh development build. |
| Only demo data shows / map is empty | You tapped **Admin** or **Staff** (demo mode) — sign in with email and password instead. Or `.env` is missing or still has placeholders: set them and restart `npx expo start`. |
| Animal shows on the map but no alerts | Its collar is not paired with the animal, or no fence is active. Run `verify_setup.sql` (rows 11 and 12). |
| App crashes after pulling this version | Run `npm install`, then install a **new** development build (the SDK changed). |
| Wrong package versions | Run `npx expo install --check` to see and fix them. |

---

## 11. What changed in this version

**Added**

- `expo-dev-client` and [eas.json](eas.json) — the Android development build
  ([section 5](#5-using-the-development-build-android)).
- [supabase/verify_setup.sql](supabase/verify_setup.sql) — read-only health check
  plus copy-paste SQL for gateways and a no-hardware test upload.
- [supabase/gateway_ingest.sql](supabase/gateway_ingest.sql) — design notes only,
  **do not run**.
- `LocationLog` type now has `seq`, `rssi`, `snr`, `gateway_id`
  ([src/types/database.ts](src/types/database.ts)).
- Android location permissions and the MapLibre, `expo-audio`, and other plugins
  in [app.json](app.json).

**Changed**

- Upgraded to **Expo SDK 57** (React Native 0.86, React 19.2, TypeScript 6).
- Map moved from Google Maps (`react-native-maps`) to **MapLibre** — no API key.
- Alarm sound moved from `expo-av` to **`expo-audio`**.
- Map camera frames animals and fences instead of your phone; 6 m marker deadband.
- The `latest_livestock_locations` view in the live database now averages each
  animal's last 5 fixes.

**Removed**

- `react-native-maps` and `expo-av`.

**After pulling:** run `npm install`, then build and install a new development
build — old builds will not work with SDK 57.
