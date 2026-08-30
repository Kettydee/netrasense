import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  Bot,
  Check,
  Copy,
  Eye,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  describeSurroundings,
  readCurrencyAndText,
  type CurrencyAndTextResult,
  type SceneDescriptionResult,
} from "@/lib/aiVision";
import { speak } from "@/lib/netrasense";

interface SmartSceneDescriberProps {
  getFrameBase64: () => string | null;
  detectedObjects?: string[];
}

export function SmartSceneDescriber({
  getFrameBase64,
  detectedObjects = [],
}: SmartSceneDescriberProps) {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeAction, setActiveAction] = useState<"scene" | "currency" | null>(null);
  const [sceneResult, setSceneResult] = useState<SceneDescriptionResult | null>(null);
  const [currencyResult, setCurrencyResult] = useState<CurrencyAndTextResult | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);

  // Trigger Scene Description
  const handleDescribeScene = useCallback(async () => {
    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Please ensure the camera is active to analyze the scene.");
      speak("Camera is not active. Please start camera first.");
      return;
    }

    setIsProcessing(true);
    setActiveAction("scene");
    toast.info("Analyzing your surroundings...");
    speak("Scanning surroundings...");

    try {
      const result = await describeSurroundings(frame, undefined, detectedObjects);
      setSceneResult(result);
      setCurrencyResult(null);
      speak(result.summary);
      toast.success("Scene described!");
    } catch (err) {
      console.error(err);
      toast.error("Could not describe scene.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  }, [getFrameBase64, detectedObjects]);

  // Trigger Currency / Document Reader
  const handleReadCurrency = useCallback(async () => {
    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Please ensure the camera is active to read currency or text.");
      speak("Camera is not active. Please start camera first.");
      return;
    }

    setIsProcessing(true);
    setActiveAction("currency");
    toast.info("Scanning for currency or text...");
    speak("Scanning currency and text...");

    try {
      const result = await readCurrencyAndText(frame);
      setCurrencyResult(result);
      setSceneResult(null);
      speak(result.speech);
      toast.success("Readout complete!");
    } catch (err) {
      console.error(err);
      toast.error("Could not read currency/text.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  }, [getFrameBase64]);

  // Voice Command Listener Setup (SpeechRecognition)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript.toLowerCase().trim();

      if (
        transcript.includes("describe") ||
        transcript.includes("surroundings") ||
        transcript.includes("what's around") ||
        transcript.includes("where am i") ||
        transcript.includes("look around")
      ) {
        handleDescribeScene();
      } else if (
        transcript.includes("currency") ||
        transcript.includes("money") ||
        transcript.includes("cash") ||
        transcript.includes("rupee") ||
        transcript.includes("dollar") ||
        transcript.includes("read") ||
        transcript.includes("text") ||
        transcript.includes("medicine")
      ) {
        handleReadCurrency();
      }
    };

    recognition.onerror = (e: any) => {
      console.warn("Speech recognition error:", e.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isListening) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
  }, [handleDescribeScene, handleReadCurrency, isListening]);

  const toggleVoiceCommands = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      speak("Voice commands deactivated.");
      toast.info("Voice commands stopped.");
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        speak("Voice commands activated. Say 'Describe scene' or 'Read currency'.");
        toast.success("Listening for: 'Describe scene' or 'Read currency'");
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const currentResultText =
    sceneResult?.summary || currencyResult?.speech || currencyResult?.extractedText || "";

  return (
    <div className="mt-4 rounded-2xl border border-primary/20 bg-gradient-to-b from-card/90 to-surface/90 p-4 shadow-lg backdrop-blur-md">
      {/* Header with Title and Voice Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <Sparkles className="size-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-foreground sm:text-base">
              Smart Assistive Vision AI
            </h3>
            <p className="text-xs text-muted-foreground">
              Instant voice scene describer & banknote / text reader
            </p>
          </div>
        </div>

        {/* Hands-free Voice Toggle */}
        <Button
          type="button"
          size="sm"
          variant={isListening ? "default" : "outline"}
          onClick={toggleVoiceCommands}
          className={`gap-1.5 text-xs font-semibold ${
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

      {/* Action Buttons */}
      <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {/* Button 1: Scene Describer */}
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
            Say: <span className="font-semibold text-primary">"What's around me?"</span> to get a full room walkthrough.
          </p>
        </Button>

        {/* Button 2: Currency & Text Reader */}
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
            Hold cash, medicine, or signs. Say: <span className="font-semibold text-emerald-400">"Read this"</span>.
          </p>
        </Button>
      </div>

      {/* Result Display Box */}
      {currentResultText && (
        <div className="mt-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-xl border border-primary/30 bg-card/95 p-3.5 shadow-inner">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5">
              <Bot className="size-3.5 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                {sceneResult ? "Scene Narrative" : "Currency & Document Reader"}
              </span>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">
                {sceneResult?.source === "gemini" || currencyResult?.source === "gemini"
                  ? "⚡ Gemini AI Vision"
                  : "🧭 Spatial Audio"}
              </Badge>
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => speak(currentResultText)}
                aria-label="Replay audio announcement"
              >
                <Volume2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => copyToClipboard(currentResultText)}
                aria-label="Copy description"
              >
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>

          <p className="mt-2.5 text-sm font-medium leading-relaxed text-foreground">
            "{currentResultText}"
          </p>
        </div>
      )}
    </div>
  );
}
