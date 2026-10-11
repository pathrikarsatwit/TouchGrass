import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";
import { setApiAccessToken } from "@/lib/api";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anonKey);

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const supabase: SupabaseClient | null = configured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function getSupabaseClient() {
  return supabase;
}

type AuthContextValue = {
  client: SupabaseClient | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const acceptAuthLink = async (incomingUrl: string | null) => {
      if (!incomingUrl) return;
      let params: URLSearchParams;
      try {
        const parsed = new URL(incomingUrl);
        params = new URLSearchParams(parsed.search);
        const fragmentParams = new URLSearchParams(parsed.hash.slice(1));
        fragmentParams.forEach((value, key) => params.set(key, value));
      } catch {
        return;
      }
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) console.warn("Could not complete the account email link:", error.message);
        return;
      }
      const accessTokenFromLink = params.get("access_token");
      const refreshTokenFromLink = params.get("refresh_token");
      if (!accessTokenFromLink || !refreshTokenFromLink) return;
      const { error } = await supabase.auth.setSession({
        access_token: accessTokenFromLink,
        refresh_token: refreshTokenFromLink,
      });
      if (error) console.warn("Could not complete the account email link:", error.message);
    };
    Linking.getInitialURL().then(acceptAuthLink).catch((error: unknown) => {
      console.warn("Could not read the account email link:", error instanceof Error ? error.message : "Unknown link error");
    });
    const linkSubscription = Linking.addEventListener("url", ({ url: incomingUrl }) => {
      acceptAuthLink(incomingUrl).catch((error: unknown) => {
        console.warn("Could not complete the account email link:", error instanceof Error ? error.message : "Unknown link error");
      });
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.warn("Could not restore sign-in session:", error.message);
      if (mounted) {
        setSession(data.session);
        setApiAccessToken(data.session?.access_token ?? null);
        setLoading(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token ?? null);
    });
    return () => { mounted = false; subscription.unsubscribe(); linkSubscription.remove(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    client: supabase,
    session,
    loading,
    configured,
    signOut: async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
