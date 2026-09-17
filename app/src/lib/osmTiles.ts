/**
 * Single source of truth for the OpenStreetMap basemap, shared by the native
 * (`RanchMap.native.tsx`) and web (`RanchMap.tsx`) renderers.
 *
 * Two public raster sources turned out to be dead ends despite returning
 * HTTP 200: `tile.openstreetmap.org` sends an `x-blocked` header rejecting
 * app traffic (https://operations.osmfoundation.org/policies/tiles/), and
 * `basemaps.cartocdn.com` now serves a baked-in "API KEY REQUIRED" watermark
 * image instead of a real tile — a 200 status doesn't mean a usable tile,
 * always check the actual pixels. OpenTopoMap is a verified-working,
 * no-signup fallback for dev. Set EXPO_PUBLIC_MAPTILER_KEY (free tier, no
 * card required: https://cloud.maptiler.com) before shipping to production —
 * OpenTopoMap is volunteer-run and not meant for deployed-app traffic either.
 *
 * Both sources render OpenStreetMap data; only the delivery host differs.
 */
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

export const OSM_KEY_CONFIGURED = Boolean(MAPTILER_KEY);

export const OSM_TILE_URL_TEMPLATE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : 'https://tile.opentopomap.org/{z}/{x}/{y}.png';

// OpenTopoMap only renders tiles up to z17 (higher requests return a "max
// zoom layer = 17" placeholder image); MapTiler's streets style goes to 19+.
export const OSM_MAX_ZOOM = MAPTILER_KEY ? 19 : 17;

export const OSM_ATTRIBUTION = MAPTILER_KEY
  ? '© MapTiler © OpenStreetMap contributors'
  : '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors';

/** Attribution plus, in dev on the keyless fallback, why the map caps out at z17. */
export const OSM_ATTRIBUTION_LABEL =
  !OSM_KEY_CONFIGURED && __DEV__
    ? `${OSM_ATTRIBUTION} · dev tiles, z17 max — set EXPO_PUBLIC_MAPTILER_KEY`
    : OSM_ATTRIBUTION;

export const osmTileUrl = (z: number, x: number, y: number) =>
  OSM_TILE_URL_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
