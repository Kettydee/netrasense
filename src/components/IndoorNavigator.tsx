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
    <div className="space-y-6">
      {/* Destination Picker */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base sm:text-lg font-black text-foreground flex items-center gap-2">
              <Navigation className="size-5 text-sky-400" />
              Indoor Landmark Pathfinder
            </h4>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Select an indoor destination for turn-by-turn waypoint walking directions.
            </p>
          </div>
          {isNavigating && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStopNavigation}
              className="h-8 px-3 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-500"
            >
              End Trip
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5 pt-1">
          {DESTINATIONS.map((dest) => {
            const Icon = dest.icon;
            const isSelected = destination === dest.label;
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => startNavigation(dest.label)}
                disabled={isAnalyzing}
                className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all cursor-pointer border shadow-xs ${
                  isSelected && isNavigating
                    ? "bg-sky-500 text-slate-950 border-sky-400 shadow-md scale-[1.02]"
                    : "bg-card/90 border-border/80 text-foreground hover:bg-muted hover:border-sky-400/40"
                }`}
              >
                <Icon className="size-4" />
                <span>{dest.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Navigation Card */}
      {isNavigating && (
        <div className="rounded-3xl border-2 border-sky-500/30 bg-sky-500/5 p-5 sm:p-6 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sky-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 font-black text-sm border border-sky-500/30 shadow-xs">
                #{currentStep}
              </div>
              <div>
                <span className="text-sm sm:text-base font-black text-foreground">
                  Navigating to: <span className="text-sky-400">{destination}</span>
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">Turn-by-turn waypoint guidance</p>
              </div>
            </div>

            {navResult && (
              <Badge
                className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 ${
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
          <div className="mt-4">
            {navResult ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3.5 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-xs">
                  <Footprints className="size-6 shrink-0 text-sky-400 mt-0.5" />
                  <div>
                    <span className="text-xs font-black text-sky-400 uppercase tracking-wider">
                      Current Action
                    </span>
                    <p className="text-sm sm:text-base font-bold text-foreground mt-1 leading-snug">
                      &ldquo;{navResult.instruction}&rdquo;
                    </p>
                  </div>
                </div>

                {navResult.isArrived ? (
                  <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-emerald-400 font-bold text-sm">
                    <Flag className="size-5 shrink-0" />
                    <span>Destination reached! You have arrived safely at {destination}.</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <Button
                      type="button"
                      onClick={handleNextStep}
                      disabled={isAnalyzing}
                      className="h-11 px-5 rounded-2xl gap-2 font-black text-xs sm:text-sm bg-sky-500 hover:bg-sky-600 text-slate-950 shadow-sm transition-all"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>Checking Pathway...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-4" />
                          <span>Am I on track? / Next Step</span>
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => executeNavStep(currentStep)}
                      className="h-10 px-3.5 rounded-xl text-xs sm:text-sm text-muted-foreground hover:text-foreground gap-2 font-semibold"
                    >
                      <RefreshCw className="size-3.5" /> Re-scan Step
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-center text-xs sm:text-sm text-muted-foreground gap-2.5">
                <Loader2 className="size-5 animate-spin text-sky-400" />
                <span>Scanning room layout and landmarks...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
