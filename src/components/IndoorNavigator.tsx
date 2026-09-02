import { useState, useCallback } from "react";
import {
  Navigation,
  Footprints,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  DoorOpen,
  Coffee,
  Bath,
  Armchair,
  Briefcase,
  Flag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { navigateIndoorPath, type IndoorNavResult } from "@/lib/aiVision";
import { speak } from "@/lib/netrasense";

const DESTINATIONS = [
  { id: "door", label: "Exit Door", icon: DoorOpen },
  { id: "kitchen", label: "Kitchen / Water", icon: Coffee },
  { id: "bathroom", label: "Bathroom", icon: Bath },
  { id: "desk", label: "Desk / Workspace", icon: Briefcase },
  { id: "chair", label: "Chair / Seating", icon: Armchair },
];

interface IndoorNavigatorProps {
  getFrameBase64: () => string | null;
}

export function IndoorNavigator({ getFrameBase64 }: IndoorNavigatorProps) {
  const [destination, setDestination] = useState<string>("Exit Door");
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [navResult, setNavResult] = useState<IndoorNavResult | null>(null);

  const executeNavStep = useCallback(
    async (stepNum: number) => {
      const frame = getFrameBase64();
      if (!frame) {
        toast.error("Camera is not active. Please start camera first.");
        speak("Camera is not active. Please start camera first.");
        return;
      }

      setIsAnalyzing(true);
      speak(`Checking path to ${destination}, step ${stepNum}...`);

      try {
        const result = await navigateIndoorPath(frame, destination, stepNum);
        setNavResult(result);
        speak(result.instruction);
        toast.success(`Waypoint step ${stepNum} updated!`);
      } catch (err) {
        console.error(err);
        toast.error("Could not verify waypoint.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [getFrameBase64, destination]
  );

  const startNavigation = (destLabel: string) => {
    setDestination(destLabel);
    setCurrentStep(1);
    setIsNavigating(true);
    setNavResult(null);
    speak(`Starting indoor navigation to ${destLabel}. Analyzing first step.`);
    executeNavStep(1);
  };

  const handleNextStep = () => {
    const next = currentStep + 1;
    setCurrentStep(next);
    executeNavStep(next);
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    setNavResult(null);
    setCurrentStep(1);
    speak("Indoor navigation ended.");
    toast.info("Navigation stopped.");
  };

  return (
    <div className="space-y-4">
      {/* Destination Picker */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-extrabold text-foreground flex items-center gap-1.5">
            <Navigation className="size-4 text-sky-400" />
            Indoor Landmark Pathfinder
          </h4>
          {isNavigating && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStopNavigation}
              className="h-7 text-xs font-bold text-rose-400 hover:text-rose-500"
            >
              End Trip
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {DESTINATIONS.map((dest) => {
            const Icon = dest.icon;
            const isSelected = destination === dest.label;
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => startNavigation(dest.label)}
                disabled={isAnalyzing}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  isSelected && isNavigating
                    ? "bg-sky-500 text-slate-950 shadow-sm scale-105"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="size-3.5" />
                <span>{dest.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Navigation Card */}
      {isNavigating && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-500/20 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 font-black text-xs border border-sky-500/30">
                #{currentStep}
              </div>
              <div>
                <span className="text-xs font-extrabold text-foreground">
                  Navigating to: <span className="text-sky-400">{destination}</span>
                </span>
                <p className="text-[11px] text-muted-foreground">Turn-by-turn waypoint guidance</p>
              </div>
            </div>

            {navResult && (
              <Badge
                className={`text-[10px] font-black uppercase tracking-wider ${
                  navResult.clearanceStatus === "Safe"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : navResult.clearanceStatus === "Caution"
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                }`}
              >
                Clearance: {navResult.clearanceStatus}
              </Badge>
            )}
          </div>

          {/* Current Step Guidance */}
          <div className="mt-3.5">
            {navResult ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-card p-3">
                  <Footprints className="size-5 shrink-0 text-sky-400 mt-0.5" />
                  <div>
                    <span className="text-xs font-extrabold text-sky-400 uppercase tracking-wider">
                      Current Action
                    </span>
                    <p className="text-sm font-bold text-foreground mt-0.5 leading-snug">
                      &ldquo;{navResult.instruction}&rdquo;
                    </p>
                  </div>
                </div>

                {navResult.isArrived ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-emerald-400 font-bold text-xs">
                    <Flag className="size-4 shrink-0" />
                    <span>Destination reached! You have arrived safely at {destination}.</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleNextStep}
                      disabled={isAnalyzing}
                      className="gap-2 font-bold text-xs bg-sky-500 hover:bg-sky-600 text-slate-950 shadow-md"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Checking Pathway...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5" />
                          <span>Am I on track? / Next Step</span>
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => executeNavStep(currentStep)}
                      className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
                    >
                      <RefreshCw className="size-3" /> Re-scan Step
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 text-center text-xs text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin text-sky-400" />
                <span>Scanning room layout and landmarks...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
