import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert, Radar, HeartPulse, Siren } from "lucide-react";

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

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 lg:px-8">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden="true" className="size-7 text-primary" />
          <span className="text-xl font-extrabold tracking-tight">NetraSense</span>
        </div>
        {!loading && (
          <Button asChild>
            <Link to={session ? "/dashboard" : "/auth"}>
              {session ? "Open dashboard" : "Sign in"}
            </Link>
          </Button>
        )}
      </header>

      <main id="main-content" className="mx-auto max-w-6xl px-4 pb-24 lg:px-8">
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
      </main>
    </div>
  );
}
