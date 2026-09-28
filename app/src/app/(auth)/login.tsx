import { useEffect, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { BrandMark, HillsEdge } from '@/components/ui/Illustrations';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
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

  // Fade + slide in once on mount. The Animated.Values are created once and
  // never replaced, so the effect runs a single time.
  const [fade] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(16));
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
  }, [fade, slide]);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, { paddingTop: insets.top + Spacing.xxxl }]}>
            <View style={styles.overscrollCap} />
            <BrandMark size={88} />
            <Text variant="display" color="inverse" align="center">
              FarmTrack
            </Text>
            <Text variant="body" color="inverseMuted" align="center">
              Virtual fences for your herd
            </Text>
          </View>
          <HillsEdge />

          <View style={styles.cardWrap}>
          <Animated.View style={[styles.card, { opacity: fade, transform: [{ translateY: slide }] }]}>
            <Text variant="title" accessibilityRole="header">
              Sign in to your farm
            </Text>

            {!isSupabaseConfigured ? (
              <Banner
                tone="offline"
                title="Demo mode"
                message="No Supabase keys in this build, so nothing is saved or shared."
              />
            ) : null}

            {isSupabaseConfigured ? (
              <>
                <TextField
                  label="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  placeholder="you@yourfarm.com"
                  value={email}
                  onChangeText={setEmail}
                  returnKeyType="next"
                />
                <TextField
                  label="Password"
                  secureTextEntry
                  autoComplete="password"
                  textContentType="password"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
              </>
            ) : null}

            {error ? <Banner tone="critical" title="Could not sign in" message={error} /> : null}

            {isSupabaseConfigured ? (
              <Button
                label={busy ? 'Signing in…' : 'Sign in'}
                icon="login"
                onPress={onSubmit}
                loading={busy}
                disabled={!email || !password}
              />
            ) : (
              // Demo accounts exist only in a build without Supabase keys, so a
              // published app can never be entered without a real login.
              <View style={styles.demoButtons}>
                <Button label="Continue as Admin (demo)" icon="shield-account-outline" onPress={() => signInDemo('admin')} />
                <Button
                  label="Continue as Staff (demo)"
                  icon="account-outline"
                  variant="secondary"
                  onPress={() => signInDemo('staff')}
                />
              </View>
            )}
          </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xxl,
    paddingBottom: Spacing.xl,
    backgroundColor: Colors.primaryDark,
  },
  overscrollCap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -800,
    height: 800,
    backgroundColor: Colors.primaryDark,
  },
  cardWrap: { paddingHorizontal: Spacing.lg },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    gap: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    ...Shadows.raised,
  },
  demoButtons: { gap: Spacing.md },
});
