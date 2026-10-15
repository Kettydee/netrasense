import { useState } from "react";
import {
  Compass,
  Sparkles,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function ObjectSeeker({ currentDetections = [], isCameraActive = true }: ObjectSeekerProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>("cell phone");
  const [customInput, setCustomInput] = useState<string>("");

  // Check if selected target matches any current detection
  const targetConfig = COMMON_ESSENTIALS.find((e) => e.id === selectedTarget);
  const matchWords = targetConfig ? targetConfig.matchWords : [selectedTarget.toLowerCase().trim()];

  const matchedDetection = currentDetections.find((d) => {
    const lowerLabel = d.label.toLowerCase();
    return matchWords.some((word) => lowerLabel.includes(word));
  });

  const handleSelectPreset = (id: string, label: string) => {
    setSelectedTarget(id);
    setCustomInput("");
    playSonarPing();
  };

  const handleCustomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    setSelectedTarget(customInput.trim().toLowerCase());
    playSonarPing();
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
              placeholder="What item do you need? (e.g. keys, cane, water bottle)"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="w-full h-12 rounded-2xl border border-border bg-card pl-12 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-all"
            />
          </div>
          <Button
            type="submit"
            className="h-12 px-6 rounded-2xl font-black text-sm bg-primary hover:bg-primary/90 shadow-xs"
          >
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

      {/* Live Target Status Box */}
      <div
        className={`relative overflow-hidden rounded-3xl border-2 p-5 sm:p-6 transition-all duration-300 ${
          matchedDetection
            ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_25px_rgba(16,185,129,0.18)]"
            : "border-border/80 bg-surface/70"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex size-13 sm:size-14 items-center justify-center rounded-2xl border transition-colors shadow-xs ${
                matchedDetection
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 animate-pulse"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}
            >
              {matchedDetection ? (
                <Sparkles className="size-6 text-emerald-400" />
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
                {matchedDetection ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-black uppercase">
                    Locked On
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
                    Scanning room
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Point camera slowly around the room to locate item
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
