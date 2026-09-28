import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { Colors } from '@/constants/theme';
import { batteryTone } from '@/lib/utils';
import type { AnimalStatus } from '@/types/database';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Tone = 'critical' | 'warning' | 'info' | 'success' | 'neutral' | 'offline';

/** Graphic colour, text ink and soft background for each tone. */
export const ToneColors: Record<Tone, { color: string; ink: string; soft: string }> = {
  critical: { color: Colors.critical, ink: Colors.criticalInk, soft: Colors.criticalSoft },
  warning: { color: Colors.warning, ink: Colors.warningInk, soft: Colors.warningSoft },
  info: { color: Colors.info, ink: Colors.infoInk, soft: Colors.infoSoft },
  success: { color: Colors.success, ink: Colors.successInk, soft: Colors.successSoft },
  neutral: { color: Colors.textSecondary, ink: Colors.textSecondary, soft: Colors.surfaceSunken },
  offline: { color: Colors.offline, ink: Colors.offlineInk, soft: Colors.offlineSoft },
};

export type StatusKey = AnimalStatus | 'stale';

/**
 * One description per animal state, shared by map markers, the legend, status
 * pills and cards, so a state always has the same colour, icon and words.
 * Colour is never the only signal: every use pairs it with the icon or label.
 */
export const StatusMeta: Record<StatusKey, { label: string; icon: IconName; color: string; ink: string; soft: string }> = {
  grazing: { label: 'Grazing', icon: 'grass', color: Colors.grazing, ink: Colors.successInk, soft: Colors.successSoft },
  near_boundary: {
    label: 'Near fence',
    icon: 'alert-outline',
    color: Colors.nearBoundary,
    ink: Colors.warningInk,
    soft: Colors.warningSoft,
  },
  breach: {
    label: 'Outside fence',
    icon: 'alert-octagon-outline',
    color: Colors.breach,
    ink: Colors.criticalInk,
    soft: Colors.criticalSoft,
  },
  resting: { label: 'Resting', icon: 'sleep', color: Colors.resting, ink: Colors.restingInk, soft: Colors.restingSoft },
  stale: {
    label: 'No recent fix',
    icon: 'clock-alert-outline',
    color: Colors.stale,
    ink: Colors.offlineInk,
    soft: Colors.offlineSoft,
  },
};

/** A stale position is shown as stale whatever the last known fence state was. */
export function statusKey(status: AnimalStatus, stale = false): StatusKey {
  return stale ? 'stale' : status;
}

/** Battery level as a tone (bar colour) and an ink (text colour). */
export function batteryVisual(level: number | null | undefined): { tone: Tone; bar: string; ink: string } {
  switch (batteryTone(level)) {
    case 'critical':
      return { tone: 'critical', bar: Colors.critical, ink: Colors.criticalInk };
    case 'warning':
      return { tone: 'warning', bar: Colors.warning, ink: Colors.warningInk };
    case 'unknown':
      return { tone: 'offline', bar: Colors.offline, ink: Colors.textSecondary };
    default:
      return { tone: 'success', bar: Colors.success, ink: Colors.primary };
  }
}
