import React, { useRef, useEffect, useState, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import {
  Camera,
  CameraOff,
  Volume2,
  VolumeX,
  Eye,
  Cpu,
  Radio,
  Compass,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CAMERA_STREAM_URL_KEY } from "@/components/CameraFeed";
import { VoiceSelector } from "@/components/VoiceSelector";
import { speak } from "@/lib/netrasense";

interface YoloDetection {
  label: string;
  confidence: number;
  direction: "left" | "center" | "right";
  depth_meters?: number;
  distance_cm?: number;
  threat_level: "Normal" | "Warning" | "Alarming" | "Collision";
  bbox: number[];
}

interface YoloStatus {
  fps: number;
  mode: string;
  threat_level: string;
  closest_obstacle: {
    object: string;
    distance_cm: number;
    threat_level: string;
  } | null;
  detections: YoloDetection[];
}

import { SmartAssistiveSuite } from "@/components/SmartAssistiveSuite";

export interface VisionTelemetryEvent {
  object: string;
  distance_cm: number;
  threat_level: "Normal" | "Warning" | "Alarming" | "Collision";
  direction?: string;
}

interface BlindsEyeLensProps {
  onVisionTelemetry?: (event: VisionTelemetryEvent) => void;
}

export function BlindsEyeLens({ onVisionTelemetry }: BlindsEyeLensProps = {}) {
  const [engineMode, setEngineMode] = useState<"yolo" | "browser">("yolo");
  const [serverUrl, setServerUrl] = useState<string>("http://localhost:5000");
  const [isServerLive, setIsServerLive] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<YoloStatus | null>(null);
  const [serverCheckKey, setServerCheckKey] = useState<number>(0);

  // In-browser Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgStreamRef = useRef<HTMLImageElement | null>(null);
  const [browserModel, setBrowserModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isBrowserCameraActive, setIsBrowserCameraActive] = useState<boolean>(false);
  const [voiceAlerts, setVoiceAlerts] = useState<boolean>(true);
  const [browserDetectedItem, setBrowserDetectedItem] = useState<string>("Scanning...");
  const [browserDetections, setBrowserDetections] = useState<
    Array<{ label: string; direction: string; distance_cm: number }>
  >([]);
  const [isLoadingBrowserModel, setIsLoadingBrowserModel] = useState<boolean>(true);
  const [lastSpoken, setLastSpoken] = useState<string>("");
  const announcedObjectsRef = useRef<Map<string, number>>(new Map());
  const lastSeenObjectsRef = useRef<Map<string, number>>(new Map());

  // Capture current camera frame as Base64 for multimodal AI scene analysis
  const captureFrameBase64 = useCallback((): string | null => {
    if (engineMode === "browser" && videoRef.current && videoRef.current.readyState >= 2) {
      const v = videoRef.current;
      const hiddenCanvas = document.createElement("canvas");
      hiddenCanvas.width = v.videoWidth || 640;
      hiddenCanvas.height = v.videoHeight || 480;
      const ctx = hiddenCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
        return hiddenCanvas.toDataURL("image/jpeg", 0.85);
      }
    }

    if (engineMode === "yolo" && imgStreamRef.current && imgStreamRef.current.complete) {
      const img = imgStreamRef.current;
      const hiddenCanvas = document.createElement("canvas");
      hiddenCanvas.width = img.naturalWidth || 640;
      hiddenCanvas.height = img.naturalHeight || 480;
      const ctx = hiddenCanvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(img, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
          return hiddenCanvas.toDataURL("image/jpeg", 0.85);
        } catch {
          // Cross-origin fallback
        }
      }
    }

    if (canvasRef.current && canvasRef.current.width > 0) {
      try {
        return canvasRef.current.toDataURL("image/jpeg", 0.85);
      } catch {
        // ignore
      }
    }

    return null;
  }, [engineMode]);

  // Resolve configured server URL from localStorage if any
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(CAMERA_STREAM_URL_KEY)?.trim();
      if (stored) {
        try {
          const u = new URL(stored);
          setServerUrl(`${u.protocol}//${u.host}`);
        } catch {
          // ignore
        }
      }
    }
  }, []);

  // Poll YOLO Vision Server status
  useEffect(() => {
    let timer: number | undefined;
    let isSubscribed = true;

    async function checkServer() {
      const candidates = [
        serverUrl,
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        typeof window !== "undefined"
          ? `${window.location.protocol}//${window.location.hostname}:5000`
          : "",
      ].filter(Boolean);

      for (const url of candidates) {
        try {
          const res = await fetch(`${url}/api/latest`, { cache: "no-store", mode: "cors" });
          if (res.ok) {
            const data: YoloStatus = await res.json();
            if (isSubscribed) {
              if (url !== serverUrl) setServerUrl(url);
              setServerStatus(data);
              setIsServerLive(true);

              if (
                data.closest_obstacle &&
                data.closest_obstacle.object &&
                data.closest_obstacle.object !== "Clear"
              ) {
                onVisionTelemetry?.({
                  object: data.closest_obstacle.object,
                  distance_cm: data.closest_obstacle.distance_cm || 100,
                  threat_level: (data.closest_obstacle.threat_level as any) || "Warning",
                });
              }
            }
            return;
          }
        } catch {
          // try next candidate
        }
      }

      if (isSubscribed) {
        setIsServerLive(false);
      }
    }

    if (engineMode === "yolo") {
      checkServer();
      timer = window.setInterval(checkServer, 1000) as unknown as number;
    }

    return () => {
      isSubscribed = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [engineMode, serverUrl, serverCheckKey]);

  // Load In-browser model lazily if browser mode selected
  useEffect(() => {
    if (engineMode === "browser" && !browserModel) {
      async function initModel() {
        try {
          setIsLoadingBrowserModel(true);
          await tf.ready();
          const loadedModel = await cocoSsd.load();
          setBrowserModel(loadedModel);
        } catch (err) {
          console.error("Failed to load browser detection model:", err);
        } finally {
          setIsLoadingBrowserModel(false);
        }
      }
      initModel();
    }
  }, [engineMode, browserModel]);

  // Browser TTS Speak function - uses chosen NetraSense AI Voice
  const speakBrowser = useCallback(
    (text: string) => {
      if (!voiceAlerts || !text.trim()) return;
      speak(text);
      setLastSpoken(text);
    },
    [voiceAlerts],
  );

  // Browser Camera Start/Stop
  const startBrowserCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsBrowserCameraActive(true);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
    }
  };

  const stopBrowserCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setIsBrowserCameraActive(false);
      setBrowserDetectedItem("Lens Inactive");
      announcedObjectsRef.current.clear();
      lastSeenObjectsRef.current.clear();
    }
  };

  // Continuous Browser Detection Loop
  useEffect(() => {
    let animationFrameId: number;

    const detectFrame = async () => {
      if (
        browserModel &&
        videoRef.current &&
        videoRef.current.readyState === 4 &&
        canvasRef.current
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const predictions = await browserModel.detect(video);

        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const now = Date.now();
          const currentSeen = new Set<string>();
          const newItemsToAnnounce: string[] = [];
          const detectedSummaries: string[] = [];

          predictions.forEach((prediction) => {
            if (prediction.score < 0.48) return;

            const [x, y, width, height] = prediction.bbox;
            const cx = x + width / 2;
            const dir =
              cx < canvas.width / 3 ? "Left" : cx < (2 * canvas.width) / 3 ? "Center" : "Right";

            // Draw bounding box
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, width, height);

            // Draw label container
            ctx.fillStyle = "#f59e0b";
            const label = `${prediction.class} (${dir}) ${Math.round(prediction.score * 100)}%`;
            const textWidth = ctx.measureText(label).width;
            ctx.fillRect(x, y > 24 ? y - 24 : y, textWidth + 12, 22);

            // Draw label text
            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 12px Inter, sans-serif";
            ctx.fillText(label, x + 6, y > 24 ? y - 8 : y + 16);

            const trackKey = `${prediction.class}_${dir.toLowerCase()}`;
            currentSeen.add(trackKey);
            lastSeenObjectsRef.current.set(trackKey, now);
            detectedSummaries.push(`${prediction.class} (${dir})`);

            // Check if this distinct object in this zone has been announced
            const lastAnnounced = announcedObjectsRef.current.get(trackKey);
            if (!lastAnnounced || (now - lastAnnounced) > 4000) {
              newItemsToAnnounce.push(`${prediction.class} on the ${dir.toLowerCase()}`);
              announcedObjectsRef.current.set(trackKey, now);
            }
          });

          // Clean up objects that have left the scene for > 3.5s
          for (const [key, seenTime] of lastSeenObjectsRef.current.entries()) {
            if (now - seenTime > 3500) {
              lastSeenObjectsRef.current.delete(key);
              announcedObjectsRef.current.delete(key);
            }
          }

          // Announce every newly detected object name once
          if (newItemsToAnnounce.length > 0) {
            let message = "";
            if (newItemsToAnnounce.length === 1) {
              message = newItemsToAnnounce[0] ?? "";
            } else if (newItemsToAnnounce.length === 2) {
              message = `${newItemsToAnnounce[0] ?? ""}, and ${newItemsToAnnounce[1] ?? ""}`;
            } else {
              message = `${newItemsToAnnounce.slice(0, 3).join(", ")}, and ${newItemsToAnnounce[3] ?? ""}`.replace(/,\s*and\s*$/, "");
            }
            speakBrowser(message);
          }

          if (detectedSummaries.length > 0 && predictions.length > 0) {
            const top = predictions.reduce(
              (prev, curr) => (curr.bbox[3] > prev.bbox[3] ? curr : prev),
              predictions[0]!,
            );
            const relH = Math.max(0.05, top.bbox[3] / canvas.height);
            const approxDistCm = Math.round(
              Math.max(25, Math.min(400, (1.1 / (relH + 0.1)) * 100)),
            );
            const threat =
              approxDistCm <= 40
                ? "Collision"
                : approxDistCm <= 100
                  ? "Alarming"
                  : approxDistCm <= 200
                    ? "Warning"
                    : "Normal";

            onVisionTelemetry?.({
              object: top.class,
              distance_cm: approxDistCm,
              threat_level: threat,
            });

            // Remove duplicates for display summary
            const uniqueSummaries = Array.from(new Set(detectedSummaries));
            setBrowserDetectedItem(uniqueSummaries.join(" · "));
            setBrowserDetections(
              predictions.map((p) => {
                const relH = Math.max(0.05, p.bbox[3] / canvas.height);
                const approxDistCm = Math.round(
                  Math.max(25, Math.min(400, (1.1 / (relH + 0.1)) * 100)),
                );
                const centerX = p.bbox[0] + p.bbox[2] / 2;
                const dir =
                  centerX < canvas.width * 0.33
                    ? "left"
                    : centerX > canvas.width * 0.66
                      ? "right"
                      : "center";
                return {
                  label: p.class,
                  direction: dir,
                  distance_cm: approxDistCm,
                };
              }),
            );
          } else {
            setBrowserDetectedItem("Path clear");
            setBrowserDetections([]);
          }
        }
      }

      if (isBrowserCameraActive && engineMode === "browser") {
        animationFrameId = requestAnimationFrame(detectFrame);
      }
    };

    if (isBrowserCameraActive && engineMode === "browser") {
      detectFrame();
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isBrowserCameraActive, browserModel, engineMode, speakBrowser, onVisionTelemetry]);

  const threatColor = (level?: string) => {
    switch (level) {
      case "Collision":
        return "bg-rose-500/20 text-rose-400 border-rose-500/30";
      case "Alarming":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "Warning":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      default:
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    }
  };

  const detections = serverStatus?.detections ?? [];
  const leftDets = detections.filter((d) => d.direction === "left");
  const centerDets = detections.filter((d) => d.direction === "center");
  const rightDets = detections.filter((d) => d.direction === "right");

  return (
    <div className="surface-card overflow-hidden p-5 sm:p-6">
      {/* Header with Title & Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Eye className="size-5" />
          </div>
          <div>              <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
              Blind&apos;s Eye — YOLO Spatial Vision
              {isServerLive && engineMode === "yolo" && (
                <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isServerLive && engineMode === "yolo"
                ? `YOLO11 · ${serverStatus?.mode ?? "all"} mode · ${serverStatus?.fps ?? 0} FPS`
                : engineMode === "browser"
                  ? (browserModel ? "COCO-SSD loaded" : "Loading browser AI...")
                  : "Server not connected"}`
            </p>

          </div>
        </div>

        {/* Middle: AI Voice Selector Dropdown */}
        <div className="flex items-center justify-center my-1 sm:my-0">
          <VoiceSelector />
        </div>

        {/* Right Side: Engine Toggle Buttons & Voice Mute */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-muted/30 p-1">
            <Button
              size="sm"
              variant={engineMode === "yolo" ? "default" : "ghost"}
              className="h-7 text-xs px-2.5"
              onClick={() => setEngineMode("yolo")}
            >
              <Cpu className="mr-1.5 size-3.5" /> YOLO Server
            </Button>
            <Button
              size="sm"
              variant={engineMode === "browser" ? "default" : "ghost"}
              className="h-7 text-xs px-2.5"
              onClick={() => setEngineMode("browser")}
            >
              <Camera className="mr-1.5 size-3.5" /> Browser Lens
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setVoiceAlerts(!voiceAlerts)}
            className="h-9 px-2.5"
            aria-label={voiceAlerts ? "Mute Voice Alerts" : "Unmute Voice Alerts"}
          >
            {voiceAlerts ? (
              <Volume2 className="size-4 text-emerald-400" />
            ) : (
              <VolumeX className="size-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black flex items-center justify-center">
        {/* MODE 1: YOLO STREAM */}
        {engineMode === "yolo" && (
          <>
            {isServerLive ? (
              <img
                ref={imgStreamRef}
                crossOrigin="anonymous"
                key={`yolo-stream-${serverCheckKey}`}
                src={`${serverUrl}/video_feed`}
                alt="YOLO Object Detection & Distance Stream"
                className="size-full object-cover"
                onError={() => setIsServerLive(false)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Radio className="size-10 text-white/70 animate-pulse" />
                <div>
                  <p className="text-base font-bold text-white">
                    YOLO Vision Server Not Connected
                  </p>
                  <p className="mt-1 text-xs text-white/80 max-w-sm">
                    Start the local AI engine with{" "}
                    <code className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-cyan-300">
                      python server/vision_server.py
                    </code>{" "}
                    or switch to <strong className="text-white">Browser Lens</strong> above.
                  </p>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/40 text-white bg-white/10 hover:bg-white/20 hover:text-white"
                    onClick={() => setServerCheckKey((k) => k + 1)}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" /> Retry Connection
                  </Button>
                  <Button
                    size="sm"
                    className="bg-white text-black hover:bg-white/90 font-bold"
                    onClick={() => setEngineMode("browser")}
                  >
                    Use Browser Camera
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* MODE 2: BROWSER WEBCAM */}
        {engineMode === "browser" && (
          <>
            {!isBrowserCameraActive && (
              <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Camera className="size-10 text-white/70" />
                <div>
                  <p className="text-base font-bold text-white">Browser Camera is Off</p>
                  <p className="mt-1 text-xs text-white/80">
                    Click &ldquo;Open Camera&rdquo; below to run in-browser object detection.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={isLoadingBrowserModel}
                  onClick={startBrowserCamera}
                  className="mt-2 bg-white text-black hover:bg-white/90 font-bold shadow-md"
                >
                  {isLoadingBrowserModel ? "Loading AI..." : "Open Camera"}
                </Button>
              </div>
            )}
            <video
              ref={videoRef}
              className={`absolute inset-0 size-full object-cover ${
                !isBrowserCameraActive ? "hidden" : ""
              }`}
              muted
              playsInline
            />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 size-full object-cover pointer-events-none ${
                !isBrowserCameraActive ? "hidden" : ""
              }`}
            />
          </>
        )}
      </div>

      {/* Controls Bar for Browser Mode */}
      {engineMode === "browser" && isBrowserCameraActive && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="destructive" onClick={stopBrowserCamera}>
            <CameraOff className="mr-1.5 size-4" /> Stop Camera
          </Button>
        </div>
      )}

      {/* Spatial Direction Breakdown Cards (Left / Center / Right) */}
      {engineMode === "yolo" && isServerLive && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* LEFT ZONE */}
          <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Compass className="size-3.5 text-primary" /> Left Zone
              </span>
              <span className="text-xs font-semibold text-foreground">
                {leftDets.length} object{leftDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {leftDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Clear</span>
              ) : (
                leftDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label} {d.depth_meters ? `(${d.depth_meters}m)` : ""}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* CENTER ZONE */}
          <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-primary" /> Center (Path)
              </span>
              <span className="text-xs font-semibold text-foreground">
                {centerDets.length} object{centerDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {centerDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Path Clear</span>
              ) : (
                centerDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label} {d.depth_meters ? `(${d.depth_meters}m)` : ""}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* RIGHT ZONE */}
          <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Compass className="size-3.5 text-primary" /> Right Zone
              </span>
              <span className="text-xs font-semibold text-foreground">
                {rightDets.length} object{rightDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rightDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Clear</span>
              ) : (
                rightDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label} {d.depth_meters ? `(${d.depth_meters}m)` : ""}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* In-Browser Mode Status Banner */}
      {engineMode === "browser" && isBrowserCameraActive && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Detected Object
          </span>
          <span className="text-sm font-bold text-primary">{browserDetectedItem}</span>
        </div>
      )}

      {/* Footer Metrics (YOLO Mode) */}
      {engineMode === "yolo" && isServerLive && serverStatus && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              FPS: <strong>{serverStatus.fps}</strong>
            </span>
            <span>·</span>
            <span>
              Mode: <strong className="capitalize">{serverStatus.mode}</strong>
            </span>
            <span>·</span>
            <span>
              Threat:{" "}
              <strong
                className={
                  serverStatus.threat_level === "Collision"
                    ? "text-collision"
                    : serverStatus.threat_level === "Alarming"
                      ? "text-alarming"
                      : "text-normal"
                }
              >
                {serverStatus.threat_level}
              </strong>
            </span>
          </div>
          {serverStatus.closest_obstacle && (
            <div>
              Closest: <strong>{serverStatus.closest_obstacle.object}</strong> (
              {serverStatus.closest_obstacle.distance_cm} cm)
            </div>
          )}
        </div>
      )}

      {/* Smart Assistive AI Copilot Suite (Find Object, Face & Mood, Indoor Nav, Scene Reader) */}
      <SmartAssistiveSuite
        getFrameBase64={captureFrameBase64}
        detectedObjects={
          engineMode === "yolo"
            ? detections.map((d) => `${d.label} on ${d.direction}`)
            : browserDetectedItem &&
                browserDetectedItem !== "Path clear" &&
                browserDetectedItem !== "Scanning..." &&
                browserDetectedItem !== "Lens Inactive"
              ? [browserDetectedItem]
              : []
        }
        detections={
          engineMode === "yolo"
            ? detections.map((d) => ({
                label: d.label,
                direction: d.direction,
                distance_cm:
                  d.distance_cm ||
                  (d.depth_meters ? Math.round(d.depth_meters * 100) : 120),
              }))
            : browserDetections
        }
      />
    </div>
  );
}
