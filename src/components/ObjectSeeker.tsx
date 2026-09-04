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
    <div className="space-y-6">
      {/* Target Search & Selector */}
      <div className="flex flex-col gap-4">
        <form onSubmit={handleCustomSearch} className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="What item do you need? (e.g. keys, glasses, cane, water bottle)"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="w-full h-12 rounded-2xl border border-border bg-card pl-12 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all"
            />
          </div>
          <Button type="submit" className="h-12 px-6 rounded-2xl font-black text-sm bg-primary hover:bg-primary/90 shadow-xs">
            Seek
          </Button>
        </form>

        {/* Quick Essential Pills */}
        <div className="pt-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/90 mb-2.5">
            Common Essentials:
          </p>
          <div className="flex flex-wrap gap-2.5">
            {COMMON_ESSENTIALS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectPreset(item.id, item.label)}
                className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all cursor-pointer border shadow-xs ${
                  selectedTarget === item.id
                    ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                    : "bg-card/90 border-border/80 text-foreground hover:bg-muted hover:border-primary/40"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Target Radar Status Box */}
      <div
        className={`relative overflow-hidden rounded-3xl border-2 p-5 sm:p-6 transition-all duration-300 ${
          isLocked
            ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_25px_rgba(16,185,129,0.18)]"
            : "border-border/80 bg-surface/70"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex size-13 sm:size-14 items-center justify-center rounded-2xl border transition-colors shadow-xs ${
                isLocked
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 animate-pulse"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}
            >
              {isLocked ? (
                <Crosshair className="size-6 text-emerald-400" />
              ) : (
                <Compass className="size-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h4 className="text-base sm:text-lg font-black text-foreground">
                  Seeking:{" "}
                  <span className="capitalize text-primary">
                    {targetConfig?.label || selectedTarget}
                  </span>
                </h4>
                {isLocked ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black uppercase px-2 py-0.5">
                    Locked On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground uppercase px-2 py-0.5 font-bold">
                    Scanning
                  </Badge>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
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
              variant={sonarEnabled ? "default" : "outline"}
              onClick={() => {
                const next = !sonarEnabled;
                setSonarEnabled(next);
                if (next) playSonarPing(150);
              }}
              className={`h-10 px-4 sm:px-5 rounded-xl gap-2 text-xs sm:text-sm font-bold shadow-xs ${
                sonarEnabled ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-500/20" : ""
              }`}
            >
              {sonarEnabled ? (
                <>
                  <Volume2 className="size-4 text-cyan-200 animate-pulse" />
                  <span>Sonar On</span>
                </>
              ) : (
                <>
                  <VolumeX className="size-4 text-muted-foreground" />
                  <span>Sonar Off</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Directional Walkway Indicator */}
        {isLocked && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-950/25 p-3.5 sm:p-4 text-xs sm:text-sm">
            <div className="flex items-center gap-2.5 font-bold text-emerald-300">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
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
            <span className="font-mono text-xs sm:text-sm font-black text-emerald-400">
              {distanceCm ? `${distanceCm} cm` : "IN VIEW"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
