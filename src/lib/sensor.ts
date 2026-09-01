import { CAMERA_STREAM_URL_KEY } from "@/components/CameraFeed";
import type { ThreatLevel } from "@/lib/netrasense";

export const SENSOR_SERVER_URL_KEY = "netrasense:sensorServerUrl";

// ── Heartbeat timeout must match the Python backend constant ──────────
export const SENSOR_HEARTBEAT_TIMEOUT_S = 3;

export type HardwareThreatLevel = "NORMAL" | "WARNING" | "ALARM" | "CRITICAL";

export type SensorReading = {
  distance_cm: number;
  timestamp: string;
  device_id: string;
  threat_level: HardwareThreatLevel;
  processing_latency_ms?: number;
};

export type SensorStatus = {
  connected: boolean;
  port: string | null;
  last_error: string | null;
};

// ── New authoritative hardware status types ────────────────────────────

export type ArduinoStatus = {
  connected: boolean;
  port: string | null;
  last_error: string | null;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  last_update: number;
  total_readings: number;
};

export type UltrasonicStatus = {
  active: boolean;
  distance_cm: number | null;
  threat_level: HardwareThreatLevel | null;
  device_id: string | null;
  timestamp: string | null;
  status: "ACTIVE" | "NOT ACTIVE";
};

export type CameraHwStatus = {
  connected: boolean;
  fps: number;
  source: string | null;
  last_frame_timestamp: number | null;
  last_error: string | null;
  status: "ACTIVE" | "DISCONNECTED" | "ERROR";
};

export type AiStatus = {
  loaded: boolean;
  processing: boolean;
  model: string | null;
  status: "NOT READY" | "READY" | "READY (no camera)" | "PROCESSING";
};

export type SystemStatus = {
  status: "ONLINE" | "NO HARDWARE";
  sensor_heartbeat_timeout_s: number;
};

export type HardwareStatus = {
  system: SystemStatus;
  arduino: ArduinoStatus;
  ultrasonic: UltrasonicStatus;
  camera: CameraHwStatus;
  ai: AiStatus;
};

export type SignalBreakdown = {
  distance_cm: number | null;
  threat_level: HardwareThreatLevel | null;
};

export type EnsembleBreakdown = {
  fused_distance_cm: number | null;
  fused_threat_level: HardwareThreatLevel | "NO DATA";
  confidence: number;
  signal_count: number;
  ultrasonic: SignalBreakdown;
  yolo: SignalBreakdown;
  depth: SignalBreakdown;
};

type SensorApiResponse = {
  sensor_data: SensorReading | null;
  sensor_status: SensorStatus;
  hardware_status?: HardwareStatus;
  ensemble?: EnsembleBreakdown;
};

const DEFAULT_SENSOR_SERVER_URL = "http://localhost:5000";

/** Map the hardware's Phase 2 names onto the dashboard's existing visual tokens. */
export function hardwareThreatToUiLevel(level: HardwareThreatLevel): ThreatLevel {
  const map: Record<HardwareThreatLevel, ThreatLevel> = {
    NORMAL: "Normal",
    WARNING: "Warning",
    ALARM: "Alarming",
    CRITICAL: "Collision",
  };
  return map[level] ?? "Normal";
}

export function resolveSensorServerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SENSOR_SERVER_URL;

  const configured = window.localStorage.getItem(SENSOR_SERVER_URL_KEY)?.trim();
  if (configured) return configured.replace(/\/$/, "");

  // Reuse the configured YOLO server when its stream URL points to the same Python service.
  const cameraUrl = window.localStorage.getItem(CAMERA_STREAM_URL_KEY)?.trim();
  if (cameraUrl) {
    try {
      const { origin } = new URL(cameraUrl);
      return origin;
    } catch {
      // A malformed camera URL should not stop sensor fallback discovery.
    }
  }

  return DEFAULT_SENSOR_SERVER_URL;
}

export async function fetchSensorTelemetry(): Promise<SensorApiResponse> {
  const response = await fetch(`${resolveSensorServerUrl()}/api/latest`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Sensor service is unavailable");
  return (await response.json()) as SensorApiResponse;
}

/**
 * Fetch ONLY the hardware status object.  Useful for lightweight polls
 * that don't need the full detection payload.
 */
export async function fetchHardwareStatus(): Promise<HardwareStatus> {
  // Prefer the dedicated endpoint if available; fall back to /api/latest.
  try {
    const res = await fetch(`${resolveSensorServerUrl()}/api/hardware-status`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as HardwareStatus;
  } catch {
    // Fall through to /api/latest
  }

  const res = await fetch(`${resolveSensorServerUrl()}/api/latest`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Sensor service is unavailable");
  const data = (await res.json()) as SensorApiResponse;
  if (data.hardware_status) return data.hardware_status;

  // Very old server — fabricate a minimal status from the flat fields.
  return {
    system: { status: "NO HARDWARE", sensor_heartbeat_timeout_s: SENSOR_HEARTBEAT_TIMEOUT_S },
    arduino: {
      connected: data.sensor_status.connected,
      port: data.sensor_status.port,
      last_error: data.sensor_status.last_error,
      status: data.sensor_status.connected ? "CONNECTED" : "DISCONNECTED",
      last_update: 0,
      total_readings: 0,
    },
    ultrasonic: {
      active: !!data.sensor_data,
      distance_cm: data.sensor_data?.distance_cm ?? null,
      threat_level: data.sensor_data?.threat_level ?? null,
      device_id: data.sensor_data?.device_id ?? null,
      timestamp: data.sensor_data?.timestamp ?? null,
      status: data.sensor_data ? "ACTIVE" : "NOT ACTIVE",
    },
    camera: { connected: false, fps: 0, source: null, last_frame_timestamp: null, last_error: null, status: "DISCONNECTED" },
    ai: { loaded: false, processing: false, model: null, status: "NOT READY" },
  };
}
