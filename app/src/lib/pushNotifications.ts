import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Android notification channels. The database push trigger sends breach alerts
 * to `alarms` and low-battery / stationary alerts to `alerts`; the in-app siren
 * uses `alarms` for its local notification too. Channel ids must not change
 * once shipped (Android keeps the user's per-channel settings by id).
 */
export const ALARM_CHANNEL_ID = 'alarms';
export const ALERT_CHANNEL_ID = 'alerts';

const PUSH_TOKEN_KEY = 'farmtrack.pushToken.v1';
const notificationsSupported = Platform.OS !== 'web';

let registeredToken: string | null = null;

if (notificationsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Must run before the permission request: Android 13 only shows the prompt once a channel exists. */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Fence breach alarms',
    description: 'An animal is outside every fence.',
    importance: Notifications.AndroidImportance.MAX,
    // No `sound` key: leaving it out gives the phone's default notification
    // sound. The string 'default' is read as a custom sound file name, which
    // doesn't exist, and logs a red error box in development builds.
    vibrationPattern: [0, 500, 200, 500, 200, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: 'Farm alerts',
    description: 'Low collar battery and animals that have stopped moving.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** Asks only if the user has not answered yet. Call after login, never at launch. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return requested.granted;
}

/**
 * Gets this device's Expo push token and registers it through
 * register_push_token() so the database can push alerts while the app is
 * closed. The RPC (SECURITY DEFINER) sets profile_id = auth.uid() and takes
 * over a token row left by a previous user of this phone, which a direct
 * upsert cannot do under RLS. Fails soft: Expo Go on Android, a build without
 * google-services.json, or a database without the RPC only log a warning —
 * in-app alerts still work.
 */
export async function registerPushToken(): Promise<void> {
  if (!notificationsSupported || !isSupabaseConfigured) return;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] No EAS projectId in app config; push notifications disabled.');
    return;
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    console.warn('[push] Could not get a push token (Expo Go, or no Firebase config in this build):', err);
    return;
  }

  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) {
    console.warn('[push] Could not register push token:', error.message);
    return;
  }

  registeredToken = token;
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
}

/**
 * Removes this device's token so a signed-out phone stops getting the farm's
 * alerts. Must run BEFORE supabase.auth.signOut(): the push_tokens RLS policy
 * only lets the owner delete their row, which needs the session.
 *
 * The stored token is forgotten only when the delete succeeded, so a failed
 * delete (no signal) is retried at the next sign-out; the next sign-in
 * re-registers the token to that user anyway.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!notificationsSupported || !isSupabaseConfigured) return;
  const token = registeredToken ?? (await AsyncStorage.getItem(PUSH_TOKEN_KEY));
  // This session's registration is over either way.
  registeredToken = null;
  if (!token) return;
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) {
    console.warn('[push] Could not remove push token, will retry at next sign-out:', error.message);
    return;
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

/**
 * True once the server can push to this device. The in-app siren then skips
 * its own local notification so the farmer does not get every breach twice.
 */
export function hasRegisteredPushToken(): boolean {
  return registeredToken !== null;
}
