#!/usr/bin/env node
/**
 * Keeps Expo's iOS simulator choice pointed at a device that actually exists.
 *
 * Pressing `i` in `expo start` boots whatever UDID is stored in the old
 * Simulator app's `CurrentDeviceUDID` preference. Xcode 27 replaced Simulator
 * with Device Hub, which never updates that preference, so once a simulator is
 * deleted the value goes stale and Expo fails with
 * "Invalid device or device pair".
 *
 * Runs automatically before `npm start` and `npm run ios`. Picks, in order:
 *   1. an iPhone that is already booted
 *   2. the saved device, if it still exists
 *   3. the device named by $SIM_DEVICE (default "iPhone 18 Pro")
 *   4. the first available iPhone on the newest iOS runtime
 */
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const PREF_DOMAIN = 'com.apple.iphonesimulator';
const PREF_KEY = 'CurrentDeviceUDID';
const PREFERRED = process.env.SIM_DEVICE || 'iPhone 18 Pro';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let devices;
try {
  const { devices: byRuntime } = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']));
  devices = Object.entries(byRuntime)
    .filter(([runtime]) => runtime.includes('iOS'))
    // newest runtime first, so fallbacks prefer the SDK the app builds against
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(([, list]) => list)
    .filter((d) => d.isAvailable !== false && d.name.startsWith('iPhone'));
} catch {
  process.exit(0); // no Xcode / simctl: nothing to fix, never block startup
}

if (devices.length === 0) {
  console.warn('[sync-simulator] No iPhone simulators installed — add one in Device Hub.');
  process.exit(0);
}

let saved = null;
try {
  saved = run('defaults', ['read', PREF_DOMAIN, PREF_KEY]).trim();
} catch {}

const pick =
  devices.find((d) => d.state === 'Booted') ||
  devices.find((d) => d.udid === saved) ||
  devices.find((d) => d.name === PREFERRED) ||
  devices[0];

if (pick.udid === saved) {
  console.log(`[sync-simulator] Using ${pick.name} (${pick.udid})`);
  process.exit(0);
}

run('defaults', ['write', PREF_DOMAIN, PREF_KEY, pick.udid]);
const savedExists = devices.some((d) => d.udid === saved);
const reason = !saved
  ? ''
  : savedExists
    ? `${pick.name} is already running — `
    : `saved device ${saved} no longer exists — `;
console.log(`[sync-simulator] ${reason}switched to ${pick.name} (${pick.udid})`);
