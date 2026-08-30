import { CAMERA_STREAM_URL_KEY } from "@/components/CameraFeed";
import type { ThreatLevel } from "@/lib/netrasense";

export const SENSOR_SERVER_URL_KEY = "netrasense:sensorServerUrl";

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

type SensorApiResponse = {
  sensor_data: SensorReading | null;
  sensor_status: SensorStatus;
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
