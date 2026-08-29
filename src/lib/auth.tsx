import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const DEMO_USER_KEY = "netrasense:demo_user";

export const DEMO_USER: User = {
  id: "demo-user-12345",
  app_metadata: {},
  user_metadata: { full_name: "Demo User" },
  aud: "authenticated",
  created_at: new Date().toISOString(),
  email: "demo@netrasense.org",
  phone: "",
  role: "authenticated",
  updated_at: new Date().toISOString(),
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInAsDemo: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signInAsDemo: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demoUser, setDemoUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;

    // Check localStorage for demo user
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(DEMO_USER_KEY);
      if (stored) {
        try {
          setDemoUser(JSON.parse(stored));
        } catch {
          // ignore
        }
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, queryClient]);

  const signInAsDemo = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEMO_USER_KEY, JSON.stringify(DEMO_USER));
    }
    setDemoUser(DEMO_USER);
    router.navigate({ to: "/dashboard", replace: true });
  };

  const activeUser = session?.user ?? demoUser;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: activeUser,
      loading,
      signInAsDemo,
      signOut: async () => {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DEMO_USER_KEY);
        }
        setDemoUser(null);
        await queryClient.cancelQueries();
        queryClient.clear();
        await supabase.auth.signOut();
        router.navigate({ to: "/auth", replace: true });
      },
    }),
    [session, activeUser, loading, queryClient, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
