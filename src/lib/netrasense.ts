import type { Database } from "@/integrations/supabase/types";

export type ThreatLevel = Database["public"]["Enums"]["threat_level"];
export type ImpairmentLevel = Database["public"]["Enums"]["impairment_level"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Contact = Database["public"]["Tables"]["emergency_contacts"]["Row"];
export type Telemetry = Database["public"]["Tables"]["telemetry_stream"]["Row"];
export type DailyStats = Database["public"]["Tables"]["daily_stats"]["Row"];

export const THREAT_LEVELS: ThreatLevel[] = ["Normal", "Warning", "Alarming", "Collision"];

/** Sentinel values for when hardware is disconnected / no data available. */
export const NO_DATA_SENTINEL = "NO DATA" as const;
export const NOT_ACTIVE_SENTINEL = "NOT ACTIVE" as const;
export const DISCONNECTED_SENTINEL = "DISCONNECTED" as const;
export const NOT_READY_SENTINEL = "NOT READY" as const;
export const NO_HARDWARE_SENTINEL = "NO HARDWARE" as const;

/** Distance value shown when sensor is unavailable. */
export const NO_DISTANCE_PLACEHOLDER = "--";

export const IMPAIRMENT_LEVELS: ImpairmentLevel[] = ["Partial", "Legal Blindness", "Total"];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const MAX_DISTANCE_CM = 400;

/** Semantic token classes per threat level (never hardcode colors in components). */
export const threatStyles: Record<
  ThreatLevel,
  { badge: string; text: string; bar: string; ring: string }
> = {
  Normal: {
    badge: "bg-normal text-normal-foreground",
    text: "text-normal",
    bar: "bg-normal",
    ring: "stroke-normal",
  },
  Warning: {
    badge: "bg-warning text-warning-foreground",
    text: "text-warning",
    bar: "bg-warning",
    ring: "stroke-warning",
  },
  Alarming: {
    badge: "bg-alarming text-alarming-foreground",
    text: "text-alarming",
    bar: "bg-alarming",
    ring: "stroke-alarming",
  },
  Collision: {
    badge: "bg-collision text-collision-foreground",
    text: "text-collision",
    bar: "bg-collision",
    ring: "stroke-collision",
  },
};

export function classifyDistance(distanceCm: number): ThreatLevel {
  if (distanceCm <= 40) return "Collision";
  if (distanceCm <= 100) return "Alarming";
  if (distanceCm <= 200) return "Warning";
  return "Normal";
}

export function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export const DETECTED_OBJECTS = [
  "Moving Vehicle",
  "Stairs",
  "Pole",
  "Pedestrian",
  "Low Wall",
  "Open Door",
  "Kerb Edge",
  "Parked Bicycle",
];

export function toCsv(rows: Telemetry[]): string {
  const header = ["Timestamp", "Detected Object", "Distance (cm)", "Threat Level", "Action Taken"];
  const body = rows.map((r) =>
    [
      new Date(r.created_at).toISOString(),
      r.detected_object,
      String(r.distance_cm),
      r.threat_level,
      r.action_taken ?? "Logged",
    ]
      .map((cell) => `"${cell.replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}
