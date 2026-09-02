import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles,
  Compass,
  Smile,
  Navigation,
  Eye,
  Banknote,
  Mic,
  MicOff,
  Loader2,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ObjectSeeker } from "@/components/ObjectSeeker";
import { FaceMoodIdentifier } from "@/components/FaceMoodIdentifier";
import { IndoorNavigator } from "@/components/IndoorNavigator";
import { describeSurroundings, readCurrencyAndText } from "@/lib/aiVision";
import { speak } from "@/lib/netrasense";

interface SmartAssistiveSuiteProps {
  getFrameBase64: () => string | null;
  detectedObjects?: string[];
  detections?: Array<{
    label: string;
    direction?: string;
    distance_cm?: number;
  }>;
  className?: string;
}

type TabType = "seek" | "face" | "nav" | "scene";

export function SmartAssistiveSuite({
  getFrameBase64,
  detectedObjects = [],
  detections = [],
  className = "",
}: SmartAssistiveSuiteProps) {
  const [activeTab, setActiveTab] = useState<TabType>("seek");

  // Scene & Currency Reader State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeAction, setActiveAction] = useState<"scene" | "currency" | null>(null);
  const [currentResultText, setCurrentResultText] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);

  // Describe Surroundings
  const handleDescribeScene = useCallback(async () => {
    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Camera is not active. Please start camera first.");
      speak("Camera is not active. Please open camera first.");
      return;
    }

    setIsProcessing(true);
    setActiveAction("scene");
    toast.info("Analyzing room layout...");
    speak("Scanning surroundings...");

    try {
      const result = await describeSurroundings(frame, undefined, detectedObjects, "auto");
      setCurrentResultText(result.summary);
      speak(result.summary);
      toast.success("Scene described!");
    } catch (err) {
      console.error("Describe surroundings error:", err);
      toast.error("Failed to describe scene.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  }, [getFrameBase64, detectedObjects]);

  // Read Currency / Text
  const handleReadCurrency = useCallback(async () => {
    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Camera is not active. Please start camera first.");
      speak("Camera is not active. Please open camera first.");
      return;
    }

    setIsProcessing(true);
    setActiveAction("currency");
    toast.info("Scanning for cash & text...");
    speak("Reading currency and text...");

    try {
      const result = await readCurrencyAndText(frame, undefined, "auto");
      setCurrentResultText(result.speech);
      speak(result.speech);
      toast.success("Readout complete!");
    } catch (err) {
      console.error("Currency reader error:", err);
      toast.error("Failed to read document.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  }, [getFrameBase64]);

  // Speech Recognition for Hands-Free Control
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onresult = (event: any) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.toLowerCase().trim();

      if (
        transcript.includes("find") ||
        transcript.includes("seek") ||
        transcript.includes("object")
      ) {
        setActiveTab("seek");
        speak("Switched to Object Seeker.");
      } else if (
        transcript.includes("who") ||
        transcript.includes("face") ||
        transcript.includes("mood")
      ) {
        setActiveTab("face");
        speak("Switched to Face and Mood Identifier.");
      } else if (
        transcript.includes("navigate") ||
        transcript.includes("path") ||
        transcript.includes("door")
      ) {
        setActiveTab("nav");
        speak("Switched to Indoor Navigator.");
      } else if (
        transcript.includes("describe") ||
        transcript.includes("around") ||
        transcript.includes("aas paas")
      ) {
        setActiveTab("scene");
        handleDescribeScene();
      } else if (
        transcript.includes("currency") ||
        transcript.includes("money") ||
        transcript.includes("paise") ||
        transcript.includes("read")
      ) {
        setActiveTab("scene");
        handleReadCurrency();
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isListening) {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, [isListening, handleDescribeScene, handleReadCurrency]);

  const toggleVoiceCommands = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition not supported on this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      toast.info("Voice commands deactivated");
      speak("Voice commands deactivated.");
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        toast.success("Voice commands active! Say 'Find bottle', 'Who is in front', or 'Describe scene'");
        speak("Voice commands activated.");
      } catch {
        toast.error("Could not start voice recognition.");
      }
    }
  };

  // Convert string detections into object format if needed
  const normalizedDetections = detections.length > 0
    ? detections
    : detectedObjects.map((text) => {
        let direction = "center";
        if (text.toLowerCase().includes("left")) direction = "left";
        if (text.toLowerCase().includes("right")) direction = "right";
        return {
          label: text.replace(/\s+on\s+(left|center|right)/i, "").trim(),
          direction,
          distance_cm: 120,
        };
      });

  return (
    <div className={`mt-4 rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-sm ${className}`}>
      {/* Header with Title & Hands-Free Mic */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <Sparkles className="size-4.5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold tracking-tight text-foreground sm:text-base">
              Assistive Copilot Suite
            </h3>
            <p className="text-xs text-muted-foreground">
              Spatial Object Seeker, Face Emotion, Indoor Nav & Scene Reader
            </p>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant={isListening ? "default" : "outline"}
          onClick={toggleVoiceCommands}
          className={`h-8 gap-1.5 text-xs font-bold ${
            isListening ? "bg-emerald-600 text-white shadow-emerald-500/30 animate-pulse" : ""
          }`}
          aria-label={isListening ? "Voice commands active" : "Enable voice commands"}
        >
          {isListening ? (
            <>
              <Mic className="size-3.5" />
              <span>Listening...</span>
            </>
          ) : (
            <>
              <MicOff className="size-3.5 text-muted-foreground" />
              <span>Voice Control</span>
            </>
          )}
        </Button>
      </div>

      {/* Navigation Tab Bar */}
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("seek")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === "seek"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Compass className="size-3.5" />
          <span>Find Object (Sonar)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("face")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === "face"
              ? "bg-amber-500 text-slate-950 shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Smile className="size-3.5" />
          <span>Face & Mood</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("nav")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === "nav"
              ? "bg-sky-500 text-slate-950 shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Navigation className="size-3.5" />
          <span>Indoor Navigator</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("scene")}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === "scene"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Eye className="size-3.5" />
          <span>Scene & Currency</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="mt-3.5">
        {/* TAB 1: FIND OBJECT (SONAR) */}
        {activeTab === "seek" && (
          <ObjectSeeker currentDetections={normalizedDetections} isCameraActive={true} />
        )}

        {/* TAB 2: FACE & MOOD */}
        {activeTab === "face" && <FaceMoodIdentifier getFrameBase64={getFrameBase64} />}

        {/* TAB 3: INDOOR NAV */}
        {activeTab === "nav" && <IndoorNavigator getFrameBase64={getFrameBase64} />}

        {/* TAB 4: SCENE & CURRENCY READER */}
        {activeTab === "scene" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleDescribeScene}
                disabled={isProcessing}
                className="group relative flex h-auto flex-col items-start gap-1 rounded-xl border border-border/80 bg-surface/80 p-3.5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98]"
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Eye className="size-4 text-amber-400 group-hover:scale-110 transition-transform" />
                    <span>Describe Surroundings</span>
                  </div>
                  {isProcessing && activeAction === "scene" && (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Say: <span className="font-semibold text-primary">&ldquo;What&apos;s around me?&rdquo;</span> for room walkthrough.
                </p>
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleReadCurrency}
                disabled={isProcessing}
                className="group relative flex h-auto flex-col items-start gap-1 rounded-xl border border-border/80 bg-surface/80 p-3.5 text-left transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-[0.98]"
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Banknote className="size-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span>Read Currency / Text</span>
                  </div>
                  {isProcessing && activeAction === "currency" && (
                    <Loader2 className="size-3.5 animate-spin text-emerald-400" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Hold cash or medicine signs. Say: <span className="font-semibold text-emerald-400">&ldquo;Read this&rdquo;</span>.
                </p>
              </Button>
            </div>

            {currentResultText && (
              <div className="rounded-xl border border-border/80 bg-card/80 p-3.5 text-xs text-foreground shadow-xs animate-in fade-in-50">
                <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <span className="font-bold text-primary flex items-center gap-1.5">
                    <Sparkles className="size-3.5" /> AI Spoken Description:
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => speak(currentResultText)}
                    className="h-6 gap-1 px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Volume2 className="size-3 text-primary" /> Repeat
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-relaxed">{currentResultText}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
