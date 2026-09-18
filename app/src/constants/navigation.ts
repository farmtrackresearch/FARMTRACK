/**
 * Centralized emoji-per-section scheme — used in both the tab bar and each
 * screen's header, so adding a new section only means adding one entry here.
 */
export const SectionEmoji = {
  dashboard: '🏠',
  map: '🗺️',
  analytics: '📈',
  hardware: '📡',
  alerts: '🚨',
} as const;

export type SectionKey = keyof typeof SectionEmoji;
