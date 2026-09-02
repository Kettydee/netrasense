import { useState, useEffect, useRef, useCallback } from "react";
import {
  Compass,
  Crosshair,
  Volume2,
  VolumeX,
  Search,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { speak } from "@/lib/netrasense";
import { SonarTracker, playSonarPing } from "@/lib/audioSonar";

interface ObjectDetectionItem {
  label: string;
  direction?: "left" | "center" | "right" | string;
  distance_cm?: number;
}

interface ObjectSeekerProps {
  currentDetections?: ObjectDetectionItem[];
  isCameraActive?: boolean;
}

const COMMON_ESSENTIALS = [
  { id: "bottle", label: "Water Bottle", matchWords: ["bottle", "cup", "can"] },
  { id: "cell phone", label: "Phone", matchWords: ["cell phone", "phone", "mobile"] },
  { id: "chair", label: "Chair", matchWords: ["chair", "couch", "seat"] },
  { id: "cup", label: "Mug / Cup", matchWords: ["cup", "mug", "bowl"] },
  { id: "laptop", label: "Laptop", matchWords: ["laptop", "keyboard", "tv"] },
  { id: "backpack", label: "Bag / Backpack", matchWords: ["backpack", "handbag", "suitcase"] },
  { id: "book", label: "Book / Paper", matchWords: ["book", "paper", "document"] },
];

export function ObjectSeeker({
  currentDetections = [],
  isCameraActive = true,
}: ObjectSeekerProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>("cell phone");
  const [customInput, setCustomInput] = useState<string>("");
  const [sonarEnabled, setSonarEnabled] = useState<boolean>(true);
  const [lastGuidanceTime, setLastGuidanceTime] = useState<number>(0);
  const [lastSpokenDirection, setLastSpokenDirection] = useState<string>("");

  const sonarTrackerRef = useRef<SonarTracker | null>(null);

  // Initialize sonar tracker
  useEffect(() => {
    const tracker = new SonarTracker();
    sonarTrackerRef.current = tracker;

    return () => {
      tracker.stop();
    };
  }, []);

  // Check if selected target matches any current detection
  const targetConfig = COMMON_ESSENTIALS.find((e) => e.id === selectedTarget);
  const matchWords = targetConfig
    ? targetConfig.matchWords
    : [selectedTarget.toLowerCase().trim()];

  const matchedDetection = currentDetections.find((d) => {
    const lowerLabel = d.label.toLowerCase();
    return matchWords.some((word) => lowerLabel.includes(word));
  });

  // Calculate live distance and direction
  const isLocked = !!matchedDetection;
  const distanceCm = matchedDetection?.distance_cm ?? (isLocked ? 120 : null);
  const direction = matchedDetection?.direction || "center";

  // Manage Sonar tracker
  useEffect(() => {
    if (!sonarTrackerRef.current) return;

    if (sonarEnabled && isCameraActive && isLocked && distanceCm !== null) {
      sonarTrackerRef.current.updateDistance(distanceCm);
      sonarTrackerRef.current.start(() => (isLocked ? distanceCm : null));
    } else {
      sonarTrackerRef.current.stop();
    }
  }, [sonarEnabled, isCameraActive, isLocked, distanceCm]);

  // Directional Voice Guidance Loop
  useEffect(() => {
    if (!isCameraActive || !selectedTarget) return;

    const now = Date.now();
    // Speak guidance every 3.5 seconds or when state changes
    if (now - lastGuidanceTime < 3500) return;

    const targetLabel = targetConfig?.label || selectedTarget;

    if (isLocked) {
      let prompt = "";
      if (distanceCm && distanceCm <= 45) {
        prompt = `${targetLabel} is within reach directly in front of you!`;
      } else if (direction === "left") {
        prompt = `Turn slightly left. ${targetLabel} is ${distanceCm ? Math.round(distanceCm / 100 * 10) / 10 + " meters" : "ahead"}.`;
      } else if (direction === "right") {
        prompt = `Turn slightly right. ${targetLabel} is ${distanceCm ? Math.round(distanceCm / 100 * 10) / 10 + " meters" : "ahead"}.`;
      } else {
        prompt = `${targetLabel} straight ahead. Walk forward carefully.`;
      }

      if (prompt !== lastSpokenDirection) {
        speak(prompt);
        setLastSpokenDirection(prompt);
        setLastGuidanceTime(now);
      }
    }
  }, [
    isLocked,
    direction,
    distanceCm,
    selectedTarget,
    isCameraActive,
    lastGuidanceTime,
    lastSpokenDirection,
    targetConfig,
  ]);

  const handleSelectPreset = (id: string, label: string) => {
    setSelectedTarget(id);
    setCustomInput("");
    speak(`Seeking ${label}. Scanning room.`);
    playSonarPing(200);
  };

  const handleCustomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    setSelectedTarget(customInput.trim().toLowerCase());
    speak(`Seeking ${customInput.trim()}. Point camera to search.`);
    playSonarPing(200);
  };

  return (
    <div className="space-y-4">
      {/* Target Search & Selector */}
      <div className="flex flex-col gap-3">
        <form onSubmit={handleCustomSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="What item do you need? (e.g. keys, glasses, cane)"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="w-full rounded-xl border border-border bg-card pl-9 pr-3 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Button type="submit" size="sm" className="font-bold text-xs">
            Seek
          </Button>
        </form>

        {/* Quick Essential Pills */}
        <div className="flex flex-wrap gap-1.5">
          {COMMON_ESSENTIALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectPreset(item.id, item.label)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                selectedTarget === item.id
                  ? "bg-primary text-primary-foreground shadow-xs scale-105"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Target Radar Status Box */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
          isLocked
            ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
            : "border-border/80 bg-surface/60"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex size-10 items-center justify-center rounded-xl border transition-colors ${
                isLocked
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 animate-pulse"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}
            >
              {isLocked ? (
                <Crosshair className="size-5 text-emerald-400" />
              ) : (
                <Compass className="size-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-extrabold text-foreground">
                  Seeking:{" "}
                  <span className="capitalize text-primary">
                    {targetConfig?.label || selectedTarget}
                  </span>
                </h4>
                {isLocked ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-black uppercase">
                    Locked On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground uppercase">
                    Scanning
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLocked
                  ? `Target positioned ${direction.toUpperCase()} · ~${distanceCm ?? 100} cm away`
                  : "Point camera slowly around the room to locate item"}
              </p>
            </div>
          </div>

          {/* Sonar Audio Toggle */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={sonarEnabled ? "default" : "outline"}
              onClick={() => {
                const next = !sonarEnabled;
                setSonarEnabled(next);
                if (next) playSonarPing(150);
              }}
              className={`h-8 gap-1.5 text-xs font-bold ${
                sonarEnabled ? "bg-cyan-600 hover:bg-cyan-500 text-white" : ""
              }`}
            >
              {sonarEnabled ? (
                <>
                  <Volume2 className="size-3.5 text-cyan-200 animate-pulse" />
                  <span>Sonar On</span>
                </>
              ) : (
                <>
                  <VolumeX className="size-3.5 text-muted-foreground" />
                  <span>Sonar Off</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Directional Walkway Indicator */}
        {isLocked && (
          <div className="mt-3.5 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-xs">
            <div className="flex items-center gap-2 font-bold text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              <span>
                {distanceCm && distanceCm <= 45
                  ? "Reaching distance! Item is right in front of you."
                  : direction === "center"
                    ? "Walk straight ahead carefully."
                    : direction === "left"
                      ? "Turn slightly left to face the target."
                      : "Turn slightly right to face the target."}
              </span>
            </div>
            <span className="font-mono text-xs font-black text-emerald-400">
              {distanceCm ? `${distanceCm} cm` : "IN VIEW"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
