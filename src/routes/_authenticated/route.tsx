import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { DEMO_USER_KEY, DEMO_USER } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(DEMO_USER_KEY);
      if (stored) {
        try {
          return { user: JSON.parse(stored) };
        } catch {
          // ignore
        }
      }
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem(DEMO_USER_KEY);
        if (stored) return { user: JSON.parse(stored) };
      }
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
