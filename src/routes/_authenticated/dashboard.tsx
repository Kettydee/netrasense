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
import { RadarVisualization } from "@/components/RadarVisualization";
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
  type ThreatLevel,
  NO_DATA_SENTINEL,
  NO_DISTANCE_PLACEHOLDER,
} from "@/lib/netrasense";
import {
  fetchSensorTelemetry,
  fetchHardwareStatus,
  hardwareThreatToUiLevel,
  type HardwareStatus,
  type EnsembleBreakdown,
} from "@/lib/sensor";
import type { VisionTelemetryEvent } from "@/components/BlindsEyeLens";

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
  hasData,
}: {
  distance: number;
  level: keyof typeof threatStyles;
  hasData: boolean;
}) {
  const pct = hasData ? Math.max(0, Math.min(1, distance / MAX_DISTANCE_CM)) : 0;
  const radius = 76;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
      <svg
        width="180"
        height="180"
        viewBox="0 0 180 180"
        role="img"
        aria-label={hasData ? `${distance} centimetres to obstacle` : "No sensor data available"}
      >
        <circle cx="90" cy="90" r={radius} fill="none" strokeWidth="14" className="stroke-muted" />
        {hasData ? (
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
        ) : (
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            transform="rotate(-90 90 90)"
            className="stroke-muted-foreground/30"
          />
        )}
        <text x="90" y="86" textAnchor="middle" className="fill-foreground text-2xl font-extrabold">
          {hasData ? distance : "--"}
        </text>
        <text x="90" y="108" textAnchor="middle" className="fill-muted-foreground text-xs">
          {hasData ? "cm" : "no data"}
        </text>
      </svg>
      <div className="w-full">
        <p className="text-sm font-semibold text-muted-foreground">
          Proximity range 0 – {MAX_DISTANCE_CM} cm
        </p>
        <div className="mt-2 h-5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-all duration-500 ${hasData ? threatStyles[level].bar : "bg-muted-foreground/20"}`}
            style={{ width: hasData ? `${Math.max(4, pct * 100)}%` : "0%" }}
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

function EnsembleSignalCard({ ensemble }: { ensemble: EnsembleBreakdown }) {
  const hasData = ensemble.signal_count > 0 && ensemble.fused_threat_level !== "NO DATA";

  const signals = [
    { name: "Ultrasonic", icon: "🔊", data: ensemble.ultrasonic, weight: "50%" },
    { name: "YOLO Vision", icon: "👁", data: ensemble.yolo, weight: "30%" },
    { name: "Depth Est.", icon: "📐", data: ensemble.depth, weight: "20%" },
  ];

  const confidencePct = Math.round(ensemble.confidence * 100);
  const confidenceColor =
    confidencePct >= 80
      ? "text-emerald-400"
      : confidencePct >= 50
        ? "text-amber-400"
        : "text-zinc-400";

  const threatColor = (level: string | null) => {
    if (!level) return "text-zinc-500";
    switch (level) {
      case "CRITICAL":
      case "Collision":
        return "text-rose-400";
      case "ALARM":
      case "Alarming":
        return "text-orange-400";
      case "WARNING":
      case "Warning":
        return "text-amber-400";
      default:
        return "text-emerald-400";
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
          Ensemble Signal Fusion
        </h3>
        {hasData && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-muted-foreground">CONFIDENCE</span>
            <span className={`font-mono text-sm font-black ${confidenceColor}`}>
              {confidencePct}%
            </span>
          </div>
        )}
      </div>

      {!hasData ? (
        <p className="text-xs text-muted-foreground italic">
          No ensemble data — waiting for sensor signals
        </p>
      ) : (
        <>
          {/* Confidence bar */}
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500 bg-cyan-400"
              style={{ width: `${confidencePct}%` }}
            />
          </div>

          {/* Per-signal breakdown */}
          <div className="space-y-2">
            {signals.map((sig) => {
              const active = sig.data.distance_cm !== null;
              return (
                <div
                  key={sig.name}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm" aria-hidden="true">
                      {sig.icon}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-foreground">
                        {sig.name}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          ({sig.weight})
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {active ? sig.data.threat_level ?? "—" : "No signal"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-sm font-black tabular-nums ${
                        active ? "text-foreground" : "text-zinc-500"
                      }`}
                    >
                      {active ? `${Math.round(sig.data.distance_cm!)} cm` : "—"}
                    </span>
                    <p className={`text-[10px] font-bold ${threatColor(sig.data.threat_level)}`}>
                      {active ? sig.data.threat_level ?? "—" : "OFF"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fused result footer */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-400">
              Fused Result
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-black text-foreground tabular-nums">
                {Math.round(ensemble.fused_distance_cm ?? 0)} cm
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${
                  threatColor(ensemble.fused_threat_level)
                } bg-card border border-border`}
              >
                {ensemble.fused_threat_level}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [voiceOn, setVoiceOn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sessionMinutes, setSessionMinutes] = useState<number>(0);
  const [liveVision, setLiveVision] = useState<{
    object: string;
    distance_cm: number;
    threat_level: ThreatLevel;
    timestamp: number;
  } | null>(null);
  const [liveIncidents, setLiveIncidents] = useState<Telemetry[]>([]);
  const lastLoggedVisionRef = useRef<Map<string, number>>(new Map());
  const lastSpokenId = useRef<string | null>(null);
  const userId = user?.id ?? "";

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Local persistent state keyed by date for instant offline/guest/online sync
  const [localDailyDodged, setLocalDailyDodged] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return Number(window.localStorage.getItem(`netrasense:dodged_${userId || "guest"}_${today}`) || 0);
    }
    return 0;
  });

  const [localDailyDistM, setLocalDailyDistM] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return Number(window.localStorage.getItem(`netrasense:dist_${userId || "guest"}_${today}`) || 0);
    }
    return 0;
  });

  const [localLifetimeMinutes, setLocalLifetimeMinutes] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return Number(window.localStorage.getItem(`netrasense:lifetime_mins_${userId || "guest"}`) || 0);
    }
    return 0;
  });

  useEffect(() => {
    setVoiceOn(window.localStorage.getItem("netrasense:voice") === "on");
  }, []);

  // Minute ticker for assistance time
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 2000);
    const m = window.setInterval(() => {
      setSessionMinutes((prev) => prev + 1);
      setLocalLifetimeMinutes((prev) => {
        const next = prev + 1;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`netrasense:lifetime_mins_${userId || "guest"}`, String(next));
        }
        return next;
      });
    }, 60000);

    return () => {
      window.clearInterval(t);
      window.clearInterval(m);
    };
  }, [userId]);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId && !userId.startsWith("demo-"),
    queryFn: () => fetchProfile(userId),
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", userId],
    enabled: !!userId && !userId.startsWith("demo-"),
    queryFn: fetchContacts,
  });
  const telemetryQuery = useQuery({
    queryKey: ["telemetry", userId],
    enabled: !!userId && !userId.startsWith("demo-"),
    queryFn: () => fetchTelemetry(50),
  });
  const statsQuery = useQuery({
    queryKey: ["daily-stats", userId],
    enabled: !!userId && !userId.startsWith("demo-"),
    queryFn: () => fetchDailyStats(userId),
  });
  const sensorQuery = useQuery({
    queryKey: ["arduino-sensor"],
    queryFn: fetchSensorTelemetry,
    refetchInterval: 500,
    retry: false,
  });

  const hardwareQuery = useQuery<HardwareStatus>({
    queryKey: ["hardware-status"],
    queryFn: fetchHardwareStatus,
    refetchInterval: 1000,
    retry: false,
    // If the server is unreachable, return a fully-disconnected default.
    placeholderData: () => ({
      system: { status: "NO HARDWARE", sensor_heartbeat_timeout_s: 3 },
      arduino: { connected: false, port: null, last_error: null, status: "DISCONNECTED", last_update: 0, total_readings: 0 },
      ultrasonic: { active: false, distance_cm: null, threat_level: null, device_id: null, timestamp: null, status: "NOT ACTIVE" },
      camera: { connected: false, fps: 0, source: null, last_frame_timestamp: null, last_error: null, status: "DISCONNECTED" },
      ai: { loaded: false, processing: false, model: null, status: "NOT READY" },
    }),
  });

  const hw = hardwareQuery.data;  // shorthand

  const todayStats = statsQuery.data?.find((s) => s.date === today);
  const yesterdayStats = statsQuery.data?.find((s) => s.date === yesterday);

  // Sync vision detections to daily stats and lifetime metrics
  const handleVisionTelemetry = useCallback(
    (event: VisionTelemetryEvent) => {
      const timestamp = Date.now();
      setLiveVision({
        object: event.object,
        distance_cm: event.distance_cm,
        threat_level: event.threat_level,
        timestamp,
      });

      const lastLogged = lastLoggedVisionRef.current.get(event.object) || 0;
      if (timestamp - lastLogged > 3500) {
        lastLoggedVisionRef.current.set(event.object, timestamp);

        const isObstacle = event.threat_level !== "Normal";
        let newDodged = localDailyDodged;
        let newDist = localDailyDistM + 15;

        if (isObstacle) {
          newDodged += 1;
          setLocalDailyDodged(newDodged);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(`netrasense:dodged_${userId || "guest"}_${today}`, String(newDodged));
          }
        }

        setLocalDailyDistM(newDist);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`netrasense:dist_${userId || "guest"}_${today}`, String(newDist));
        }

        const newIncident: Telemetry = {
          id: `vis-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          user_id: userId || "guest",
          detected_object: event.object.charAt(0).toUpperCase() + event.object.slice(1),
          distance_cm: event.distance_cm,
          threat_level: event.threat_level,
          action_taken: "AI Vision spatial detection",
          created_at: new Date().toISOString(),
        };

        setLiveIncidents((prev) => [newIncident, ...prev.slice(0, 19)]);

        // Persist daily stats to database for registered users
        if (userId && !userId.startsWith("demo-")) {
          supabase
            .from("telemetry_stream")
            .insert({
              user_id: userId,
              detected_object: newIncident.detected_object,
              distance_cm: event.distance_cm,
              threat_level: event.threat_level,
              action_taken: "AI Vision spatial detection",
            })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ["telemetry", userId] });
            });

          const totalDodged = (todayStats?.obstacles_avoided ?? 0) + (isObstacle ? 1 : 0);
          const totalDistM = Number(todayStats?.safe_distance_walked_m ?? 0) + 15;
          const totalMins = (todayStats?.active_session_minutes ?? 0) + 1;

          supabase
            .from("daily_stats")
            .upsert(
              {
                user_id: userId,
                date: today,
                obstacles_avoided: totalDodged,
                safe_distance_walked_m: totalDistM,
                active_session_minutes: totalMins,
              },
              { onConflict: "user_id,date" },
            )
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ["daily-stats", userId] });
            });
        }
      }
    },
    [userId, today, todayStats, localDailyDodged, localDailyDistM, queryClient],
  );

  useEffect(() => {
    if (!userId || userId.startsWith("demo-")) return;
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

  // ── Derive live state from authoritative hardware status ──────────
  const arduinoConnected = hw?.arduino.connected ?? false;
  const ultrasonicActive = hw?.ultrasonic.active ?? false;
  const ultrasonicDistance = hw?.ultrasonic.distance_cm;
  const ultrasonicThreatHw = hw?.ultrasonic.threat_level;
  const cameraConnected = hw?.camera.connected ?? false;
  const aiLoaded = hw?.ai.loaded ?? false;
  const aiProcessing = hw?.ai.processing ?? false;
  const cameraStatus = hw?.camera.status ?? "DISCONNECTED";
  const aiStatus = hw?.ai.status ?? "NOT READY";
  const arduinoStatus = hw?.arduino.status ?? "DISCONNECTED";
  const systemStatus = hw?.system.status ?? "NO HARDWARE";

  // Ensemble signal breakdown (from /api/latest via sensorQuery)
  const ensemble: EnsembleBreakdown | undefined = sensorQuery.data?.ensemble;

  // Determine if we have ANY valid sensor data right now
  const hasSensorData = ultrasonicActive && ultrasonicDistance !== null;

  // Distance: real value only when sensor is active
  const liveDistance = hasSensorData ? Math.round(ultrasonicDistance!) : null;

  // Threat level: real value only when sensor is active
  const sensorLevel = hasSensorData && ultrasonicThreatHw
    ? hardwareThreatToUiLevel(ultrasonicThreatHw)
    : null;
  const level = sensorLevel ?? "Normal"; // fallback for type safety; hasData flag controls display
  const liveThreatLabel = hasSensorData && ultrasonicThreatHw
    ? ultrasonicThreatHw
    : NO_DATA_SENTINEL;

  useEffect(() => {
    if (!voiceOn) return;
    if (level !== "Alarming" && level !== "Collision") {
      lastSpokenId.current = null;
      return;
    }
    if (lastSpokenId.current === level) return;
    lastSpokenId.current = level;
    const source = hasSensorData ? "Obstacle" : (latest?.detected_object ?? "Obstacle");
    const distText = liveDistance !== null ? `${liveDistance} centimeters` : "unknown distance";
    speak(`Warning: ${source} at ${distText}`);
  }, [latest?.detected_object, level, liveDistance, hasSensorData, voiceOn]);

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
    const isObstacle = level !== "Normal";
    const nextDodged = (prev?.obstacles_avoided ?? 0) + (isObstacle ? 1 : 0);
    const nextDist = Number(prev?.safe_distance_walked_m ?? 0) + 18;
    const nextMins = (prev?.active_session_minutes ?? 0) + 1;

    setLocalDailyDodged((p) => p + (isObstacle ? 1 : 0));
    setLocalDailyDistM((p) => p + 18);

    const { error: statsError } = await supabase.from("daily_stats").upsert(
      {
        user_id: userId,
        date: today,
        obstacles_avoided: nextDodged,
        safe_distance_walked_m: nextDist,
        active_session_minutes: nextMins,
      },
      { onConflict: "user_id,date" },
    );
    if (statsError) toast.error("Reading saved, but daily stats could not update.");
    void queryClient.invalidateQueries({ queryKey: ["telemetry", userId] });
    void queryClient.invalidateQueries({ queryKey: ["daily-stats", userId] });
  }, [userId, today, todayStats, queryClient]);

  const needsOnboarding =
    !profileQuery.isLoading &&
    !!profileQuery.data &&
    (!profileQuery.data.full_name || !profileQuery.data.impairment_level);

  // 1. Obstacles dodged TODAY (refreshes to 0 on next day)
  const obstaclesToday = Math.max(
    todayStats?.obstacles_avoided ?? 0,
    localDailyDodged,
  );
  const obstacleTrend = obstaclesToday - (yesterdayStats?.obstacles_avoided ?? 0);

  // 2. Safe distance explored TODAY (refreshes to 0 on next day)
  const distanceWalkedTodayM = Math.max(
    Number(todayStats?.safe_distance_walked_m ?? 0),
    localDailyDistM,
  );
  const distanceKm = (distanceWalkedTodayM / 1000).toFixed(2);

  // 3. Active assistance time LIFETIME (from account creation until account deletion)
  const historicalLifetimeMinutes = (statsQuery.data ?? []).reduce(
    (acc, curr) => acc + (curr.active_session_minutes || 0),
    0,
  );
  const totalLifetimeMinutes = Math.max(
    localLifetimeMinutes,
    historicalLifetimeMinutes + sessionMinutes,
  );

  const isLiveVisionActive = !!(liveVision && now - liveVision.timestamp < 4500);
  const currentDistance = isLiveVisionActive
    ? liveVision.distance_cm
    : latest
      ? Math.round(Number(latest.distance_cm))
      : MAX_DISTANCE_CM;
  const currentObject = isLiveVisionActive
    ? liveVision.object
    : latest
      ? latest.detected_object
      : null;

  const allIncidents: Telemetry[] = [
    ...liveIncidents,
    ...(telemetryQuery.data ?? []).filter((t) => !liveIncidents.some((li) => li.id === t.id)),
  ].slice(0, 5);

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
          Navigation statistics
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
              value={String(obstaclesToday)}
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
              value={`${Math.floor(totalLifetimeMinutes / 60)}h ${totalLifetimeMinutes % 60}m`}
              sub="All-time navigation assistance"
            />
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* --- LIVE ENVIRONMENT COMMAND SECTION --- */}
          <section aria-labelledby="live-heading" className="surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <h2 id="live-heading" className="text-xl font-bold tracking-tight">
                    LIVE ENVIRONMENT
                  </h2>
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                  Active Obstacle Telemetry & Spatial Positioning
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${
                    ultrasonicActive
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                      : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30"
                  }`}
                >
                  <Radio aria-hidden="true" className="size-3.5" />
                  {ultrasonicActive ? "SENSOR LIVE" : "SENSOR NOT ACTIVE"}
                </span>
                <span
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-black uppercase tracking-wider border ${
                    !hasSensorData
                      ? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                      : level === "Collision"
                        ? "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse"
                        : level === "Alarming"
                          ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                          : level === "Warning"
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                            : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  }`}
                >
                  {liveThreatLabel}
                </span>
              </div>
            </div>

            <p aria-live="polite" className="mt-3 text-base font-semibold">
              {isLiveVisionActive
                ? `${currentObject} detected at ${currentDistance} cm — ${level}`
                : telemetryQuery.isLoading
                  ? "Connecting to the sensor stream…"
                  : latest
                    ? `${latest.detected_object} detected at ${Math.round(Number(latest.distance_cm))} cm — ${latest.threat_level}`
                    : "No obstacles detected yet. Your camera / sensor stream is idle."}
            </p>

            <div className="mt-5">
              {telemetryQuery.isLoading && !isLiveVisionActive ? (
                <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-border bg-card p-6">
                  <CuteLeafLoader text="Connecting to sensor stream..." size="md" />
                </div>
              ) : (
                <DistanceMeter
                  distance={currentDistance}
                  level={level}
                  hasData={hasSensorData}
                />
              )}
            </div>

            {/* Ensemble Signal Fusion Breakdown */}
            {ensemble && <EnsembleSignalCard ensemble={ensemble} />}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-elevated p-4">
              <div className="flex items-center gap-3">
                <Volume2 aria-hidden="true" className="size-5 text-primary" />
                <div>
                  <Label htmlFor="voice-alerts" className="text-base font-semibold">
                    Browser Voice Alerts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Spoken directional audio when Alarming or Collision threats occur.
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
              Simulate Sensor Reading
            </Button>
          </section>

          {/* --- BLIND'S EYE AI VISION LENS SECTION --- */}
          <section aria-labelledby="vision-heading">
            <h2 id="vision-heading" className="sr-only">
              Blind's Eye Visual Recognition
            </h2>
            <BlindsEyeLens onVisionTelemetry={handleVisionTelemetry} />
          </section>
        </div>

        {/* --- RIGHT COLUMN: DEVICE STATUS & CAREGIVER QUICK GLANCE --- */}
        <div className="space-y-6">
          {/* DEVICE STATUS CARD — all values from runtime state */}
          <section aria-labelledby="device-status-heading" className="surface-card p-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2
                id="device-status-heading"
                className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground"
              >
                DEVICE STATUS
              </h2>
              <span
                className={`flex items-center gap-1.5 text-xs font-bold ${
                  systemStatus === "ONLINE"
                    ? "text-emerald-400"
                    : "text-zinc-400"
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    systemStatus === "ONLINE"
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-zinc-400"
                  }`}
                />
                {systemStatus === "ONLINE" ? "ONLINE" : "NO HARDWARE"}
              </span>
            </div>

            <ul className="mt-3 divide-y divide-border/60 text-sm">
              {/* Arduino Serial */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">Arduino Serial</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    arduinoStatus === "CONNECTED"
                      ? "text-emerald-400"
                      : "text-zinc-400"
                  }`}
                >
                  {arduinoStatus}
                </span>
              </li>
              {/* HC-SR04 Ultrasonic */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">HC-SR04 Ultrasonic</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    ultrasonicActive
                      ? "text-emerald-400"
                      : "text-zinc-400"
                  }`}
                >
                  {hw?.ultrasonic.status ?? "NOT ACTIVE"}
                </span>
              </li>
              {/* Camera Stream */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">Camera Stream</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    cameraStatus === "ACTIVE"
                      ? "text-emerald-400"
                      : cameraStatus === "ERROR"
                        ? "text-rose-400"
                        : "text-zinc-400"
                  }`}
                >
                  {cameraStatus === "ACTIVE"
                    ? `ACTIVE (${hw?.camera.fps?.toFixed(0) ?? 0} FPS)`
                    : cameraStatus}
                </span>
              </li>
              {/* AI Engine */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">AI Engine</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    aiProcessing
                      ? "text-cyan-400"
                      : aiLoaded
                        ? "text-amber-400"
                        : "text-zinc-400"
                  }`}
                >
                  {hw?.ai.model
                    ? `${hw.ai.model} · ${aiStatus}`
                    : aiStatus}
                </span>
              </li>
              {/* Last Telemetry Sync */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">Last Telemetry Sync</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {hasSensorData
                    ? `${((Date.now() / 1000 - (hw?.ultrasonic.timestamp ? new Date(hw.ultrasonic.timestamp).getTime() / 1000 : 0)) || 0).toFixed(1)}s ago`
                    : "No data"}
                </span>
              </li>
            </ul>
          </section>
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
              {telemetryQuery.isLoading && allIncidents.length === 0 && <Skeleton className="h-14 rounded-lg" />}
              {allIncidents.length === 0 && !telemetryQuery.isLoading && (
                <li className="text-sm text-muted-foreground">
                  No encounters logged yet. Readings appear here the moment they arrive.
                </li>
              )}
              {allIncidents.map((t) => (
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
