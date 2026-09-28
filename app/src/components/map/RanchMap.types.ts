import type { LivestockLocation, MapLatLng } from '@/types/database';

export type RanchPolygon = {
  id: string;
  name: string;
  coords: MapLatLng[];
  warningBufferMeters?: number;
  /** Inactive fences are drawn faded; the server ignores them. */
  isActive?: boolean;
};

/** A livestock position as drawn: `stale` when the newest fix is over 3 min old. */
export type MapAnimal = LivestockLocation & { stale: boolean };

export type RanchMapHandle = {
  fitToCoordinates: (
    coords: MapLatLng[],
    opts?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean }
  ) => void;
  /** Current visible map center — used to drop boundary templates where the user is actually looking. */
  getCenter: () => MapLatLng;
  /** Zoom in (positive) or out (negative) by whole zoom levels. Drives the on-screen +/- buttons. */
  zoomBy: (delta: number) => void;
};

export type MapAppearance = 'standard' | 'satellite' | 'terrain';

export type RanchMapProps = {
  mapType: MapAppearance;
  /** Latest phone GPS fix while "check my position" is on; null otherwise. */
  deviceLocation?: MapLatLng | null;
  locations: MapAnimal[];
  polygons: RanchPolygon[];
  draftPoints: MapLatLng[];
  drawing?: boolean;
  onPressCoordinate: (coord: MapLatLng) => void;
  onDragVertex?: (index: number, coord: MapLatLng) => void;
  onDeleteVertex?: (index: number) => void;
  onMarkerPress: (livestockId: string) => void;
  onFencePress: (id: string, name: string) => void;
  /** Any tap on the map (drawing or not), e.g. to close an open menu. */
  onMapPress?: () => void;
};
