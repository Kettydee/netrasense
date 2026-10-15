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
  fetchUnifiedStatus,
  hardwareThreatToUiLevel,
  SENSOR_HEARTBEAT_TIMEOUT_S,
  type HardwareStatus,
  type EnsembleBreakdown,
  type ObstacleWarningState,
  type ObstacleWarningInfo,
} from "@/lib/sensor";
import { webSerialManager, type WebSerialReading } from "@/lib/webSerial";
import type { VisionTelemetryEvent } from "@/components/BlindsEyeLens";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
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

  // Direct hex colors guarantee the SVG circle renders cleanly regardless of theme
  const strokeColor =
    level === "Collision"
      ? "#f43f5e"
      : level === "Alarming"
        ? "#f97316"
        : level === "Warning"
          ? "#f59e0b"
          : "#10b981";

  const barColor =
    level === "Collision"
      ? "bg-rose-500"
      : level === "Alarming"
        ? "bg-orange-500"
        : level === "Warning"
          ? "bg-amber-400"
          : "bg-emerald-400";

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
      <svg
        width="180"
        height="180"
        viewBox="0 0 180 180"
        role="img"
        aria-label={hasData ? `${distance} centimetres to obstacle` : "No sensor data available"}
        className="shrink-0 drop-shadow-md"
      >
        {/* Background track circle */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          strokeWidth="14"
          stroke="rgba(255, 255, 255, 0.12)"
        />
        {/* Active Proximity Ring */}
        {hasData ? (
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            stroke={strokeColor}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            transform="rotate(-90 90 90)"
            style={{ transition: "stroke-dashoffset 75ms linear, stroke 150ms ease" }}
          />
        ) : (
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            transform="rotate(-90 90 90)"
          />
        )}
        {/* High-contrast Distance Text in bright white */}
        <text
          x="90"
          y="84"
          textAnchor="middle"
          fill="#ffffff"
          className="text-3xl font-black tracking-tight"
          style={{ fill: "#ffffff", fontWeight: 900 }}
        >
          {hasData ? distance : "--"}
        </text>
        <text
          x="90"
          y="108"
          textAnchor="middle"
          fill="#94a3b8"
          className="text-xs font-bold uppercase tracking-widest"
          style={{ fill: "#94a3b8" }}
        >
          {hasData ? "cm" : "no data"}
        </text>
      </svg>
      <div className="w-full">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-muted-foreground">
            Proximity range 0 – {MAX_DISTANCE_CM} cm
          </p>
          <span className="font-mono text-sm font-black text-foreground">
            {hasData ? `${distance} cm` : "--"}
          </span>
        </div>
        <div className="mt-2 h-5 w-full overflow-hidden rounded-full bg-zinc-800/80 border border-zinc-700/50" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-all duration-75 ${hasData ? barColor : "bg-zinc-600/30"}`}
            style={{ width: hasData ? `${Math.max(4, pct * 100)}%` : "0%" }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <span aria-hidden="true">🔴</span> Critical Zone (Alert)
            </dt>
            <dd className="font-semibold text-collision">Below 50 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <span aria-hidden="true">🟠</span> Alarm Zone (Alert)
            </dt>
            <dd className="font-semibold text-alarming">50 – 99 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <span aria-hidden="true">🟡</span> Warning Zone
            </dt>
            <dd className="font-semibold text-warning">100 – 300 cm</dd>
          </div>
          <div>
            <dt className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <span aria-hidden="true">🟢</span> Normal Zone
            </dt>
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
            <span className="text-[10px] font-bold text-muted-foreground">SIGNAL AGREEMENT</span>
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
    timestamp: number;
    direction?: string | undefined;
  } | null>(null);
  const [liveIncidents, setLiveIncidents] = useState<Telemetry[]>([]);
  const lastLoggedVisionRef = useRef<Map<string, number>>(new Map());
  const lastSpokenId = useRef<string | null>(null);
  const userId = user?.id ?? "";

  const [webSerialData, setWebSerialData] = useState<WebSerialReading | null>(null);
  const [isWebSerialConnected, setIsWebSerialConnected] = useState(false);
  const [browserCameraActive, setBrowserCameraActive] = useState(false);

  // Latest hardware/USB snapshot for memoized callbacks (see handleVisionTelemetry).
  const sensorSnapshotRef = useRef<{
    webSerial: WebSerialReading | null;
    usbFresh: boolean;
    hw: HardwareStatus | undefined;
  }>({ webSerial: null, usbFresh: false, hw: undefined });

  useEffect(() => {
    webSerialManager.onReading((data) => {
      setWebSerialData(data);
    });
    webSerialManager.onStatus((connected, error) => {
      setIsWebSerialConnected(connected);
      if (connected) {
        toast.success("Connected directly to Arduino USB!");
      } else if (error) {
        toast.error(`Arduino USB: ${error}`);
      }
    });

    // Auto-reconnect if port was previously authorized by the browser
    void webSerialManager.autoConnectIfAuthorized();
  }, []);

  const handleCameraStatusChange = useCallback((active: boolean) => {
    setBrowserCameraActive(active);
  }, []);

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
  // Single unified poll: /api/status returns hardware + sensor + ensemble
  const DEFAULT_STATUS: import("@/lib/sensor").UnifiedStatusResponse = {
    hardware: {
      system: { status: "NO HARDWARE" as const, sensor_heartbeat_timeout_s: 3 },
      arduino: { connected: false, port: null, last_error: null, status: "DISCONNECTED" as const, last_update: 0, total_readings: 0 },
      ultrasonic: { active: false, distance_cm: null, threat_level: null, device_id: null, timestamp: null, status: "NOT ACTIVE" as const },
      camera: { connected: false, fps: 0, source: null, last_frame_timestamp: null, last_error: null, status: "DISCONNECTED" as const },
      ai: { loaded: false, processing: false, model: null, status: "NOT READY" as const },
    },
    sensor_data: null,
    ensemble: null,
    fps: 0,
    mode: "all",
    detections: [],
  };

  const statusQuery = useQuery({
    queryKey: ["unified-status"],
    queryFn: fetchUnifiedStatus,
    refetchInterval: 250,  // Fast 250ms polling for low-latency sensor synchronization
    retry: false,
    placeholderData: () => DEFAULT_STATUS,
  });

  const hw = statusQuery.data?.hardware;  // shorthand

  const todayStats = statsQuery.data?.find((s) => s.date === today);
  const yesterdayStats = statsQuery.data?.find((s) => s.date === yesterday);

  // Sync vision detections to daily stats and lifetime metrics
  const handleVisionTelemetry = useCallback(
    (event: VisionTelemetryEvent) => {
      const timestamp = Date.now();
      setLiveVision({
        object: event.object,
        timestamp,
        direction: event.direction,
      });

      const lastLogged = lastLoggedVisionRef.current.get(event.object) || 0;
      if (timestamp - lastLogged > 3500) {
        lastLoggedVisionRef.current.set(event.object, timestamp);

        // Read the latest sensor snapshot through a ref: this callback is
        // memoized (and its consumers hold it in effect dependency lists), so
        // captured webSerialData/hw values would otherwise go stale and log
        // outdated distances.  Stale USB readings are excluded.
        const snapshot = sensorSnapshotRef.current;
        const usbDistance = snapshot.usbFresh ? (snapshot.webSerial?.distance_cm ?? null) : null;
        const currentSensorDist = usbDistance ?? snapshot.hw?.ultrasonic?.distance_cm ?? null;
        const currentThreat = currentSensorDist !== null ? classifyDistance(currentSensorDist) : "Normal";
        const isObstacle = currentThreat !== "Normal";
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
          distance_cm: currentSensorDist ?? 0,
          threat_level: currentThreat,
          action_taken: currentSensorDist !== null ? "Ultrasonic Sensor + Camera Detection" : "Camera Detection",
          created_at: new Date().toISOString(),
        };

        setLiveIncidents((prev) => [newIncident, ...prev.slice(0, 19)]);

        // Persist daily stats to database for registered users
        if (userId && !userId.startsWith("demo-")) {
          void Promise.resolve(
            supabase
              .from("telemetry_stream")
              .insert({
                user_id: userId,
                detected_object: newIncident.detected_object,
                distance_cm: newIncident.distance_cm,
                threat_level: newIncident.threat_level,
                action_taken: newIncident.action_taken,
              })
          ).then(() => {
            queryClient.invalidateQueries({ queryKey: ["telemetry", userId] });
          }).catch(() => {
            // Silently ignore — telemetry insert is best-effort
          });

          const totalDodged = (todayStats?.obstacles_avoided ?? 0) + (isObstacle ? 1 : 0);
          const totalDistM = Number(todayStats?.safe_distance_walked_m ?? 0) + 15;
          const totalMins = (todayStats?.active_session_minutes ?? 0) + 1;

          void Promise.resolve(
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
          ).then(() => {
            queryClient.invalidateQueries({ queryKey: ["daily-stats", userId] });
          }).catch(() => {
            // Silently ignore — daily stats upsert is best-effort
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

  // ── Derive live state from authoritative hardware status + Web Serial USB fallback ──────────
  // USB readings carry their own arrival timestamp: trust them only inside the
  // same heartbeat window the Python backend uses, and compute age from the
  // actual timestamp (never a hardcoded value).
  const webSerialAgeSeconds: number | null =
    webSerialData?.timestamp != null
      ? Math.max(0, (Date.now() - new Date(webSerialData.timestamp).getTime()) / 1000)
      : null;
  const isWebSerialFresh =
    isWebSerialConnected &&
    webSerialData !== null &&
    webSerialAgeSeconds !== null &&
    webSerialAgeSeconds < SENSOR_HEARTBEAT_TIMEOUT_S;

  // Keep the snapshot ref current so memoized callbacks never read stale data.
  useEffect(() => {
    sensorSnapshotRef.current = {
      webSerial: webSerialData,
      usbFresh: isWebSerialFresh,
      hw,
    };
  });

  const isArduinoLive = isWebSerialConnected || (hw?.arduino?.connected ?? false);
  const isUltrasonicLive = isWebSerialConnected
    ? isWebSerialFresh
    : (hw?.ultrasonic?.active ?? false);
  const arduinoConnected = isArduinoLive;
  const ultrasonicActive = isUltrasonicLive;
  const ultrasonicDistance = isWebSerialConnected
    ? isWebSerialFresh
      ? (webSerialData?.distance_cm ?? null)
      : null
    : hw?.ultrasonic?.distance_cm;
  const ultrasonicThreatHw = isWebSerialConnected
    ? (webSerialData?.threat_level ?? null)
    : hw?.ultrasonic?.threat_level;
  const cameraConnected = hw?.camera?.connected ?? false;
  const aiLoaded = hw?.ai?.loaded ?? false;
  const aiProcessing = hw?.ai?.processing ?? false;
  const cameraStatus = browserCameraActive ? "ACTIVE" : (hw?.camera?.status ?? "DISCONNECTED");
  const aiStatus = hw?.ai?.status ?? "NOT READY";
  const arduinoStatus = isWebSerialConnected
    ? "CONNECTED (USB)"
    : (hw?.arduino?.status ?? "DISCONNECTED");
  const systemStatus = isWebSerialConnected ? "ONLINE" : (hw?.system?.status ?? "NO HARDWARE");

  // Ensemble signal breakdown (from unified /api/status)
  const ensemble: EnsembleBreakdown | undefined = statusQuery.data?.ensemble ?? undefined;

  // Determine if we have ANY valid hardware ultrasonic sensor data right now
  // USB mode must use only readings from the USB stream; do not let stale
  // backend telemetry stand in for a missing USB measurement.  The ensemble
  // breakdown carries no timestamp, so it is never used as a distance source:
  // a stale ensemble value must not stand in for live data.
  const rawHwDistance = isWebSerialConnected
    ? isWebSerialFresh
      ? (webSerialData?.distance_cm ?? null)
      : null
    : hw?.ultrasonic?.active && hw.ultrasonic.distance_cm !== null
      ? hw.ultrasonic.distance_cm
      : statusQuery.data?.sensor_data?.distance_cm !== undefined &&
          statusQuery.data?.sensor_data?.distance_cm !== null
        ? Number(statusQuery.data.sensor_data.distance_cm)
        : null;

  const rawHwThreat = isWebSerialConnected
    ? (webSerialData?.threat_level ?? null)
    : (hw?.ultrasonic?.threat_level ?? statusQuery.data?.sensor_data?.threat_level ?? null);

  const hasBackendSensorData =
    (hw?.ultrasonic?.active || !!statusQuery.data?.sensor_data) && rawHwDistance !== null;
  const hasSensorData = isWebSerialConnected
    ? webSerialData !== null && rawHwDistance !== null
    : hasBackendSensorData;

  // Distance is STRICTLY from the physical ultrasonic sensor (never from the webcam):
  const liveDistance = hasSensorData && rawHwDistance !== null
    ? Number(rawHwDistance.toFixed(1))
    : null;
  // The live distance gauge is sourced exclusively from the ultrasonic sensor.
  // Camera detections identify objects but do not include a measured distance.
  const isLiveVisionActive = !!(liveVision && now - liveVision.timestamp < 5000);
  const currentDistance = liveDistance ?? MAX_DISTANCE_CM;

  // Active object identification strictly from webcam:
  const currentObject = isLiveVisionActive && liveVision.object
    ? (liveVision.object.charAt(0).toUpperCase() + liveVision.object.slice(1))
    : (currentDistance < 300 ? "Obstacle" : "Pathway");

  // ── Authoritative 4-State Obstacle Warning Logic ─────────────────
  // Distinguishes between:
  // 1. OBSTACLE WARNING: Valid measurement at or below configured threshold
  // 2. CLEAR: Valid, sufficiently recent measurement above threshold
  // 3. SENSOR ERROR: Invalid measurement (timeout, corrupted, impossible value)
  // 4. SENSOR UNAVAILABLE: No fresh reading within configured timeout
  const backendObsState: ObstacleWarningState | undefined =
    hw?.ultrasonic?.obstacle_state ?? hw?.obstacle_warning?.state;

  const obstacleState: ObstacleWarningState = isWebSerialConnected
    ? isWebSerialFresh && liveDistance !== null
      ? liveDistance <= 300
        ? "OBSTACLE_WARNING"
        : "CLEAR"
      : "SENSOR_UNAVAILABLE"
    : (backendObsState ??
      (hasSensorData && liveDistance !== null
        ? liveDistance <= 300
          ? "OBSTACLE_WARNING"
          : "CLEAR"
        : "SENSOR_UNAVAILABLE"));

  const isObstacleWarning = obstacleState === "OBSTACLE_WARNING";
  const isObstacleClear = obstacleState === "CLEAR";
  const isSensorError = obstacleState === "SENSOR_ERROR";
  const isSensorUnavailable = obstacleState === "SENSOR_UNAVAILABLE";

  const sensorAgeSeconds: number | null = isWebSerialConnected
    ? webSerialAgeSeconds
    : (hw?.ultrasonic?.age_seconds ??
      (hw?.ultrasonic?.timestamp
        ? Math.max(0, (Date.now() - new Date(hw.ultrasonic.timestamp).getTime()) / 1000)
        : null));

  const sensorFreshnessText: string = isSensorUnavailable
    ? (sensorAgeSeconds !== null ? `Stale (${sensorAgeSeconds.toFixed(1)}s ago)` : "Unavailable")
    : isSensorError
      ? "Sensor Error"
      : sensorAgeSeconds !== null
        ? `${sensorAgeSeconds.toFixed(1)}s ago`
        : "Live";

  // Authoritative Threat level matching distance zones (strictly derived from physical distance):
  const sensorLevel = hasSensorData && rawHwThreat
    ? hardwareThreatToUiLevel(rawHwThreat)
    : hasSensorData && liveDistance !== null
      ? classifyDistance(liveDistance)
      : "Normal";

  const level: ThreatLevel = sensorLevel;

  const liveThreatLabel = hasSensorData && rawHwThreat
    ? rawHwThreat
    : hasSensorData && liveDistance !== null
      ? (level === "Collision" ? "CRITICAL" : level === "Alarming" ? "ALARM" : level === "Warning" ? "WARNING" : "NORMAL")
      : NO_DATA_SENTINEL;

  useEffect(() => {
    if (!voiceOn) return;
    if (level !== "Alarming" && level !== "Collision") {
      lastSpokenId.current = null;
      return;
    }
    const alertId = `${currentObject}-${level}`;
    if (lastSpokenId.current === alertId) return;
    lastSpokenId.current = alertId;
    const distText = liveDistance !== null ? `${liveDistance} centimeters` : "caution";
    speak(`Warning: ${currentObject} at ${distText}`);
  }, [currentObject, level, liveDistance, voiceOn]);

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
          {/* --- BLIND'S EYE AI VISION LENS (CAMERA) SECTION --- */}
          <section aria-labelledby="vision-heading">
            <h2 id="vision-heading" className="sr-only">
              Blind's Eye Visual Recognition
            </h2>
            <BlindsEyeLens
              onVisionTelemetry={handleVisionTelemetry}
              onCameraStatusChange={handleCameraStatusChange}
            />
          </section>

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

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${
                    isObstacleWarning
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : isObstacleClear
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : isSensorError
                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
                  }`}
                >
                  <Radio aria-hidden="true" className="size-3.5" />
                  <span>
                    {isObstacleWarning
                      ? "OBSTACLE WARNING"
                      : isObstacleClear
                        ? "PATHWAY CLEAR"
                        : isSensorError
                          ? "SENSOR ERROR"
                          : "SENSOR UNAVAILABLE"}
                  </span>
                  <span className="text-[10px] opacity-75 font-mono">
                    ({sensorFreshnessText})
                  </span>
                </span>
                <span
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-black uppercase tracking-wider border ${
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
                  {hasSensorData ? (
                    level === "Collision" ? (
                      <>
                        <span aria-hidden="true">🔴</span>
                        <span>ALERT (COLLISION)</span>
                      </>
                    ) : level === "Alarming" ? (
                      <>
                        <span aria-hidden="true">🟠</span>
                        <span>ALERT (ALARM)</span>
                      </>
                    ) : level === "Warning" ? (
                      <>
                        <span aria-hidden="true">🟡</span>
                        <span>WARNING</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">🟢</span>
                        <span>NORMAL</span>
                      </>
                    )
                  ) : (
                    <span>⚪ {NO_DATA_SENTINEL}</span>
                  )}
                </span>
              </div>
            </div>

            <div aria-live="polite" className="mt-3 text-base font-semibold">
              {hasSensorData && liveDistance !== null ? (
                liveDistance >= 300 ? (
                  <p className="flex items-center gap-2">
                    <span aria-hidden="true">🟢</span>
                    <span>Clear pathway ahead ({liveDistance} cm) — Normal</span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2">
                    <span aria-hidden="true">
                      {level === "Collision"
                        ? "🔴"
                        : level === "Alarming"
                          ? "🟠"
                          : level === "Warning"
                            ? "🟡"
                            : "🟢"}
                    </span>
                    <span>
                      {currentObject} detected at {liveDistance} cm — {level}
                    </span>
                  </p>
                )
              ) : isWebSerialConnected ? (
                <p className="flex items-center gap-2">
                  <span aria-hidden="true">🟢</span>
                  <span>USB connected — waiting for the first sensor reading…</span>
                </p>
              ) : isLiveVisionActive ? (
                <p className="flex flex-wrap items-center gap-2">
                  <span>{currentObject} detected</span>
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0 text-emerald-400 font-bold underline hover:text-emerald-300 cursor-pointer inline-flex items-center gap-1"
                    onClick={() => void webSerialManager.connect()}
                  >
                    🔌 Click to link USB Glasses (measure distance)
                  </Button>
                </p>
              ) : telemetryQuery.isLoading ? (
                <p>Connecting to the sensor stream…</p>
              ) : (
                <p>No live sensor reading. Your camera / sensor stream is idle.</p>
              )}
            </div>

            <div className="mt-5">
              {telemetryQuery.isLoading && !isLiveVisionActive && !hasSensorData ? (
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
              <div className="flex items-center gap-2">
                {isWebSerialConnected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs px-2.5 font-bold"
                    onClick={() => webSerialManager.disconnect()}
                  >
                    Disconnect USB
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs px-2.5 font-bold flex items-center gap-1 shadow-sm"
                    onClick={() => webSerialManager.connect()}
                    title="Direct in-browser USB connection (Zero Python / Zero Terminal needed)"
                  >
                    🔌 Connect USB Glasses
                  </Button>
                )}
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
                  {systemStatus === "ONLINE" ? (isWebSerialConnected ? "ONLINE (USB)" : "ONLINE") : "NO HARDWARE"}
                </span>
              </div>
            </div>

            <ul className="mt-3 divide-y divide-border/60 text-sm">
              {/* Arduino Serial */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">Arduino Serial</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    arduinoStatus.includes("CONNECTED")
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
                    isObstacleWarning
                      ? "text-amber-400"
                      : isObstacleClear
                        ? "text-emerald-400"
                        : isSensorError
                          ? "text-rose-400"
                          : "text-zinc-400"
                  }`}
                >
                  {isWebSerialConnected
                    ? (webSerialData ? (isObstacleWarning ? "OBSTACLE WARNING (USB)" : "CLEAR (USB)") : "CONNECTED · NO READINGS")
                    : (obstacleState === "OBSTACLE_WARNING"
                        ? "OBSTACLE WARNING"
                        : obstacleState === "CLEAR"
                          ? "CLEAR"
                          : obstacleState === "SENSOR_ERROR"
                            ? "SENSOR ERROR"
                            : "SENSOR UNAVAILABLE")}
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
                  {browserCameraActive
                    ? "ACTIVE (BROWSER)"
                    : cameraStatus === "ACTIVE"
                      ? `ACTIVE (${hw?.camera?.fps?.toFixed(0) ?? 0} FPS)`
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
                  {hw?.ai?.model ? `${hw.ai.model} · ${aiStatus}` : aiStatus}
                </span>
              </li>
              {/* Last Telemetry Sync */}
              <li className="flex items-center justify-between py-2">
                <span className="text-muted-foreground font-medium">Last Telemetry Sync</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {isWebSerialConnected
                    ? webSerialAgeSeconds !== null && isWebSerialFresh
                      ? `${webSerialAgeSeconds.toFixed(1)}s ago`
                      : "No data"
                    : hasSensorData
                      ? `${(Date.now() / 1000 - (hw?.ultrasonic?.timestamp ? new Date(hw.ultrasonic.timestamp).getTime() / 1000 : 0) || 0).toFixed(1)}s ago`
                      : "No data"}
                </span>
              </li>
            </ul>

            {!isWebSerialConnected ? (
              <Button
                size="default"
                className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 py-2.5 rounded-xl cursor-pointer"
                onClick={() => webSerialManager.connect()}
              >
                <span>🔌 Connect USB Glasses</span>
              </Button>
            ) : (
              <Button
                size="default"
                variant="outline"
                className="w-full mt-4 border-rose-500/50 text-rose-400 hover:bg-rose-500/10 font-bold flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer"
                onClick={() => webSerialManager.disconnect()}
              >
                <span>Disconnect USB Glasses</span>
              </Button>
            )}
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
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${threatStyles[t.threat_level].badge}`}
                    >
                      <span aria-hidden="true">
                        {t.threat_level === "Collision"
                          ? "🔴"
                          : t.threat_level === "Alarming"
                            ? "🟠"
                            : t.threat_level === "Warning"
                              ? "🟡"
                              : "🟢"}
                      </span>
                      <span>{t.threat_level}</span>
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
