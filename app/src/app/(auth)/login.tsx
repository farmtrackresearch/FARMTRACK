import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useAuthStore((s) => s.signIn);
  const signInDemo = useAuthStore((s) => s.signInDemo);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error);
    setBusy(false);
  };

  // Fade + slide in once on mount — not on re-renders (empty deps, values never reset).
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 420,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 420,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <Animated.View
          style={[styles.card, { opacity: fade, transform: [{ translateY: slide }] }]}>
          <Text style={styles.brand}>FarmTrack</Text>
          <Text style={styles.subtitle}>Sign in to your ranch</Text>
          {!isSupabaseConfigured ? (
            <Text style={styles.demoNote}>Demo mode — Supabase env not configured</Text>
          ) : null}

          <Input
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="owner@ranch.com"
            value={email}
            onChangeText={setEmail}
            containerStyle={styles.field}
          />

          <Input
            label="Password"
            secureTextEntry
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            containerStyle={styles.field}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={busy ? 'Signing in…' : 'Sign In'}
            onPress={onSubmit}
            disabled={busy || (!email && isSupabaseConfigured)}
            style={styles.submitBtn}
            icon={busy ? <ActivityIndicator color="#fff" /> : undefined}
          />

          <View style={styles.links}>
            <Pressable onPress={() => signInDemo('admin')} hitSlop={8}>
              <Text style={styles.link}>Continue as Admin</Text>
            </Pressable>
            <Text style={styles.linkDivider}>·</Text>
            <Pressable onPress={() => signInDemo('staff')} hitSlop={8}>
              <Text style={styles.link}>Continue as Staff</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
  },
  brand: {
    ...Typography.h1,
    fontSize: 28,
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  demoNote: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  field: {
    marginTop: Spacing.lg,
  },
  error: {
    ...Typography.caption,
    color: Colors.critical,
    marginTop: Spacing.sm,
  },
  submitBtn: {
    marginTop: Spacing.lg,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  link: {
    ...Typography.label,
    color: Colors.primary,
  },
  linkDivider: {
    color: Colors.border,
  },
});
