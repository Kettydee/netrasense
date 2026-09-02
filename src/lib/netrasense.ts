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

export const AI_VOICE_STORAGE_KEY = "netrasense:ai_voice";

export interface AiVoiceProfile {
  id: string;
  name: string;
  description: string;
  gender: "female" | "male";
  pitch: number;
  rate: number;
}

export const AI_VOICE_PROFILES: AiVoiceProfile[] = [
  { id: "nova", name: "Nova", description: "Natural Female (US)", gender: "female", pitch: 1.05, rate: 1.05 },
  { id: "echo", name: "Echo", description: "Natural Male (US)", gender: "male", pitch: 0.95, rate: 1.02 },
  { id: "aria", name: "Aria", description: "Expressive & Clear (UK)", gender: "female", pitch: 1.25, rate: 1.05 },
  { id: "onyx", name: "Onyx", description: "Deep & Authoritative", gender: "male", pitch: 0.72, rate: 0.92 },
  { id: "swara", name: "Swara", description: "Hindi & Indian Voice (हिन्दी)", gender: "female", pitch: 1.0, rate: 1.0 },
  { id: "fable", name: "Fable", description: "Warm Storyteller", gender: "female", pitch: 0.88, rate: 0.92 },
  { id: "shimmer", name: "Shimmer", description: "Bright & Energetic", gender: "female", pitch: 1.35, rate: 1.15 },
];

// In-memory voices cache for reliable access across browser async lifecycles
let cachedSpeechVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  cachedSpeechVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedSpeechVoices = window.speechSynthesis.getVoices();
  };
}

export function speak(text: string, overrideVoiceId?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const utterance = new SpeechSynthesisUtterance(text);
  const savedVoiceId = overrideVoiceId || window.localStorage.getItem(AI_VOICE_STORAGE_KEY) || "nova";
  const profile = AI_VOICE_PROFILES.find((p) => p.id === savedVoiceId);

  // Retrieve current or cached voices
  let voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) {
    voices = cachedSpeechVoices;
  }

  const hasHindiScript = /[\u0900-\u097F]/.test(text);
  let matchedVoice: SpeechSynthesisVoice | null = null;

  if (profile) {
    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;

    if (voices.length > 0) {
      if (profile.id === "swara" || hasHindiScript) {
        // Find Hindi (hi-IN) or Indian English (en-IN) voice
        matchedVoice =
          voices.find((v) => v.lang.startsWith("hi") || /hindi|हिन्दी|swara|madhur|lekha/i.test(v.name)) ||
          voices.find((v) => v.lang === "en-IN" || /neerja|heera|rishi/i.test(v.name)) ||
          null;
      } else if (profile.id === "aria") {
        // Expressive British / UK voice
        matchedVoice =
          voices.find((v) => /uk english female|hazel|stephanie|serena|victoria/i.test(v.name)) ||
          voices.find((v) => v.lang.startsWith("en-GB") && !/male|george/i.test(v.name)) ||
          null;
      } else if (profile.id === "onyx") {
        // Deep resonant male voice
        matchedVoice =
          voices.find((v) => /daniel|oliver|george|david/i.test(v.name)) ||
          voices.find((v) => /male/i.test(v.name)) ||
          null;
      } else if (profile.id === "echo") {
        // Standard clear male voice
        matchedVoice =
          voices.find((v) => /guy|david|alex|mark|google.*us.*male/i.test(v.name)) ||
          voices.find((v) => /male/i.test(v.name)) ||
          null;
      } else if (profile.id === "fable") {
        // Warm storytelling voice
        matchedVoice =
          voices.find((v) => /karen|catherine|moira|fiona/i.test(v.name)) ||
          null;
      } else if (profile.id === "shimmer") {
        // Bright energetic female voice
        matchedVoice =
          voices.find((v) => /stephanie|zira|samantha/i.test(v.name)) ||
          null;
      } else {
        // Nova (Standard natural female voice)
        matchedVoice =
          voices.find((v) => /jenny|samantha|zira|google.*us.*female/i.test(v.name)) ||
          voices.find((v) => !/male|david|mark|alex|george/i.test(v.name) && v.lang.startsWith("en")) ||
          null;
      }
    }
  } else {
    // User picked a specific device-native voice by name or voiceURI
    matchedVoice = voices.find((v) => v.name === savedVoiceId || v.voiceURI === savedVoiceId) || null;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
  }

  if (matchedVoice) {
    utterance.voice = matchedVoice;
    utterance.lang = matchedVoice.lang;
  } else if (hasHindiScript) {
    utterance.lang = "hi-IN";
  }

  // Cancel any ongoing speech and use a brief timeout to allow audio channels to reset
  window.speechSynthesis.cancel();
  setTimeout(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.speak(utterance);
    }
  }, 25);
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
