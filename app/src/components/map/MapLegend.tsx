import { StyleSheet, Text, View } from 'react-native';

import { Colors, Shadows } from '@/constants/theme';

export function MapLegend() {
  return (
    <View style={legend.card} pointerEvents="none">
      <LegendDot color={Colors.grazing} label="Grazing" />
      <LegendDot color={Colors.nearBoundary} label="Near Boundary" />
      <LegendDot color={Colors.breach} label="Breach" />
      <View style={legend.lineRow}>
        <View style={[legend.line, { backgroundColor: Colors.warning }]} />
        <Text style={legend.label}>Warning Zone</Text>
      </View>
      <View style={legend.lineRow}>
        <View style={[legend.line, { backgroundColor: Colors.critical }]} />
        <Text style={legend.label}>Correction Zone</Text>
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={legend.row}>
      <View style={[legend.dot, { backgroundColor: color }]} />
      <Text style={legend.label}>{label}</Text>
    </View>
  );
}

const legend = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    ...Shadows.card,
    minWidth: 140,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  line: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  label: {
    fontSize: 11,
    color: Colors.text,
    fontWeight: '500',
  },
});
