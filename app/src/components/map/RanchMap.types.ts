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

export type RanchMapProps = {
  mapType: 'standard' | 'satellite';
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
