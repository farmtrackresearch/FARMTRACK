import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import { Colors, Layout } from '@/constants/theme';

/**
 * Rolling hills along the bottom edge of the dark headers.
 * - page: the front hill is the page background, so the header melts into
 *   the content below it.
 * - overlay: only the dark band above the front hill is painted, so whatever
 *   is underneath (the map) shows through below the wave.
 */
export const HillsEdge = memo(function HillsEdge({
  compact = false,
  overlay = false,
}: {
  compact?: boolean;
  overlay?: boolean;
}) {
  const height = compact ? Layout.hillsHeightCompact : Layout.hillsHeight;
  return (
    <View style={{ height }} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={height} viewBox="0 0 400 28" preserveAspectRatio="none">
        <Defs>
          <ClipPath id="ftBand">
            <Path d={BAND} />
          </ClipPath>
        </Defs>
        {overlay ? <Path d={BAND} fill={Colors.primaryDark} /> : <Rect width={400} height={28} fill={Colors.primaryDark} />}
        <G clipPath={overlay ? 'url(#ftBand)' : undefined}>
          <Path d="M0 17 C 60 5, 125 5, 185 13 S 305 3, 400 11 L400 28 L0 28 Z" fill={Colors.hillFar} opacity={0.55} />
          <Path d="M0 23 C 75 12, 150 14, 225 20 S 345 12, 400 19 L400 28 L0 28 Z" fill={Colors.hillMid} opacity={0.5} />
        </G>
        {overlay ? null : <Path d={FRONT} fill={Colors.background} />}
      </Svg>
    </View>
  );
});

/** Front hill (page colour) and the dark band above it, which is the same curve reversed. */
const FRONT = 'M0 27 C 95 19, 185 21, 265 25 S 365 21, 400 23 L400 28 L0 28 Z';
const BAND = 'M0 0 H400 V23 C 365 21, 345 29, 265 25 C 185 21, 95 19, 0 27 Z';

/** Small hills-and-fence scene for empty states. */
export const PastureScene = memo(function PastureScene({ width = 150 }: { width?: number }) {
  const height = (width * 64) / 160;
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 160 64">
        <Circle cx={122} cy={16} r={8} fill={Colors.accent} opacity={0.85} />
        <Path d="M0 44 C 30 26, 70 26, 100 38 S 140 32, 160 36 L160 64 L0 64 Z" fill={Colors.primarySoft} />
        <Path d="M0 52 C 40 40, 90 42, 160 50 L160 64 L0 64 Z" fill={Colors.hillMid} opacity={0.45} />
        <G stroke={Colors.primaryDark} strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round">
          <Line x1={22} y1={38} x2={22} y2={52} />
          <Line x1={44} y1={36} x2={44} y2={50} />
          <Line x1={66} y1={36} x2={66} y2={50} />
          <Line x1={88} y1={38} x2={88} y2={51} />
          <Line x1={20} y1={42} x2={90} y2={41} />
          <Line x1={20} y1={47} x2={90} y2={46} />
        </G>
      </Svg>
    </View>
  );
});

/**
 * FarmTrack mark: a location pin whose head is a window onto a pasture (sun,
 * rolling hill, fence). Same geometry as assets/brand/icon.svg.
 */
export const BrandMark = memo(function BrandMark({
  size = 64,
  pinColor = Colors.background,
}: {
  size?: number;
  pinColor?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="FarmTrack">
      <Defs>
        <ClipPath id="ftWindow">
          <Circle cx={50} cy={41} r={21} />
        </ClipPath>
      </Defs>
      <Path
        d="M50 94 C 44 86, 18 62, 18 41 A 32 32 0 1 1 82 41 C 82 62, 56 86, 50 94 Z"
        fill={pinColor}
      />
      <G clipPath="url(#ftWindow)">
        <Circle cx={50} cy={41} r={21} fill={Colors.primarySoft} />
        <Circle cx={60} cy={32} r={5} fill={Colors.accent} />
        <Path d="M27 50 C 36 40, 48 41, 57 46 S 69 42, 73 44 L73 64 L27 64 Z" fill={Colors.hillMid} />
        <Path d="M27 55 C 39 48, 55 49, 73 53 L73 64 L27 64 Z" fill={Colors.primary} />
        <G stroke={Colors.primaryDark} strokeWidth={1.6} strokeLinecap="round">
          <Line x1={37} y1={49} x2={37} y2={56} />
          <Line x1={45} y1={48} x2={45} y2={55} />
          <Line x1={53} y1={48} x2={53} y2={55} />
          <Line x1={35} y1={51.5} x2={55} y2={50.5} />
        </G>
      </G>
    </Svg>
  );
});
