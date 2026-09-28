import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { DEMO_PROFILE } from '@/data/mockData';
import { unregisterPushToken } from '@/lib/pushNotifications';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /**
   * True only when `profile` is the least-privilege stand-in built from the
   * session because the profile could not be fetched and nothing was cached.
   * A cached profile is a real profile, so it does not set this.
   */
  profileIsFallback: boolean;
  loading: boolean;
  /** Demo mode = no Supabase keys configured. The app never calls Supabase in this mode. */
  demoMode: boolean;
  initialize: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signInDemo: (role?: UserRole) => void;
  signOut: () => Promise<void>;
  isAdmin: () => boolean;
}

const PROFILE_CACHE_KEY = 'farmtrack.profile.v1';

type ProfileResult = { profile: Profile } | { profile: null; error: string };

async function fetchProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) return { profile: null, error: error?.message ?? 'Profile not found' };
  return { profile: data as Profile };
}

async function readCachedProfile(userId: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Profile;
    return cached.id === userId ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: Profile | null) {
  const op = profile
    ? AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
    : AsyncStorage.removeItem(PROFILE_CACHE_KEY);
  op.catch(() => {});
}

/**
 * Stand-in when the profile cannot be fetched (no signal in the paddock) and
 * nothing is cached: least privilege, so admin-only controls stay hidden. The
 * database enforces roles regardless of what the app shows.
 */
function fallbackProfile(user: User): Profile {
  return {
    id: user.id,
    full_name: user.email ?? 'Farm user',
    role: 'staff',
    farm_name: null,
    created_at: user.created_at,
  };
}

let initialized = false;
let profileLoad: { userId: string; promise: Promise<void> } | null = null;
/** User whose profile was fetched successfully this app session (cache alone does not count). */
let profileFetchedFor: string | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  /** Fetches the profile for `user`, de-duplicating concurrent calls for the same user. */
  const loadProfile = (user: User): Promise<void> => {
    if (profileLoad?.userId === user.id) return profileLoad.promise;
    const promise = (async () => {
      const result = await fetchProfile(user.id);
      // Ignore the answer if someone else signed in meanwhile.
      if (get().session?.user.id !== user.id) return;
      if (result.profile) {
        profileFetchedFor = user.id;
        set({ profile: result.profile, profileIsFallback: false });
        writeCachedProfile(result.profile);
        return;
      }
      console.warn('[auth] profile fetch failed:', result.error);
      if (!get().profile) {
        const cached = await readCachedProfile(user.id);
        if (cached) set({ profile: cached, profileIsFallback: false });
        else set({ profile: fallbackProfile(user), profileIsFallback: true });
      }
    })().finally(() => {
      if (profileLoad?.promise === promise) profileLoad = null;
    });
    profileLoad = { userId: user.id, promise };
    return promise;
  };

  return {
    session: null,
    profile: null,
    profileIsFallback: false,
    loading: true,
    demoMode: !isSupabaseConfigured,

    initialize: async () => {
      if (!isSupabaseConfigured) {
        // Demo mode: stay logged out until the user picks Admin/Staff on login.
        set({ loading: false, demoMode: true, profile: null, session: null });
        return;
      }
      if (initialized) return;
      initialized = true;

      // Supabase's React Native guidance: refresh tokens only while the app is
      // in the foreground, and resume immediately when it returns.
      if (Platform.OS !== 'web') {
        AppState.addEventListener('change', (state) => {
          if (state === 'active') {
            supabase.auth.startAutoRefresh();
            // Retry if the profile has only come from the cache or the stand-in.
            const userId = get().session?.user.id;
            if (userId && profileFetchedFor !== userId) void get().refreshProfile();
          } else {
            supabase.auth.stopAutoRefresh();
          }
        });
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) {
        // Show the cached profile at once; refresh it in the background.
        const cached = await readCachedProfile(session.user.id);
        set({ session, profile: cached, profileIsFallback: false, demoMode: false });
        if (cached) void loadProfile(session.user);
        else await loadProfile(session.user);
      }
      set({ loading: false, demoMode: false });

      // Never await inside this callback: supabase-js holds its auth lock while
      // it runs, so a query here can deadlock. It also fires on every hourly
      // TOKEN_REFRESHED; the profile only needs re-fetching when the user changes.
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        const prevUserId = get().session?.user.id ?? null;
        const nextUser = nextSession?.user ?? null;
        if (!nextUser) {
          profileFetchedFor = null;
          set({ session: null, profile: null, profileIsFallback: false });
          writeCachedProfile(null);
          return;
        }
        set({ session: nextSession });
        if (nextUser.id !== prevUserId) {
          set({ profile: null, profileIsFallback: false });
          setTimeout(() => void loadProfile(nextUser), 0);
        }
      });
    },

    refreshProfile: async () => {
      const user = get().session?.user;
      if (user) await loadProfile(user);
    },

    signIn: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Supabase is not configured (demo mode).' };

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      if (!data.user || !data.session) return { error: 'Sign-in did not return a session.' };

      set({ session: data.session, demoMode: false });
      await loadProfile(data.user);
      return {};
    },

    signInDemo: (role = 'admin') => {
      // Demo accounts exist only when the app has no Supabase keys.
      if (isSupabaseConfigured) return;
      set({
        demoMode: true,
        session: null,
        profile: { ...DEMO_PROFILE, role },
        profileIsFallback: false,
        loading: false,
      });
    },

    signOut: async () => {
      if (isSupabaseConfigured && get().session) {
        // Order matters: RLS only lets the signed-in owner delete their token.
        await unregisterPushToken();
        // 'local' ends only this phone's session, so signing out here does not
        // sign out every other phone on a shared farm login. supabase-js
        // clears the stored session even if the server call fails (offline).
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) console.warn('[auth] sign-out reached the server with an error:', error.message);
      }
      profileFetchedFor = null;
      writeCachedProfile(null);
      set({
        session: null,
        profile: null,
        profileIsFallback: false,
        demoMode: !isSupabaseConfigured,
      });
    },

    isAdmin: () => get().profile?.role === 'admin',
  };
});
