import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar, HeartPulse, Siren, Mail, Heart, Github, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
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
  const [isDark, setIsDark] = useState<boolean>(true);

  useEffect(() => {
    const root = document.documentElement;
    const isDarkMode = root.classList.contains("dark") || 
      (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches);
    
    setIsDark(isDarkMode);
    if (isDarkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 dark:bg-slate-950 dark:text-slate-100 selection:bg-primary/30">
      {/* Top Navigation Header */}
      <header className="relative z-50 mx-auto flex max-w-6xl items-center justify-between px-4 py-6 lg:px-8">
        {/* NetraSense Brand Mark Logo & Typography */}
        <Link
          to="/"
          className="group flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl transition-transform active:scale-95"
        >
          <svg
            className="size-9 sm:size-10 transition-transform duration-200 group-hover:scale-105"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Top-Left Bracket */}
            <path
              d="M 18 36 V 22 A 6 6 0 0 1 24 16 H 38"
              stroke="#F5B027"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Top-Right Bracket */}
            <path
              d="M 82 36 V 22 A 6 6 0 0 0 76 16 H 62"
              stroke="#F5B027"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Bottom-Left Bracket */}
            <path
              d="M 18 64 V 78 A 6 6 0 0 0 24 84 H 38"
              stroke="#F5B027"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Bottom-Right Bracket */}
            <path
              d="M 82 64 V 78 A 6 6 0 0 1 76 84 H 62"
              stroke="#F5B027"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Blue Eye Wing Shape */}
            <path
              d="M 6 50 C 20 25, 80 25, 94 50 C 80 75, 20 75, 6 50 Z"
              fill="#1665D8"
            />

            {/* Gold Circular Iris Ring */}
            <circle
              cx="50"
              cy="50"
              r="21"
              fill="none"
              stroke="#F5B027"
              strokeWidth="6.5"
            />

            {/* Deep Blue Pupil */}
            <circle
              cx="50"
              cy="50"
              r="14.5"
              fill="#0B4294"
            />

            {/* Catchlight Reflection */}
            <circle
              cx="56"
              cy="44"
              r="4.5"
              fill="#FFFFFF"
            />
          </svg>

          <span className="text-2xl sm:text-[1.75rem] font-extrabold tracking-tight text-white">
            NetraSense
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-6">
          {/* Theme Toggle Button (Left of Contact Us) */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle light/dark theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-200 transition-all hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-amber-400 transition-transform duration-200 rotate-0 hover:rotate-45" />
            ) : (
              <Moon className="h-4 w-4 text-slate-300 transition-transform duration-200" />
            )}
          </button>

          <nav className="flex items-center gap-4 text-sm font-medium text-slate-400" aria-label="Main Navigation">
            <a
              href="#contact"
              className="transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-primary rounded-md px-2 py-1 hidden sm:inline-block"
            >
              Contact Us
            </a>
            <a
              href="#support"
              className="transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-primary rounded-md px-2 py-1 hidden sm:inline-block"
            >
              Support Us
            </a>
          </nav>

          {!loading && (
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link to={session ? "/dashboard" : "/auth"}>
                {session ? "Open dashboard" : "Sign in"}
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" className="relative z-10 mx-auto max-w-6xl px-4 pb-24 lg:px-8">
        {/* Hero Section */}
        <section className="py-12 lg:py-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-sm font-bold text-sky-400">
            WCAG-focused assistive telemetry
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-extrabold text-white lg:text-6xl tracking-tight">
            Navigation confidence for visually impaired people and their caregivers.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-300 leading-relaxed">
            NetraSense turns ultrasonic sensor telemetry into spoken warnings, caregiver visibility and a
            complete incident history — accessible by keyboard and screen reader end to end.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="text-base font-semibold">
              <Link to={session ? "/dashboard" : "/auth"}>
                {session ? "Go to dashboard" : "Create your account"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base border-slate-700 bg-slate-900/50 text-white hover:bg-slate-800">
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
            <article key={title} className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-sm">
              <Icon aria-hidden="true" className="size-8 text-sky-400" />
              <h3 className="mt-4 text-lg font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{body}</p>
            </article>
          ))}
        </section>

        {/* Contact & Support Section */}
        <section aria-labelledby="contact-support-heading" className="mt-16 pt-12 border-t border-slate-800">
          <h2 id="contact-support-heading" className="text-2xl font-bold tracking-tight text-white mb-8">
            Connect & Support the Mission
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Contact Us Card */}
            <article id="contact" className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-6 flex flex-col justify-between scroll-mt-24">
              <div>
                <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-4">
                  <Mail className="size-5" />
                </div>
                <h3 className="text-xl font-bold text-white">Contact Us</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                  Have questions regarding the NetraSense ultrasonic sensor setup, caregiver pairing, or web accessibility features? Reach out directly.
                </p>
              </div>
              <div className="mt-6">
                <Button asChild variant="outline" className="w-full border-slate-700 bg-slate-900 text-white hover:bg-slate-800">
                  <a href="mailto:contact@netrasense.org">
                    Send an Email
                  </a>
                </Button>
              </div>
            </article>

            {/* Support Us Card */}
            <article id="support" className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-6 flex flex-col justify-between scroll-mt-24">
              <div>
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
                  <Heart className="size-5" />
                </div>
                <h3 className="text-xl font-bold text-white">Support Us</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
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
