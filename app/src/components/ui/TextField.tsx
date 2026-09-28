import { MaterialCommunityIcons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';

type Props = TextInputProps & {
  label: string;
  helper?: string | null;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
};

/** Labelled text input with helper and error text. */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, helper, error, containerStyle, style, onFocus, onBlur, editable = true, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      <Text variant="captionStrong" color="text">
        {label}
      </Text>
      <TextInput
        ref={ref}
        placeholderTextColor={Colors.textMuted}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        editable={editable}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.focused,
          error ? styles.errored : null,
          !editable && styles.disabled,
          style,
        ]}
        {...rest}
      />
      {error ? (
        <View style={styles.msgRow}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={Colors.critical} />
          <Text variant="caption" color={Colors.criticalInk} style={styles.msg}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="caption" color="secondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontFamily: FontFamily.regular,
    fontSize: 16,
  },
  focused: { borderColor: Colors.primary, borderWidth: 1.5 },
  errored: { borderColor: Colors.critical, borderWidth: 1.5 },
  disabled: { backgroundColor: Colors.surfaceSunken, color: Colors.textSecondary },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  msg: { flex: 1 },
});
