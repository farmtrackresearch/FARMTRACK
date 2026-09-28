import type { IconName } from '@/components/ui/tones';

/**
 * One icon per section, used by the tab bar and each screen header, so adding
 * a section only means adding one entry here. [inactive, active].
 */
export const SectionIcons = {
  dashboard: ['home-variant-outline', 'home-variant'],
  map: ['map-outline', 'map'],
  analytics: ['chart-box-outline', 'chart-box'],
  hardware: ['access-point', 'access-point'],
  alerts: ['bell-outline', 'bell'],
} as const satisfies Record<string, readonly [IconName, IconName]>;

export type SectionKey = keyof typeof SectionIcons;
