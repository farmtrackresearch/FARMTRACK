import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
};

export function Input({ label, error, containerStyle, style, ...rest }: Props) {
  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={Colors.textMuted}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Typography.label,
    color: Colors.text,
    marginBottom: Spacing.xs + 2,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    minHeight: 48,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.surfaceMuted,
  },
  inputError: {
    borderColor: Colors.critical,
  },
  error: {
    ...Typography.caption,
    color: Colors.critical,
    marginTop: Spacing.xs,
  },
});
