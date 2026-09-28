# FarmTrack — Mobile App

> Part of the [FarmTrack](../README.md) project. The collar and gateway firmware is in [`../firmware`](../firmware).
> Database setup, upgrades and admin SQL are in [`supabase/README.md`](supabase/README.md).

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
6. [EAS environment variables](#6-eas-environment-variables)
7. [Push notifications setup](#7-push-notifications-setup)
8. [Database](#8-database)
9. [Alerts and the alarm](#9-alerts-and-the-alarm)
10. [Pairing a collar](#10-pairing-a-collar)
11. [Emergency Disable](#11-emergency-disable)
12. [How the map and fences work](#12-how-the-map-and-fences-work)
13. [Live updates](#13-live-updates)
14. [Known limits](#14-known-limits)
15. [Troubleshooting](#15-troubleshooting)
16. [What changed in this version](#16-what-changed-in-this-version)

---

## 1. What the app does

- Shows your animals on a live map. A marker turns **grey** when its collar has
  not sent a position for 3 minutes.
- Lets admins draw, edit, switch off, and delete fences.
- Alerts you when an animal nears a fence, crosses it, has a low collar battery,
  or stops moving (see [section 9](#9-alerts-and-the-alarm)).
- Sounds a siren in the app while an animal is outside the fence, and sends a
  push notification that reaches a locked phone.
- **Emergency Disable** silences every collar's buzzer for 60 minutes.

The database decides whether an animal is safe, near the fence, or outside it.
The app shows that decision; it never overrides it.

### Demo mode

If the build has **no Supabase keys** (`EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` missing or still placeholders), the app runs in
demo mode:

- The login screen shows **Continue as Admin (demo)** / **Continue as Staff
  (demo)** instead of the email form.
- A notice at the top of every screen says **Demo mode – not connected**.
- The app never calls Supabase. There are no animals; fences you draw exist only
  on that phone until you sign out.

With Supabase keys set, the demo links do not exist at all, so a published app
can only be used with a real login.

---

## 2. Tech used

| Part | What we use |
| --- | --- |
| App framework | Expo SDK 57 + Expo Router (pages are files in `src/app`) |
| Backend | Supabase (Postgres + PostGIS + Realtime) |
| Map (phone) | MapLibre (`@maplibre/maplibre-react-native`). Imagery from MapTiler with `EXPO_PUBLIC_MAPTILER_KEY`. No Google Maps. |
| Map (web) | A simple SVG map |
| Alerts | `expo-notifications` (push + Android channels), `expo-audio` (in-app siren) |
| State | `useFarmData` hook + `zustand` for login state |

### Folder guide

```
app/
├── src/
│   ├── app/          Screens. (auth) = login, (tabs) = main tabs, livestock/ = animal pages
│   ├── components/   UI pieces, including the map and the alarm overlay
│   ├── hooks/        useFarmData (data + realtime), useAlarm (siren), usePushRegistration
│   ├── stores/       FarmDataContext, authStore
│   ├── lib/          supabase.ts, utils.ts (fence rules), breachStateMachine.ts, pushNotifications.ts
│   ├── types/        database.ts (hand-kept copy of the database shape)
│   └── data/         mockData.ts (demo mode)
├── supabase/         SQL and its own README (owned by the database docs)
├── app.json          Expo settings, permissions, plugins
├── app.config.ts     Adds the Firebase file for Android push (reads app.json)
├── eas.json          Cloud build profiles, each tied to an EAS environment
└── eslint.config.js  Lint rules (npm run lint)
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

# Free map key from https://cloud.maptiler.com (needed for preview/production builds)
EXPO_PUBLIC_MAPTILER_KEY=
```

`.env` is only read on your computer (`npx expo start`, local builds). Cloud
builds read the same names from EAS environment variables instead — see
[section 6](#6-eas-environment-variables). `.env` is git-ignored; never commit it.

### Step 3 — Check the database

Follow [supabase/README.md](supabase/README.md). This version of the app needs
the **v2 database update** (it adds `farm_settings`, `push_tokens`,
`set_collars_muted()`, the new fence rules and push sending). Against an older
database the app still loads, but Emergency Disable, push notifications,
low-battery and stationary alerts do not work.

### Step 4 — Log in with your real account

Start the app (next section) and sign in with your **email and password**.

---

## 4. Running the app

There are two ways to run the app on your phone.

| | Expo Go | Development build |
| --- | --- | --- |
| What it is | A ready-made app from the Play Store | Your own copy of FarmTrack with dev tools inside |
| Setup | None | Build once (about 10–20 min) |
| Push notifications | **No** (Android, SDK 53+) | Yes |
| Map (MapLibre native code) | No | Yes |
| Best for | Nothing, for this app | Real testing and daily work |

**Use the development build.** FarmTrack needs native code (MapLibre, push
notifications) that Expo Go does not have.

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

- The `development` profile in [eas.json](eas.json) has `developmentClient: true`
  and `"environment": "development"`, so it uses the **development** EAS
  environment variables ([section 6](#6-eas-environment-variables)).
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
| Changed a plugin, permission, or icon in `app.json`, or `google-services.json` | **Yes** |
| Upgraded the Expo SDK | **Yes** (the app and the dev build must be the same SDK) |

**This version changed permissions, plugins and native packages, so you need a
new development build.**

### Build on your own computer instead (optional)

If you have Android Studio installed, you can skip the cloud:

```bash
npx expo run:android
```

This also creates a development build, but it needs a working Android setup.

### Cloud build profiles

| Profile | EAS environment | Use it for |
| --- | --- | --- |
| `development` | `development` | Daily work. Connects to your computer. |
| `preview` | `preview` | A standalone APK to test or share. Does **not** connect to your computer. |
| `production` | `production` | The release build for the store. |

> A `preview` or `production` build cannot connect to your dev server. If you
> installed one of those by mistake, build again with `--profile development`.

---

## 6. EAS environment variables

Cloud builds do not see your `.env`. Each build profile reads the EAS environment
named in [eas.json](eas.json). Set these three once per environment
(`development`, `preview`, `production`):

| Name | Value | Visibility |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Your project URL | `plaintext` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your project's anon key | `sensitive` |
| `EXPO_PUBLIC_MAPTILER_KEY` | Your MapTiler key | `sensitive` |

`EXPO_PUBLIC_*` values are built into the app, so anyone with the app can read
them. That is expected for the anon key (the database's access rules protect
the data), but never put a real secret, such as the Supabase service role key,
in an `EXPO_PUBLIC_` variable. For the same reason do not use `secret`
visibility for them.

```bash
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-PROJECT.supabase.co \
  --visibility plaintext --environment development --environment preview --environment production
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR-ANON-KEY \
  --visibility sensitive --environment development --environment preview --environment production
npx eas-cli env:set --name EXPO_PUBLIC_MAPTILER_KEY --value YOUR-MAPTILER-KEY \
  --visibility sensitive --environment development --environment preview --environment production
```

(`env:set` creates or updates a variable. Older eas-cli versions called it
`env:create`.) Check them with `npx eas-cli env:list development`.

Without `EXPO_PUBLIC_MAPTILER_KEY`, **development** builds fall back to free test
map servers, but **preview and production** builds show no map imagery (fences
and animals still draw) because those servers do not allow app traffic.

---

## 7. Push notifications setup

Push is how a breach reaches a phone that is locked or has the app closed. The
database sends it through Expo's push service when it creates an alert
(breaches on the Android channel `alarms`, low battery and stationary on
`alerts`). After login the app registers the phone with the database function
`register_push_token()` (which also takes the phone over from a previous user),
and removes it from `push_tokens` when you sign out. Signing out ends only that
phone's session, so other phones using the same login stay signed in.

Android needs Firebase (FCM). Do this once:

1. **Create a Firebase project** at <https://console.firebase.google.com>.
2. **Add an Android app** to it with package name `com.farmtrack.app` (from
   `android.package` in [app.json](app.json)).
3. **Download `google-services.json`** and save it as `app/google-services.json`.
   It is git-ignored here; Firebase says it only holds public identifiers, but
   keeping it out of git keeps the project ID out of the public repo.
   [app.config.ts](app.config.ts) picks it up for local builds automatically.
4. **Give cloud builds the same file** as a file-type EAS variable:

   ```bash
   npx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
     --visibility secret --environment development --environment preview --environment production
   ```

   During an EAS build `GOOGLE_SERVICES_JSON` holds the path of that file, and
   [app.config.ts](app.config.ts) uses it for `android.googleServicesFile`.
5. **Upload the FCM V1 key** so Expo can send to Android:
   1. Firebase console → Project settings → **Service accounts** →
      **Generate new private key**. Keep this JSON file private (never commit it).
   2. Run `npx eas-cli credentials`, then choose **Android** → **production** →
      **Google Service Account** → **Manage your Google Service Account Key for
      Push Notifications (FCM V1)** → **Set up a Google Service Account Key for
      Push Notifications (FCM V1)** → **Upload a new service account key**.
6. **Build a new development build** ([section 5](#5-using-the-development-build-android)).

Without steps 1–4 the app still works: in-app alerts and the siren work while the
app is open, but the phone cannot get a push token, so nothing arrives while it
is closed. iOS push additionally needs an Apple Developer account (EAS sets up
the push key during `eas build` for iOS).

---

## 8. Database

Everything about the database — the one-time v2 upgrade, checking it is healthy,
registering a gateway, adding users and admins — is in
[supabase/README.md](supabase/README.md).

What the app relies on:

| Thing | Used for |
| --- | --- |
| `livestock.animal_status` | The animal's fence state, decided by the database for every reading. Drives map colours and the siren. |
| `latest_livestock_locations` view | Map positions (average of the last 5 fixes), `last_seen_at`, `last_ping_at`, satellites |
| `alerts` | Alert list. The database creates and auto-resolves fence alerts. |
| `get_geofences_geojson()` / `upsert_geofence()` | Reading and saving fences (admins only) |
| `farm_settings` + `set_collars_muted()` | Emergency Disable |
| `push_tokens` + `register_push_token()` | Which phones get push notifications |

Roles: after the v2 database update, new accounts always start as **staff** and
users can no longer change their own role; this is enforced by the database, not
the app. Only an admin can promote someone (see
[supabase/README.md](supabase/README.md)). Staff can see everything, resolve
alerts and use Emergency Disable; only admins can manage fences, animals and
collars.

---

## 9. Alerts and the alarm

| Alert | When the database raises it | Clears itself when |
| --- | --- | --- |
| **Boundary breach** | The animal is outside every active fence | It is at least 3 m back inside |
| **Approach warning** | Inside a fence but within that fence's warning distance of the edge | It is more than the warning distance + 3 m inside |
| **Low battery** | Collar battery below 20 % | Battery back to 30 % or more |
| **Stationary** | The animal moved less than 15 m in 60 minutes | The animal moves |

The 3 m margins stop GPS jitter from flipping an animal on the line in and out of
alarm. Alerts are only created when the state changes, not on every reading.

How a breach reaches you:

- **App open:** a full-screen alarm with a siren and vibration, on every screen.
  Several animals can alarm at once; **Acknowledge** stops one, **View animal**
  opens it. After 5 minutes the sound stops but the alarm card stays until the
  animal is back inside or you acknowledge it. When the database says the animal
  is back inside, the alarm stops by itself.
- **App closed or phone locked:** a push notification on the high-priority
  `alarms` channel (needs [section 7](#7-push-notifications-setup)). The app
  never plays sound in the background.
- On opening the app, any animal still outside starts the alarm again.

The first time you sign in, the app asks for notification permission (not at
launch). On Android you can tune the **Fence breach alarms** and **Farm alerts**
channels in the phone's notification settings.

In the **Alerts** tab, tapping an alert opens the animal. **Resolve** removes an
alert from the open list after you confirm; fence alerts normally resolve
themselves.

---

## 10. Pairing a collar

1. Switch the collar on near the gateway.
2. Within a minute it appears in the **Hardware** tab under **Unassigned
   collars**, named by its ID (`FT-XXXXXXXX`, also printed on the collar's serial
   console at start-up). The database registers new collars automatically.
3. Tap **Pair** (admins only), then either pick an existing animal that has no
   collar, or fill in a new animal, and save.

To move a collar to another animal, open the animal → **Edit** → choose the
collar (or **No collar**). A collar only raises fence alerts once it is paired
with an animal.

---

## 11. Emergency Disable

On the dashboard, **Emergency Disable** silences every collar's buzzer for **60
minutes** — for example while you walk the herd through a fence line on purpose.

- The collars get "safe" from the gateway at their next report, so they stop
  beeping within a few seconds.
- Fence alerts, the in-app alarm and push notifications **keep working**.
- A banner shows the end time with **Unmute now**. It ends by itself after 60
  minutes.

It needs the v2 database (`set_collars_muted()`); any signed-in user can use it.

---

## 12. How the map and fences work

The map screen is [src/app/(tabs)/map.tsx](src/app/(tabs)/map.tsx). It uses:

- [RanchMap](src/components/map/RanchMap.native.tsx) — draws animals (native map
  layers), saved fences, and the fence you are drawing. Switched-off fences are
  drawn grey. There is a separate simple web version.
- [FenceDrawingPanel](src/components/map/FenceDrawingPanel.tsx) — undo a point,
  clear, save, or cancel.
- [CreateFenceModal](src/components/map/CreateFenceModal.tsx) — asks for a name
  and lets you start from a shape.
- [SaveBoundaryModal](src/components/map/SaveBoundaryModal.tsx) — sets the
  **warning distance** (1–500 m, default 30 m) and whether the fence is
  **active**, then saves.
- [FenceListPanel](src/components/map/FenceListPanel.tsx) — list of fences, with
  delete and an undo message.

The map frames all animals and fences when it opens. An animal's marker only
moves when its position changes by more than 6 m, so GPS jitter does not make a
standing animal wander on screen. This is display only — the database still
checks every reading.

**Check my position** (the chip under the title) compares your phone's GPS with
the fences using the same rules as the database. It is off by default, asks for
location permission only when you switch it on, runs only while the Map tab is
open, and shows its result in that chip — it never sets off the livestock alarm.

Coordinates are `{ latitude, longitude }` inside the app. They are converted to
GeoJSON `[longitude, latitude]` only when talking to Supabase or MapLibre (see
[src/lib/utils.ts](src/lib/utils.ts)).

---

## 13. Live updates

`useFarmData` loads everything once after sign-in, then listens to Supabase
Realtime:

| Table | What the app does |
| --- | --- |
| `alerts` | Adds new alerts, applies resolves; a breach starts the alarm |
| `livestock` | Applies status changes (drives map colours and stops the alarm) |
| `location_logs` | Re-reads positions, at most every 1.5 s |
| `collars` | Applies battery / last-heard updates; new collars appear for pairing |
| `geofences` | Re-reads fences |
| `farm_settings` | Applies Emergency Disable changes |

If the connection drops, the dashboard pill shows **Reconnecting…** and the app
keeps the last data. If the login session has expired, the app says
"Session expired – reconnecting" and keeps the last data rather than showing an
empty farm. When it reconnects, and whenever the app comes back to the
foreground, it re-reads everything so nothing missed is lost. If a refresh
fails, the dashboard says so instead of showing empty data. If a collar stops
reporting, its marker turns grey after 3 minutes and it counts as offline.

---

## 14. Known limits

- **Map imagery** needs `EXPO_PUBLIC_MAPTILER_KEY` in preview/production builds
  ([section 6](#6-eas-environment-variables)).
- **No rubber-band preview while drawing a fence** on phones. MapLibre does not
  report a finger position during a drag. Tapping, dragging and deleting points
  all work.
- **Web map.** A simple SVG preview, fine for one farm, not a real map.
- **Training success** (Analytics) is worked out from the alerts the app has
  loaded: every open alert plus the latest 100.
- **No vibration motor** is fitted to the collars; the app says so.
- **App icon and splash** are still the Expo template artwork.

---

## 15. Troubleshooting

| Problem | Try this |
| --- | --- |
| App opens straight into FarmTrack and never shows "Development servers" | You installed a `preview` or `production` build. Build again with `--profile development`. |
| Phone cannot find my computer | Use the same Wi-Fi. Or run `npx expo start --dev-client --tunnel`. |
| Changes do not show up | Shake the phone and tap **Reload**. Or restart with `npx expo start --dev-client --clear`. |
| Red error about a missing native module | You added a native package. Build a new development build. |
| Map is grey with "Map imagery off" | Set `EXPO_PUBLIC_MAPTILER_KEY` for that EAS environment and rebuild. |
| Dashboard says **Reconnecting…** for a long time | Check the phone's internet. Pull the app to the background and back to force a refresh. |
| "Could not refresh farm data" | The phone lost signal or the database refused a query; the message says which part. |
| Only the Demo links on the login screen | The build has no Supabase keys. Set them in `.env` (local) or EAS ([section 6](#6-eas-environment-variables)) and restart / rebuild. |
| No push notifications | Use a development build (not Expo Go), finish [section 7](#7-push-notifications-setup), allow notifications, sign out and in again. |
| Animal shows on the map but no alerts | Its collar is not paired with the animal, or no fence is active. |
| Emergency Disable says it failed | The database has not had the v2 update ([supabase/README.md](supabase/README.md)). |
| App crashes after pulling this version | Run `npm install`, then install a **new** development build. |
| Wrong package versions | Run `npx expo install --check` to see and fix them. |

---

## 16. What changed in this version

**Fixed**

- An animal far outside every fence showed as "grazing" and silenced its own
  alarm. The app no longer judges animals itself; it shows the database's status.
- Live updates stopped after about an hour (token refresh). Realtime now survives
  token refreshes and reconnects, and re-reads data after any drop.
- A flaky network at start-up no longer sends you back to the login screen.
- Saving a fence ignored the warning distance and active setting; they are now
  set when saving.
- Errors when saving are shown, and the screen stays open.
- The phone GPS check no longer sets off the livestock siren.

**Added**

- Push notifications, Android channels, several alarms at once, 5-minute sound
  limit, alarm on every screen.
- Emergency Disable, stale (grey) markers, collar offline status, data age.
- Pairing from the Hardware tab, editing animals, Resolve button on alerts.
- `app.config.ts`, EAS environments per profile, ESLint (`npm run lint`).

**Removed**

- Demo buttons in builds that have Supabase keys.
- Background location, background audio, microphone and motion permissions.
- Unused packages (`expo-secure-store`, `expo-web-browser`, `expo-image`,
  `expo-device`), template images and the `reset-project` script.

**After pulling:** run `npm install`, then build and install a new development
build.
