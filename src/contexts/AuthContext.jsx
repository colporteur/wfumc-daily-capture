import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { supabase, withTimeout } from '../lib/supabase';

// Auth context for the Daily Capture app. Mirrors the other WFUMC
// apps. The app's UI / route gates only let the pastor role through —
// daily captures are private to the pastor by design.
//
// RLS on daily_captures + daily_capture_segments pins every row to
// auth.uid() = owner_user_id, so even if a non-pastor account somehow
// loads the app, they see no data — blocked at both the UI and DB
// layers.

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadedUserId = useRef(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('staff_profiles')
          .select('user_id, full_name, role')
          .eq('user_id', userId)
          .maybeSingle()
      );
      if (error) {
        // Keep last-known-good profile on transient errors.
        // eslint-disable-next-line no-console
        console.error('Error loading staff profile:', error);
        return;
      }
      setProfile(data);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Timeout loading staff profile:', e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      loadedUserId.current = s?.user?.id ?? null;
      await loadProfile(s?.user?.id);
      if (mounted) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION') return;

      const newUserId = s?.user?.id ?? null;
      const sameUser = newUserId && newUserId === loadedUserId.current;

      // Tab-resume re-validation for the same user — quiet update only,
      // so ProtectedRoute doesn't unmount the page on every focus.
      if (event === 'SIGNED_IN' && sameUser) {
        setSession(s);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setLoading(true);
        setSession(s);
        loadedUserId.current = newUserId;
        await loadProfile(newUserId);
        if (mounted) setLoading(false);
      } else {
        setSession(s);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    isStaff: !!profile,
    isPastor: profile?.role === 'pastor',
    loading,
    signIn,
    signOut,
    refreshProfile: () => loadProfile(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
