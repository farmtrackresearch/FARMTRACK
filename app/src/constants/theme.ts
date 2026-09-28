/**
 * FarmTrack design tokens: "Refined pasture".
 *
 * The single source of truth for colour, type, spacing, radius and elevation.
 * Screens and components read these tokens and never hard-code values, so a
 * change here applies app-wide.
 *
 * Contrast (WCAG 2.1, checked for every pairing used as text):
 * - primary #4F7A3A: 5.0:1 on white, 4.6:1 on the cream background.
 * - White on primary 5.0:1, on primaryDark 9.9:1.
 * - primaryDark on primarySoft (sage chips) 7.7:1.
 * - textSecondary 5.8:1 on white. textMuted is 3.5:1, so it is only used for
 *   placeholders, disabled states and icons, never for small body text.
 * - Each status has a graphic colour (markers, dots, legend, accents) and an
 *   "ink" for text on its soft background, all at least 4.5:1. The warning
 *   amber is too light for text, which is why its ink is darker.
 * - accent (hay gold) is decoration only: never body text on a light surface.
 */
export const Colors = {
  // Brand
  primary: '#4F7A3A', // meadow: buttons, links, active states
  primaryPressed: '#436A30',
  primaryDark: '#2F4A24', // headers, hero, strong text on sage
  primarySoft: '#DCE7D2', // sage: tints, selected chips
  accent: '#D9A441', // hay gold: highlights, small badges, icons
  accentSoft: '#F6E9CC',

  // Surfaces
  background: '#F7F4EC', // cream
  surface: '#FFFFFF',
  surfaceAlt: '#FBF9F4', // raised/alt surface, input fill
  surfaceSunken: '#F1EDE3', // tracks, pressed rows

  // Text
  text: '#2E2A24', // bark
  textSecondary: '#6B655A',
  textMuted: '#8F887B',
  textInverse: '#FFFFFF',
  textOnDarkMuted: 'rgba(255,255,255,0.82)',

  // Lines
  border: '#E6E0D2',
  borderStrong: '#D3CAB8',

  // Semantic: graphic colour, text ink, soft background
  critical: '#B83A33',
  criticalInk: '#A8332D',
  criticalSoft: '#FBE9E7',
  warning: '#B7791F',
  warningInk: '#8C5A12',
  warningSoft: '#FBF0DC',
  info: '#4D6B82',
  infoInk: '#3F5A6E',
  infoSoft: '#E6EDF2',
  success: '#4F7A3A',
  successInk: '#2F4A24',
  successSoft: '#DCE7D2',
  offline: '#9AA0A6',
  offlineInk: '#5F666C',
  offlineSoft: '#EEF0F1',

  /** Same as `warning`. Kept for lib/utils.ts (battery colour). */
  caution: '#B7791F',

  // Animal status, used identically on markers, pills, cards and the legend.
  grazing: '#4F7A3A',
  nearBoundary: '#B7791F',
  breach: '#B83A33',
  resting: '#7A6A55',
  restingInk: '#5E5040',
  restingSoft: '#EFE9E0',
  /** Markers whose newest fix is older than STALE_AFTER_MS (lib/utils.ts). */
  stale: '#9AA0A6',

  // On the dark header
  onDark: 'rgba(255,255,255,0.12)',
  onDarkPressed: 'rgba(255,255,255,0.22)',
  onDarkBorder: 'rgba(255,255,255,0.18)',

  // Header hills (react-native-svg layers)
  hillFar: '#4F7A3A',
  hillMid: '#6E9656',

  scrim: 'rgba(30,27,22,0.5)',
  shadow: '#2E2A24',
} as const;

/** Map drawing colours (MapLibre paint and the web preview SVG). */
export const MapPalette = {
  background: '#E9E5D9',
  webPasture: '#DCE6CF',
  webPastureLine: 'rgba(79,122,58,0.10)',
  webSatellite: '#3E4A2F',
  fenceStroke: '#4F7A3A',
  fenceHalo: '#FFFFFF',
  fenceFill: 'rgba(79,122,58,0.18)',
  fenceFillDrawing: 'rgba(79,122,58,0.08)',
  inactiveStroke: '#9AA0A6',
  inactiveFill: 'rgba(154,160,166,0.10)',
  warnStroke: '#B7791F',
  warnHalo: 'rgba(183,121,31,0.28)',
  draftStroke: '#4D6B82',
  draftHalo: '#FFFFFF',
  draftFill: 'rgba(77,107,130,0.20)',
  draftGhost: 'rgba(77,107,130,0.55)',
  markerRing: '#FFFFFF',
  markerHaloOpacity: 0.28,
  labelText: '#2E2A24',
  labelHalo: '#FFFFFF',
  attributionBg: 'rgba(255,255,255,0.82)',
  /** Near-invisible fill that keeps Android map annotations hit-testable. */
  hitArea: 'rgba(0,0,0,0.01)',
} as const;

/** 4/8/12/16/20/24/32 spacing scale. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Layout constants shared by every screen. */
export const Layout = {
  /** Horizontal padding of every screen's content. */
  screenPadding: 16,
  /** Gap between stacked cards/sections. */
  sectionGap: 24,
  /** Space kept free below the last item of a scroll view. */
  scrollBottom: 32,
  /** Height of the tab bar content, excluding the bottom safe-area inset. */
  tabBarHeight: 62,
  /** Height of the rolling-hills edge under the tab headers. */
  hillsHeight: 28,
  hillsHeightCompact: 16,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/** One soft shadow for raised elements (floating map UI, sheets, the alarm). Everything else uses hairline borders. */
export const Shadows = {
  raised: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

/** Poppins weight files. RN does not synthesise weights, so each style names its file (never set fontWeight). */
export const FontFamily = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/** Type scale. Every Text in the app uses one of these. */
export const Typography = {
  display: { fontFamily: FontFamily.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  title: { fontFamily: FontFamily.semibold, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: FontFamily.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: FontFamily.medium, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: FontFamily.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
  button: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 20 },
  stat: { fontFamily: FontFamily.semibold, fontSize: 22, lineHeight: 28 },
} as const;

export type TypographyVariant = keyof typeof Typography;

/** Accessible minimums for outdoor use. */
export const A11y = {
  minTouchTarget: 44,
  minTouchTargetLarge: 48,
  /** Cap for text inside fixed-size controls (buttons, pills, tabs, tiles). */
  controlFontScale: 1.3,
  /** Cap for large headings, so a big OS font setting cannot push a title off screen. */
  headingFontScale: 1.5,
} as const;

/**
 * Where the map opens before any fence or collar position has loaded. Once
 * data arrives the map frames the fences and animals instead, so this only
 * matters on an empty farm. Change it to your own farm's centre.
 */
export const RANCH_REGION = {
  latitude: 45.682,
  longitude: -110.356,
  latitudeDelta: 0.025,
  longitudeDelta: 0.025,
} as const;
