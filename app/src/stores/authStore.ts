import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

import { DEMO_PROFILE } from '@/data/mockData';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  demoMode: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signInDemo: (role?: UserRole) => void;
  signOut: () => Promise<void>;
  isAdmin: () => boolean;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  demoMode: !isSupabaseConfigured,

  initialize: async () => {
    if (!isSupabaseConfigured) {
      // Demo mode: stay logged out until user picks Admin/Staff on login.
      set({
        loading: false,
        demoMode: true,
        profile: null,
        session: null,
      });
      return;
    }

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const profile = session ? await fetchProfile(session.user.id) : null;
    set({ session, profile, loading: false, demoMode: false });

    supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      const nextProfile = nextSession
        ? await fetchProfile(nextSession.user.id)
        : null;
      set({ session: nextSession, profile: nextProfile });
    });
  },

  signIn: async (email, password) => {
    if (!isSupabaseConfigured) {
      get().signInDemo('admin');
      return {};
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error: error.message };

    const profile = data.user ? await fetchProfile(data.user.id) : null;
    set({ session: data.session, profile, demoMode: false });
    return {};
  },

  signInDemo: (role = 'admin') => {
    set({
      demoMode: true,
      session: null,
      profile: { ...DEMO_PROFILE, role },
      loading: false,
    });
  },

  signOut: async () => {
    if (isSupabaseConfigured && get().session) {
      await supabase.auth.signOut();
    }
    set({
      session: null,
      profile: null,
      demoMode: !isSupabaseConfigured,
    });
  },

  isAdmin: () => get().profile?.role === 'admin',
}));
