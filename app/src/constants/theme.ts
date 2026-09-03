/**
 * FarmTrack design tokens — "Warm Clay" palette built around Pistachio Green,
 * a 4/8/16/24/32 spacing scale, and Poppins typography. Every screen reads
 * from these tokens, so changes here apply app-wide.
 */
export const Colors = {
  // Brand green (Pistachio). `primary` is a deeper, text-safe shade used for
  // buttons/links/active states; `primaryLight` is the literal Pistachio
  // Green (#93C572) reserved for accents, tints, and decorative surfaces
  // where white text never sits directly on top of it (it's too light for
  // that contrast).
  primary: '#5E8C4A',
  primaryLight: '#93C572',
  primaryMuted: '#7FAE5E',
  primaryDark: '#2A3B22',
  headerEnd: '#3A4A2E',
  headerMid: '#30402A',

  // Warm terracotta secondary accent.
  secondary: '#C97B4A',
  secondarySoft: '#F6E4D8',

  background: '#FAF9F6',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EEE8',
  surfaceVariant: '#E9E4DA',

  text: '#2B2B26',
  textSecondary: '#5C5A52',
  textMuted: '#7A776E',
  textInverse: '#FFFFFF',

  critical: '#D64545',
  criticalSoft: '#FBE4E4',
  warning: '#E0A64A',
  warningSoft: '#FBF0DF',
  caution: '#D98A3D',
  info: '#5B7C99',
  infoSoft: '#E7EEF2',
  success: '#5E8C4A',
  successSoft: '#E6F0DF',

  online: '#5B9BD5',
  border: '#E4DFD5',
  tabInactive: '#A8A399',
  badge: '#D64545',

  grazing: '#5E8C4A',
  nearBoundary: '#E0A64A',
  breach: '#D64545',

  glass: 'rgba(255,255,255,0.10)',
  glassBorder: 'rgba(255,255,255,0.15)',
} as const;

/** 4/8/16/24/32 spacing scale — generous by default, nothing crowded. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
} as const;

/** Poppins weight files — RN doesn't synthesize weights from a single font, so pick the right file per use. */
export const FontFamily = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/** Semantic type scale — larger-than-typical sizes for outdoor/elderly legibility. */
export const Typography = {
  h1: { fontFamily: FontFamily.bold, fontSize: 28, lineHeight: 34 },
  h2: { fontFamily: FontFamily.bold, fontSize: 22, lineHeight: 28 },
  h3: { fontFamily: FontFamily.semibold, fontSize: 18, lineHeight: 24 },
  bodyLarge: { fontFamily: FontFamily.medium, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 20 },
} as const;

/** Accessible minimums for outdoor / elderly use — bigger than typical app defaults. */
export const A11y = {
  minTouchTarget: 44,
  minTouchTargetLarge: 48,
} as const;

/** Approximate Montana ranch center for map defaults */
export const RANCH_REGION = {
  latitude: 45.682,
  longitude: -110.356,
  latitudeDelta: 0.025,
  longitudeDelta: 0.025,
} as const;
