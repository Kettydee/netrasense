import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Footprints,
  PartyPopper,
  PhoneCall,
  Radar,
  Radio,
  TrendingDown,
  TrendingUp,
  Volume2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { BlindsEyeLens } from "@/components/BlindsEyeLens";
import { CuteLeafLoader } from "@/components/CuteLeafLoader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchContacts, fetchDailyStats, fetchProfile, fetchTelemetry } from "@/lib/queries";
import {
  DETECTED_OBJECTS,
  MAX_DISTANCE_CM,
  classifyDistance,
  relativeTime,
  speak,
  threatStyles,
  type Telemetry,
} from "@/lib/netrasense";
import { fetchSensorTelemetry, hardwareThreatToUiLevel } from "@/lib/sensor";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Realtime Dashboard — NetraSense" },
      {
        name: "description",
        content: "Live proximity telemetry, daily navigation stats and caregiver quick actions.",
      },
      { property: "og:title", content: "Realtime Dashboard — NetraSense" },
      {
        property: "og:description",
        content: "Live obstacle telemetry and caregiver quick-glance panel.",
      },
    ],
  }),
  component: DashboardPage,
});

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: typeof Radar;
  label: string;
  value: string;
  sub: string;
  trend?: number;
}) {
  return (
    <article className="surface-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
        <Icon aria-hidden="true" className="size-5 text-primary" />
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        {typeof trend === "number" &&
          (trend >= 0 ? (
            <TrendingUp aria-hidden="true" className="size-4 text-normal" />
          ) : (
            <TrendingDown aria-hidden="true" className="size-4 text-alarming" />
          ))}
        {sub}
      </p>
    </article>
  );
}

function DistanceMeter({
  distance,
  level,
}: {
  distance: number;
  level: keyof typeof threatStyles;
}) {
  const pct = Math.max(0, Math.min(1, distance / MAX_DISTANCE_CM));
  const radius = 76;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
      <svg
        width="180"
        height="180"
        viewBox="0 0 180 180"
        role="img"
        aria-label={`${distance} centimetres to obstacle`}
      >
        <circle cx="90" cy="90" r={radius} fill="none" strokeWidth="14" className="stroke-muted" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          strokeWidth="14"
          strokeLinecap="round"
          className={threatStyles[level].ring}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          transform="rotate(-90 90 90)"
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        <text x="90" y="86" textAnchor="middle" className="fill-foreground text-2xl font-extrabold">
          {distance}
        </text>
        <text x="90" y="108" textAnchor="middle" className="fill-muted-foreground text-xs">
          cm
        </text>
      </svg>
      <div className="w-full">
        <p className="text-sm font-semibold text-muted-foreground">
          Proximity range 0 – {MAX_DISTANCE_CM} cm
        </p>
        <div className="mt-2 h-5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-all duration-500 ${threatStyles[level].bar}`}
            style={{ width: `${Math.max(4, pct * 100)}%` }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Critical zone</dt>
            <dd className="font-semibold text-collision">Below 50 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Alarm zone</dt>
            <dd className="font-semibold text-alarming">50 – 99 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Warning zone</dt>
            <dd className="font-semibold text-warning">100 – 300 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Normal zone</dt>
            <dd className="font-semibold text-normal">Above 300 cm</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [voiceOn, setVoiceOn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastSpokenId = useRef<string | null>(null);
  const userId = user?.id ?? "";

  useEffect(() => {
    setVoiceOn(window.localStorage.getItem("netrasense:voice") === "on");
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: () => fetchProfile(userId),
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", userId],
    enabled: !!userId,
    queryFn: fetchContacts,
  });
  const telemetryQuery = useQuery({
    queryKey: ["telemetry", userId],
    enabled: !!userId,
    queryFn: () => fetchTelemetry(50),
  });
  const statsQuery = useQuery({
    queryKey: ["daily-stats", userId],
    enabled: !!userId,
    queryFn: () => fetchDailyStats(userId),
  });
  const sensorQuery = useQuery({
    queryKey: ["arduino-sensor"],
    queryFn: fetchSensorTelemetry,
    refetchInterval: 500,
    retry: false,
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("telemetry_stream")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telemetry_stream",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["telemetry", userId] });
          void queryClient.invalidateQueries({ queryKey: ["daily-stats", userId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const latest: Telemetry | undefined = telemetryQuery.data?.[0];
  const sensorReading = sensorQuery.data?.sensor_data ?? null;
  const sensorLevel = sensorReading ? hardwareThreatToUiLevel(sensorReading.threat_level) : null;
  const liveDistance = sensorReading
    ? Math.round(sensorReading.distance_cm)
    : latest
      ? Math.round(Number(latest.distance_cm))
      : MAX_DISTANCE_CM;
  const level = sensorLevel ?? (latest ? latest.threat_level : "Normal");
  const liveThreatLabel = sensorReading?.threat_level ?? latest?.threat_level ?? "NORMAL";

  useEffect(() => {
    if (!voiceOn) return;
    if (level !== "Alarming" && level !== "Collision") {
      lastSpokenId.current = null;
      return;
    }
    if (lastSpokenId.current === level) return;
    lastSpokenId.current = level;
    const source = sensorReading ? "Obstacle" : (latest?.detected_object ?? "Obstacle");
    speak(`Warning: ${source} at ${liveDistance} centimeters`);
  }, [latest?.detected_object, level, liveDistance, sensorReading, voiceOn]);

  const today = new Date().toISOString().slice(0, 10);
  const todayStats = statsQuery.data?.find((s) => s.date === today);
  const yesterdayStats = statsQuery.data?.find(
    (s) => s.date === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  );

  const simulate = useCallback(async () => {
    if (!userId) return;
    const distance = Math.round(Math.random() * MAX_DISTANCE_CM);
    const level = classifyDistance(distance);
    const object =
      DETECTED_OBJECTS[Math.floor(Math.random() * DETECTED_OBJECTS.length)] ?? "Obstacle";
    const { error } = await supabase.from("telemetry_stream").insert({
      user_id: userId,
      detected_object: object,
      distance_cm: distance,
      threat_level: level,
      action_taken: level === "Normal" ? "Logged" : "Haptic + voice alert issued",
    });
    if (error) {
      toast.error("Could not record the telemetry reading.");
      return;
    }
    const prev = todayStats;
    const { error: statsError } = await supabase.from("daily_stats").upsert({
      user_id: userId,
      date: today,
      obstacles_avoided: (prev?.obstacles_avoided ?? 0) + (level === "Normal" ? 0 : 1),
      safe_distance_walked_m: Number(prev?.safe_distance_walked_m ?? 0) + 12,
      active_session_minutes: (prev?.active_session_minutes ?? 0) + 1,
    });
    if (statsError) toast.error("Reading saved, but daily stats could not update.");
    void queryClient.invalidateQueries({ queryKey: ["telemetry", userId] });
    void queryClient.invalidateQueries({ queryKey: ["daily-stats", userId] });
  }, [userId, today, todayStats, queryClient]);

  const needsOnboarding =
    !profileQuery.isLoading &&
    !!profileQuery.data &&
    (!profileQuery.data.full_name || !profileQuery.data.impairment_level);

  const obstacles = todayStats?.obstacles_avoided ?? 0;
  const obstacleTrend = obstacles - (yesterdayStats?.obstacles_avoided ?? 0);
  const distanceKm = (Number(todayStats?.safe_distance_walked_m ?? 0) / 1000).toFixed(2);
  const minutes = todayStats?.active_session_minutes ?? 0;
  if (telemetryQuery.isLoading || statsQuery.isLoading) {
    return (
      <AppShell
        title="Realtime Dashboard"
        description={`Live assistive telemetry${profileQuery.data?.full_name ? ` for ${profileQuery.data.full_name}` : ""}`}
      >
        <div className="flex min-h-[65vh] w-full flex-col items-center justify-center">
          <CuteLeafLoader text="Connecting to sensor stream..." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Realtime Dashboard"
      description={`Live assistive telemetry${profileQuery.data?.full_name ? ` for ${profileQuery.data.full_name}` : ""}`}
    >
      <OnboardingDialog open={needsOnboarding} />

      {/* --- TOP METRICS CARDS ROW --- */}
      <section aria-labelledby="stats-heading" className="mb-6">
        <h2 id="stats-heading" className="sr-only">
          Daily navigation statistics
        </h2>
        {statsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <StatCard
              icon={PartyPopper}
              label="Obstacles dodged today"
              value={String(obstacles)}
              trend={obstacleTrend}
              sub={
                yesterdayStats
                  ? `${Math.abs(obstacleTrend)} ${obstacleTrend >= 0 ? "more" : "fewer"} than yesterday`
                  : "First tracked day"
              }
            />
            <StatCard
              icon={Footprints}
              label="Safe distance explored"
              value={`${distanceKm} km`}
              sub="Navigated with assistance today"
            />
            <StatCard
              icon={Activity}
              label="Active assistance time"
              value={`${Math.floor(minutes / 60)}h ${minutes % 60}m`}
              sub="Monitored session time"
            />
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* --- RADAR SECTION --- */}
          <section aria-labelledby="live-heading" className="surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="live-heading" className="flex items-center gap-2 text-lg font-bold">
                <Radar aria-hidden="true" className="size-5 text-primary" />
                Live proximity radar
              </h2>
              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                    sensorQuery.data?.sensor_status.connected
                      ? "bg-normal text-normal-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  title={sensorQuery.data?.sensor_status.port ?? "Arduino serial sensor"}
                >
                  <Radio aria-hidden="true" className="size-3.5" />
                  {sensorQuery.data?.sensor_status.connected ? "Sensor live" : "Sensor offline"}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-extrabold uppercase tracking-wide ${threatStyles[level].badge} ${
                    level === "Collision" || level === "Alarming" ? "pulse-threat" : ""
                  }`}
                >
                  {liveThreatLabel}
                </span>
              </div>
            </div>

            <p aria-live="polite" className="mt-3 text-base font-semibold">
              {telemetryQuery.isLoading
                ? "Connecting to the sensor stream…"
                : sensorReading
                  ? `${sensorReading.device_id} reports ${liveDistance} cm — ${sensorReading.threat_level}`
                  : latest
                    ? `${latest.detected_object} detected at ${Math.round(Number(latest.distance_cm))} cm — ${latest.threat_level}`
                    : "No obstacles detected yet. Your sensor stream is idle."}
            </p>

            {sensorReading && (
              <p className="mt-1 text-sm text-muted-foreground">
                Received {relativeTime(sensorReading.timestamp)}
                {typeof sensorReading.processing_latency_ms === "number"
                  ? ` · ${sensorReading.processing_latency_ms} ms processing latency`
                  : ""}
              </p>
            )}
            {sensorQuery.data?.sensor_status.last_error &&
              !sensorQuery.data.sensor_status.connected && (
                <p className="mt-1 text-sm text-muted-foreground" role="status">
                  {sensorQuery.data.sensor_status.last_error}
                </p>
              )}

            <div className="mt-5">
              {telemetryQuery.isLoading ? (
                <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-border bg-card p-6">
                  <CuteLeafLoader text="Connecting to sensor stream..." size="md" />
                </div>
              ) : (
                <DistanceMeter distance={liveDistance} level={level} />
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <Volume2 aria-hidden="true" className="size-5 text-primary" />
                <div>
                  <Label htmlFor="voice-alerts" className="text-base font-semibold">
                    Browser voice alerts
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Speaks a warning whenever a reading is Alarming or Collision.
                  </p>
                </div>
              </div>
              <Switch
                id="voice-alerts"
                checked={voiceOn}
                onCheckedChange={(v) => {
                  setVoiceOn(v);
                  window.localStorage.setItem("netrasense:voice", v ? "on" : "off");
                  if (v) speak("Voice alerts enabled.");
                }}
              />
            </div>

            <Button variant="outline" className="mt-4 w-full" onClick={() => void simulate()}>
              <Zap aria-hidden="true" className="size-4" />
              Simulate a sensor reading
            </Button>
          </section>

          {/* --- BLIND'S EYE AI VISION LENS SECTION --- */}
          <section aria-labelledby="vision-heading">
            <h2 id="vision-heading" className="sr-only">
              Blind's Eye Visual Recognition
            </h2>
            <BlindsEyeLens />
          </section>
        </div>

        {/* --- RIGHT SIDEBAR: CONTACTS & RECENT INCIDENTS --- */}
        <div className="space-y-6">
          <section aria-labelledby="contacts-heading" className="surface-card p-5">
            <h2 id="contacts-heading" className="text-lg font-bold">
              Caregiver quick-glance
            </h2>
            <ul className="mt-4 space-y-2">
              {contactsQuery.isLoading && <Skeleton className="h-16 rounded-lg" />}
              {!contactsQuery.isLoading && (contactsQuery.data ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">No emergency contacts saved yet.</li>
              )}
              {(contactsQuery.data ?? []).slice(0, 3).map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.contact_name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.relationship ?? "Contact"} · {c.phone_number}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <a href={`tel:${c.phone_number}`} aria-label={`Call ${c.contact_name}`}>
                      <PhoneCall aria-hidden="true" className="size-4" />
                      Call
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="feed-heading" className="surface-card p-5">
            <h2 id="feed-heading" className="text-lg font-bold">
              Recent incidents
            </h2>
            <ul className="mt-4 space-y-2" aria-live="polite" data-now={now}>
              {telemetryQuery.isLoading && <Skeleton className="h-14 rounded-lg" />}
              {!telemetryQuery.isLoading && (telemetryQuery.data ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No encounters logged yet. Readings appear here the moment they arrive.
                </li>
              )}
              {(telemetryQuery.data ?? []).slice(0, 5).map((t) => (
                <li key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold">{t.detected_object}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${threatStyles[t.threat_level].badge}`}
                    >
                      {t.threat_level}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {Math.round(Number(t.distance_cm))} cm · {relativeTime(t.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
