import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/tones';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useAlarm } from '@/hooks/useAlarm';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  children: ReactNode;
  /** Pinned actions under the scrollable body. */
  footer?: ReactNode;
  /** False while saving, so a stray tap cannot close the sheet. */
  dismissible?: boolean;
};

/**
 * Bottom sheet used by every form modal. Sits above the home indicator, keeps
 * inputs above the keyboard and scrolls when a small screen cannot fit it.
 *
 * A native Modal draws above everything, including the full-screen breach
 * alarm, so the sheet hides while an alarm is showing. The form values live in
 * the screen that owns the sheet, so it comes back intact after Acknowledge.
 */
export function Sheet({ visible, onClose, title, subtitle, icon, children, footer, dismissible = true }: Props) {
  const insets = useSafeAreaInsets();
  const { activeAlarm } = useAlarm();
  return (
    <Modal
      visible={visible && !activeAlarm}
      transparent
      animationType="fade"
      onRequestClose={dismissible ? onClose : () => {}}
      statusBarTranslucent
      navigationBarTranslucent>
      {/* padding on Android too: the modal is edge-to-edge, so the window is
          not resized for the keyboard. KeyboardAvoidingView only pads by the
          part of the keyboard that overlaps it, so it never doubles up. */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View style={[styles.fill, styles.end, { paddingTop: insets.top + Spacing.lg }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.scrim]}
            onPress={dismissible ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              {icon ? (
                <View style={styles.iconBox}>
                  <MaterialCommunityIcons name={icon} size={24} color={Colors.primary} />
                </View>
              ) : null}
              <View style={styles.headerText}>
                <Text variant="title" numberOfLines={2} accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="caption" color="secondary" numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton icon="close" onPress={onClose} disabled={!dismissible} accessibilityLabel="Close" />
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}>
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  end: { justifyContent: 'flex-end' },
  scrim: { backgroundColor: Colors.scrim },
  sheet: {
    maxHeight: '100%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    ...Shadows.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderStrong,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: Spacing.lg, paddingBottom: Spacing.xs },
  footer: { flexDirection: 'row', gap: Spacing.md, paddingTop: Spacing.lg },
});
