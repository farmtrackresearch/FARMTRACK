import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * MapLibre renders from a style document, not a tile URL. Both styles below
 * draw OpenStreetMap data — only the host and the tile format differ.
 *
 * `tile.openstreetmap.org` is deliberately absent: it answers app traffic with
 * an `x-blocked` header and a "403 Access blocked" placeholder image rather
 * than map data (https://operations.osmfoundation.org/policies/tiles/), so a
 * host licensed to serve apps is required. A 200 status is not proof of a
 * usable tile — check the pixels.
 */
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

export const MAP_KEY_CONFIGURED = Boolean(MAPTILER_KEY);

/**
 * Keyless fallback so the app still draws a map before anyone signs up.
 * Raster, volunteer-run, ~1s per tile and capped at z17 — usable for a demo,
 * far too coarse to place fence vertices around a single pasture.
 */
const RASTER_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
};

/**
 * With a key this is a *vector* style: the GPU rasterises it on device, so
 * panning and zooming stay smooth and labels stay sharp at any zoom, instead
 * of waiting on a 256px PNG per tile.
 */
export const MAP_STYLE: string | StyleSpecification = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : RASTER_FALLBACK_STYLE;

export const MAP_MAX_ZOOM = MAPTILER_KEY ? 20 : 17;

/** Licence line, shown over the map. Required wherever OSM-derived tiles render. */
export const MAP_ATTRIBUTION = MAPTILER_KEY
  ? '© MapTiler © OpenStreetMap contributors'
  : '© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors';

/** Zoom beyond which the active source stops adding detail. */
export const MAP_FALLBACK_MAX_ZOOM = 17;
