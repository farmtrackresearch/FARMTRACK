import type { LivestockLocation, MapLatLng } from '@/types/database';

export type RanchPolygon = {
  id: string;
  name: string;
  coords: MapLatLng[];
  warningBufferMeters?: number;
};

export type RanchMapHandle = {
  fitToCoordinates: (
    coords: MapLatLng[],
    opts?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean }
  ) => void;
  /** Current visible map center — used to drop boundary templates where the user is actually looking. */
  getCenter: () => MapLatLng;
};

export type MapAppearance = 'standard' | 'satellite' | 'terrain';

export type RanchMapProps = {
  mapType: MapAppearance;
  /** Omit to hide the appearance picker — the map renders `mapType` either way. */
  onMapTypeChange?: (next: MapAppearance) => void;
  /** Latest phone GPS fix. Drives the "center on me" control; null until the first fix. */
  deviceLocation?: MapLatLng | null;
  locations: LivestockLocation[];
  polygons: RanchPolygon[];
  draftPoints: MapLatLng[];
  drawing?: boolean;
  onPressCoordinate: (coord: MapLatLng) => void;
  onDragVertex?: (index: number, coord: MapLatLng) => void;
  onDeleteVertex?: (index: number) => void;
  onMarkerPress: (livestockId: string) => void;
  onFencePress: (id: string, name: string) => void;
};
