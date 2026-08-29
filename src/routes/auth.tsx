import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldAlert, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — NetraSense" },
      { name: "description", content: "Sign in or create an NetraSense account to access your navigation telemetry." },
      { property: "og:title", content: "Sign in — NetraSense" },
      { property: "og:description", content: "Access your NetraSense assistive navigation dashboard." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const { session, user, signInAsDemo } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (session || user) navigate({ to: "/dashboard", replace: true });
  }, [session, user, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.info("Account registered! If confirmation is required, check your email or use Instant Demo mode.");
          return;
        }
        toast.success("Account created. Welcome to NetraSense!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back to NetraSense.");
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <main id="main-content" className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <ShieldAlert aria-hidden="true" className="size-8 text-primary" />
          <span className="text-2xl font-extrabold tracking-tight">NetraSense</span>
        </div>
        <section className="surface-card p-6 lg:p-8" aria-labelledby="auth-heading">
          <h1 id="auth-heading" className="text-2xl font-extrabold">
            {mode === "signin" ? "Sign in to your dashboard" : "Create your NetraSense account"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Use the email and password linked to your assistive device."
              : "You'll set up your medical profile and first emergency contact next."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">At least 6 characters.</p>
            </div>
            <Button type="submit" size="lg" className="w-full text-base" disabled={busy}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {/* Instant Demo Access Button */}
          <div className="mt-4 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full text-sm font-semibold border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary"
              onClick={signInAsDemo}
            >
              <Sparkles className="mr-2 size-4" /> Instant Demo / Guest Mode
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Jump straight to the dashboard & test YOLO Vision without logging in.
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New to NetraSense?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-semibold text-primary underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create an account" : "Sign in instead"}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}
