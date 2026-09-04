import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alertMeta } from '@/components/alerts/AlertCard';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import type { Alert } from '@/types/database';

type Props = {
  alert: Alert;
  onNavigate?: () => void;
  onDismiss?: () => void;
};

export function LiveAlertBanner({ alert, onNavigate, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const meta = alertMeta(alert.alert_type);

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={[styles.banner, { borderLeftColor: meta.color }]}>
        <View style={[styles.icon, { backgroundColor: meta.color }]}>
          <MaterialCommunityIcons name={meta.icon} size={18} color="#fff" />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {alert.title}
          </Text>
          <Text style={styles.desc} numberOfLines={2}>
            {alert.description}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={onNavigate} style={styles.cta}>
              <Text style={styles.ctaText}>Navigate to Animal</Text>
            </Pressable>
            <Pressable onPress={onDismiss} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 100,
  },
  banner: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderLeftWidth: 4,
    ...Shadows.card,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  body: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.text,
  },
  desc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  cta: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  ctaText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
