import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar, HeartPulse, Siren, Mail, Heart, Github, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NetraSense — Assistive Navigation & Telemetry" },
      {
        name: "description",
        content:
          "NetraSense pairs live obstacle telemetry with medical ID and caregiver alerts for visually impaired navigation.",
      },
      { property: "og:title", content: "NetraSense — Assistive Navigation & Telemetry" },
      {
        property: "og:description",
        content: "Live proximity radar, voice alerts, medical ID and one-tap SOS for caregivers.",
      },
    ],
  }),
  component: Index,
});

const FEATURES = [
  {
    icon: Radar,
    title: "Live proximity radar",
    body: "Streaming obstacle detection from 0 to 400 cm with colour-coded threat classification.",
  },
  {
    icon: HeartPulse,
    title: "Medical ID at hand",
    body: "Blood group, impairment level and critical notes in a printable emergency card.",
  },
  {
    icon: Siren,
    title: "One-tap SOS",
    body: "Broadcast an emergency alert and call primary caregivers instantly.",
  },
];

function Index() {
  const { session, loading } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem("netrasense:theme", next);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* --- Top Navigation Header --- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 lg:px-8">
        {/* NetraSense Brand Mark Logo & Typography */}
        <Link
          to="/"
          className="group flex items-center gap-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl transition-transform active:scale-95"
        >
          <div className="relative flex size-11 sm:size-12 items-center justify-center overflow-hidden">
            <img
              src="/favicon.ico"
              alt="NetraSense Logo"
              className="size-14 max-w-none scale-[1.32] object-contain transition-transform duration-200 group-hover:scale-[1.38]"
              style={{
                maskImage: "radial-gradient(circle at center, black 58%, transparent 72%)",
                WebkitMaskImage: "radial-gradient(circle at center, black 58%, transparent 72%)",
              }}
            />
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            NetraSense
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-6">
          {/* Theme Toggle Button (Positioned left of Contact Us) */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle light/dark theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/60 text-foreground transition-all hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-amber-400 transition-transform duration-200 rotate-0 hover:rotate-45" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700 transition-transform duration-200" />
            )}
          </button>

          <nav className="flex items-center gap-4 text-sm font-medium text-muted-foreground" aria-label="Main Navigation">
            <a
              href="#contact"
              className="transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded-md px-2 py-1 hidden sm:inline-block"
            >
              Contact Us
            </a>
            <a
              href="#support"
              className="transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded-md px-2 py-1 hidden sm:inline-block"
            >
              Support Us
            </a>
          </nav>

          {!loading && (
            <Button asChild>
              <Link to={session ? "/dashboard" : "/auth"}>
                {session ? "Open dashboard" : "Sign in"}
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* --- Main Content --- */}
      <main id="main-content" className="mx-auto max-w-6xl px-4 pb-24 lg:px-8">
        {/* Hero Section */}
        <section className="py-12 lg:py-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-live-border bg-live-surface px-3 py-1 text-sm font-bold text-live">
            WCAG-focused assistive telemetry
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-extrabold lg:text-6xl">
            Navigation confidence for visually impaired people and their caregivers.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            NetraSense turns ultrasonic sensor telemetry into spoken warnings, caregiver visibility and a
            complete incident history — accessible by keyboard and screen reader end to end.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="text-base">
              <Link to={session ? "/dashboard" : "/auth"}>
                {session ? "Go to dashboard" : "Create your account"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/auth">Caregiver sign in</Link>
            </Button>
          </div>
        </section>

        {/* Feature Cards Grid */}
        <section aria-labelledby="features-heading" className="grid gap-4 md:grid-cols-3">
          <h2 id="features-heading" className="sr-only">
            Features
          </h2>
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="surface-card p-6">
              <Icon aria-hidden="true" className="size-8 text-primary" />
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </section>

        {/* Contact & Support Section */}
        <section aria-labelledby="contact-support-heading" className="mt-16 pt-12 border-t border-border">
          <h2 id="contact-support-heading" className="text-2xl font-bold tracking-tight mb-8">
            Connect & Support the Mission
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Contact Us Card */}
            <article id="contact" className="surface-card p-6 flex flex-col justify-between scroll-mt-24">
              <div>
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
                  <Mail className="size-5" />
                </div>
                <h3 className="text-xl font-bold">Contact Us</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Have questions regarding the NetraSense ultrasonic sensor setup, caregiver pairing, or web accessibility features? Reach out directly.
                </p>
              </div>
              <div className="mt-6">
                <Button asChild variant="outline" className="w-full">
                  <a href="mailto:contact@netrasense.org">
                    Send an Email
                  </a>
                </Button>
              </div>
            </article>

            {/* Support Us Card */}
            <article id="support" className="surface-card p-6 flex flex-col justify-between scroll-mt-24">
              <div>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
                  <Heart className="size-5" />
                </div>
                <h3 className="text-xl font-bold">Support Us</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  NetraSense is an open initiative dedicated to assistive telemetry and safer navigation. Help us improve hardware compatibility and test features.
                </p>
              </div>
              <div className="mt-6">
                <Button asChild className="w-full gap-2">
                  <a
                    href="https://github.com/Kettydee/netrasense"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="size-4" />
                    Star on GitHub & Contribute
                  </a>
                </Button>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
