import React, { useRef, useEffect, useState, useCallback } from "react";

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
import { CameraDeviceSelector } from "@/components/CameraDeviceSelector";
import { speak } from "@/lib/netrasense";
import { SmartAssistiveSuite } from "@/components/SmartAssistiveSuite";

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

export interface VisionTelemetryEvent {
  object: string;
}

interface BlindsEyeLensProps {
  onVisionTelemetry?: (event: VisionTelemetryEvent) => void;
  onCameraStatusChange?: (active: boolean) => void;
}

export function BlindsEyeLens({
  onVisionTelemetry,
  onCameraStatusChange,
}: BlindsEyeLensProps = {}) {
  const [engineMode, setEngineMode] = useState<"yolo" | "browser">("browser");
  const [serverUrl, setServerUrl] = useState<string>("http://localhost:5000");
  const [isServerLive, setIsServerLive] = useState<boolean>(false);
  const [serverStatus, setServerStatus] = useState<YoloStatus | null>(null);
  const [serverCheckKey, setServerCheckKey] = useState<number>(0);
  const [cameraError, setCameraError] = useState<string>("");
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [browserModelError, setBrowserModelError] = useState<string>("");
  const [modelRetryKey, setModelRetryKey] = useState<number>(0);

  interface BrowserObjectDetectionModel {
    detect: (
      img: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
      maxNumBoxes?: number,
      minScore?: number,
    ) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
  }

  // In-browser Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgStreamRef = useRef<HTMLImageElement | null>(null);
  const [browserModel, setBrowserModel] = useState<BrowserObjectDetectionModel | null>(null);
  const [isBrowserCameraActive, setIsBrowserCameraActive] = useState<boolean>(false);
  const [isLoadingBrowserModel, setIsLoadingBrowserModel] = useState<boolean>(false);
  const browserModelPromiseRef = useRef<Promise<BrowserObjectDetectionModel> | null>(null);
  const cameraSessionRef = useRef(0);
  const [cameraSession, setCameraSession] = useState(0);
  const browserInferenceBusyRef = useRef(false);
  const browserDetectionSignatureRef = useRef("");
  const lastTelemetryRef = useRef<{ object: string; at: number } | null>(null);
  const onVisionTelemetryRef = useRef(onVisionTelemetry);
  onVisionTelemetryRef.current = onVisionTelemetry;

  useEffect(() => {
    // Report either camera source shown by this component: browser camera or YOLO server stream.
    onCameraStatusChange?.(isBrowserCameraActive || isServerLive);
  }, [isBrowserCameraActive, isServerLive, onCameraStatusChange]);
  const [voiceAlerts, setVoiceAlerts] = useState<boolean>(true);
  const [browserDetectedItem, setBrowserDetectedItem] = useState<string>("Scanning...");
  const [browserDetections, setBrowserDetections] = useState<
    Array<{ label: string; direction: string; distance_cm?: number }>
  >([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [lastSpoken, setLastSpoken] = useState<string>("");
  const announcedObjectsRef = useRef<Map<string, number>>(new Map());
  const lastSeenObjectsRef = useRef<Map<string, number>>(new Map());

  const reportVisionTelemetry = useCallback((object: string) => {
    const now = Date.now();
    const last = lastTelemetryRef.current;
    if (last?.object === object && now - last.at < 3500) return;
    lastTelemetryRef.current = { object, at: now };
    onVisionTelemetryRef.current?.({ object });
  }, []);

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
    let isChecking = false;
    let controller: AbortController | null = null;

    async function checkServer() {
      if (isChecking) return;
      isChecking = true;
      const candidates = [
        serverUrl,
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        typeof window !== "undefined"
          ? `${window.location.protocol}//${window.location.hostname}:5000`
          : "",
      ].filter(Boolean);

      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 1800);
      try {
        for (const url of candidates) {
          try {
            const res = await fetch(`${url}/api/latest`, {
              cache: "no-store",
              mode: "cors",
              signal: controller.signal,
            });
            if (res.ok) {
              const data: YoloStatus = await res.json();
              if (isSubscribed) {
                if (url !== serverUrl) setServerUrl(url);
                setServerStatus(data);
                setIsServerLive(true);

                if (data.closest_obstacle?.object && data.closest_obstacle.object !== "Clear") {
                  reportVisionTelemetry(data.closest_obstacle.object);
                }
              }
              return;
            }
          } catch {
            if (controller.signal.aborted) break;
            // try next candidate
          }
        }

        if (isSubscribed) {
          setIsServerLive(false);
          setServerStatus(null);
        }
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        isChecking = false;
      }
    }

    if (engineMode === "yolo") {
      checkServer();
      timer = window.setInterval(checkServer, 2500) as unknown as number;
    }

    return () => {
      isSubscribed = false;
      controller?.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [engineMode, serverUrl, serverCheckKey, reportVisionTelemetry]);

  // Load COCO-SSD only after a camera has been opened; this keeps page load light.
  useEffect(() => {
    if (engineMode !== "browser" || !isBrowserCameraActive || browserModel) return;

    let active = true;
    setIsLoadingBrowserModel(true);
    setBrowserModelError("");
    setBrowserDetectedItem("Loading browser AI…");

    if (!browserModelPromiseRef.current) {
      browserModelPromiseRef.current = (async () => {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const cocoSsd = await import("@tensorflow-models/coco-ssd");
        const loadedModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        return loadedModel as unknown as BrowserObjectDetectionModel;
      })().catch((error) => {
        browserModelPromiseRef.current = null;
        throw error;
      });
    }

    browserModelPromiseRef.current
      .then((model) => {
        if (active) setBrowserModel(model);
      })
      .catch((error: unknown) => {
        console.error("Failed to load browser detection model:", error);
        if (active) {
          setBrowserModelError(
            "Browser detection could not load. Check your connection and retry.",
          );
          setBrowserDetectedItem("AI unavailable");
        }
      })
      .finally(() => {
        if (active) setIsLoadingBrowserModel(false);
      });

    return () => {
      active = false;
    };
  }, [engineMode, isBrowserCameraActive, browserModel, modelRetryKey]);

  // Stop any active camera as soon as the component leaves the page.
  useEffect(
    () => () => {
      cameraSessionRef.current += 1;
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  // Browser TTS Speak function - uses chosen NetraSense AI Voice
  const speakBrowser = useCallback(
    (text: string) => {
      if (!voiceAlerts || !text.trim()) return;
      speak(text);
      setLastSpoken(text);
    },
    [voiceAlerts],
  );

  // Browser Camera Start/Stop with Device Selection
  const startBrowserCamera = async (deviceId = selectedCameraId): Promise<boolean> => {
    if (!deviceId) {
      setCameraError("Choose a camera before opening it.");
      return false;
    }

    setCameraError("");
    setIsStartingCamera(true);
    let nextStream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires HTTPS or localhost in a supported browser.");
      }

      nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is not ready. Try opening the camera again.");

      const previousStream = video.srcObject as MediaStream | null;
      video.srcObject = nextStream;
      try {
        await video.play();
      } catch (error) {
        video.srcObject = previousStream;
        throw error;
      }

      previousStream?.getTracks().forEach((track) => track.stop());
      cameraSessionRef.current += 1;
      setCameraSession(cameraSessionRef.current);
      const openedSession = cameraSessionRef.current;
      nextStream.getVideoTracks().forEach((track) => {
        track.addEventListener(
          "ended",
          () => {
            if (cameraSessionRef.current !== openedSession) return;
            stopBrowserCamera();
            setCameraError("The selected camera disconnected. Choose a camera and open it again.");
          },
          { once: true },
        );
      });
      browserDetectionSignatureRef.current = "__new_camera__";
      announcedObjectsRef.current.clear();
      lastSeenObjectsRef.current.clear();
      setBrowserDetections([]);
      setBrowserDetectedItem("Camera ready — loading AI…");
      setIsBrowserCameraActive(true);
      return true;
    } catch (error) {
      nextStream?.getTracks().forEach((track) => track.stop());
      console.error("Error accessing selected camera:", error);
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera permission was denied. Allow camera access for this site, then retry."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "That camera is no longer available. Refresh the list and choose another camera."
            : name === "NotReadableError"
              ? "That camera is busy in another app. Close the other app and retry."
              : error instanceof Error
                ? error.message
                : "Could not open the selected camera. Refresh the list and retry.",
      );
      return false;
    } finally {
      setIsStartingCamera(false);
    }
  };

  const handleCameraSelect = async (deviceId: string) => {
    const previousDeviceId = selectedCameraId;
    setSelectedCameraId(deviceId);
    if (isBrowserCameraActive) {
      const changed = await startBrowserCamera(deviceId);
      if (!changed) setSelectedCameraId(previousDeviceId);
    }
  };

  const stopBrowserCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    setCameraSession(cameraSessionRef.current);
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    browserDetectionSignatureRef.current = "__stopped__";
    announcedObjectsRef.current.clear();
    lastSeenObjectsRef.current.clear();
    setBrowserDetections([]);
    setIsBrowserCameraActive(false);
    setBrowserDetectedItem("Lens Inactive");
  }, []);

  useEffect(() => {
    if (engineMode === "yolo" && isBrowserCameraActive) stopBrowserCamera();
  }, [engineMode, isBrowserCameraActive, stopBrowserCamera]);

  // Detect at a bounded rate on a 640x480-or-smaller frame. The live video
  // stays full size while inference and React updates remain lightweight.
  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;
    const sessionId = cameraSession;
    const detectionIntervalMs = 220;
    const displayThreshold = 0.42;
    const alertThreshold = 0.5;

    const detectFrame = async () => {
      if (
        browserModel &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        canvasRef.current
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const overlayContext = canvas.getContext("2d");
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (sourceWidth > 0 && sourceHeight > 0 && !browserInferenceBusyRef.current) {
          browserInferenceBusyRef.current = true;
          try {
            if (canvas.width !== sourceWidth) canvas.width = sourceWidth;
            if (canvas.height !== sourceHeight) canvas.height = sourceHeight;

            const scale = Math.min(1, 640 / sourceWidth, 480 / sourceHeight);
            const inferenceWidth = Math.max(1, Math.round(sourceWidth * scale));
            const inferenceHeight = Math.max(1, Math.round(sourceHeight * scale));
            const inferenceCanvas = inferenceCanvasRef.current ?? document.createElement("canvas");
            inferenceCanvasRef.current = inferenceCanvas;
            if (inferenceCanvas.width !== inferenceWidth) inferenceCanvas.width = inferenceWidth;
            if (inferenceCanvas.height !== inferenceHeight)
              inferenceCanvas.height = inferenceHeight;
            const inferenceContext = inferenceCanvas.getContext("2d", { alpha: false });
            if (inferenceContext && overlayContext) {
              inferenceContext.drawImage(video, 0, 0, inferenceWidth, inferenceHeight);
              const raw = await browserModel.detect(inferenceCanvas, 30, 0.35);
              if (cancelled || sessionId !== cameraSessionRef.current) return;

              const scaleX = sourceWidth / inferenceWidth;
              const scaleY = sourceHeight / inferenceHeight;
              const predictions = raw.map((prediction) => ({
                ...prediction,
                bbox: [
                  prediction.bbox[0] * scaleX,
                  prediction.bbox[1] * scaleY,
                  prediction.bbox[2] * scaleX,
                  prediction.bbox[3] * scaleY,
                ] as [number, number, number, number],
              }));
              const visible = predictions.filter(
                (prediction) => prediction.score >= displayThreshold,
              );

              overlayContext.clearRect(0, 0, canvas.width, canvas.height);
              const now = Date.now();
              const alerts: string[] = [];
              const summaries: string[] = [];
              const stateDetections: Array<{ label: string; direction: string }> = [];

              for (const prediction of visible) {
                const [x, y, width, height] = prediction.bbox;
                const centerX = x + width / 2;
                const direction =
                  centerX < sourceWidth / 3
                    ? "left"
                    : centerX < (sourceWidth * 2) / 3
                      ? "center"
                      : "right";
                const titleDirection = direction[0]!.toUpperCase() + direction.slice(1);

                overlayContext.strokeStyle = "#f59e0b";
                overlayContext.lineWidth = Math.max(2, sourceWidth / 640);
                overlayContext.strokeRect(x, y, width, height);
                overlayContext.font = `bold ${Math.max(12, sourceWidth / 64)}px Inter, sans-serif`;
                const label = `${prediction.class} (${titleDirection}) ${Math.round(prediction.score * 100)}%`;
                const textWidth = overlayContext.measureText(label).width;
                const labelY = y > 28 ? y - 26 : y;
                overlayContext.fillStyle = "#f59e0b";
                overlayContext.fillRect(x, labelY, textWidth + 12, 24);
                overlayContext.fillStyle = "#0f172a";
                overlayContext.fillText(label, x + 6, labelY + 17);

                const trackKey = `${prediction.class}_${direction}`;
                lastSeenObjectsRef.current.set(trackKey, now);
                summaries.push(`${prediction.class} (${titleDirection})`);
                stateDetections.push({ label: prediction.class, direction });

                if (prediction.score >= alertThreshold) {
                  const lastAnnounced = announcedObjectsRef.current.get(trackKey);
                  if (!lastAnnounced || now - lastAnnounced > 4000) {
                    alerts.push(`${prediction.class} on the ${direction}`);
                    announcedObjectsRef.current.set(trackKey, now);
                  }
                }
              }

              for (const [key, seenAt] of lastSeenObjectsRef.current) {
                if (now - seenAt > 3500) {
                  lastSeenObjectsRef.current.delete(key);
                  announcedObjectsRef.current.delete(key);
                }
              }

              if (alerts.length > 0) {
                const message =
                  alerts.length === 1
                    ? alerts[0]!
                    : `${alerts.slice(0, 3).join(", ")}${alerts.length > 3 ? ", and more" : ""}`;
                speakBrowser(message);
              }

              const uniqueSummaries = Array.from(new Set(summaries));
              const summary =
                uniqueSummaries.length > 0 ? uniqueSummaries.join(" · ") : "No objects detected";
              const uniqueStateDetections = Array.from(
                new Map(
                  stateDetections.map((item) => [`${item.label}:${item.direction}`, item]),
                ).values(),
              );
              const stateSignature = uniqueStateDetections
                .map((item) => `${item.label}:${item.direction}`)
                .join("|");
              if (stateSignature !== browserDetectionSignatureRef.current) {
                browserDetectionSignatureRef.current = stateSignature;
                setBrowserDetectedItem(summary);
                setBrowserDetections(uniqueStateDetections);
              }

              if (visible.length > 0) {
                const top = visible.reduce((best, current) =>
                  current.bbox[2] * current.bbox[3] > best.bbox[2] * best.bbox[3] ? current : best,
                );
                reportVisionTelemetry(top.class);
              }
            }
          } catch (error) {
            console.error("Primary object detection failed:", error);
            if (!cancelled && sessionId === cameraSessionRef.current) {
              overlayContext?.clearRect(0, 0, canvas.width, canvas.height);
              setBrowserDetectedItem("Detection paused — check the selected camera");
            }
          } finally {
            browserInferenceBusyRef.current = false;
          }
        }
      }

      if (
        !cancelled &&
        sessionId === cameraSessionRef.current &&
        isBrowserCameraActive &&
        engineMode === "browser"
      ) {
        timerId = window.setTimeout(() => void detectFrame(), detectionIntervalMs);
      }
    };

    if (isBrowserCameraActive && engineMode === "browser") {
      detectFrame();
    }

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [
    cameraSession,
    isBrowserCameraActive,
    browserModel,
    engineMode,
    speakBrowser,
    reportVisionTelemetry,
  ]);

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
  const _leftDets = leftDets;
  const _centerDets = centerDets;
  const _rightDets = rightDets;

  return (
    <div className="surface-card overflow-hidden p-5 sm:p-6">
      {/* Header with Title & Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Eye className="size-5" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
              NetraSense — YOLO Spatial Vision
              {isServerLive && engineMode === "yolo" && (
                <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isServerLive && engineMode === "yolo"
                ? `YOLO11 · ${serverStatus?.mode ?? "all"} mode · ${serverStatus?.fps ?? 0} FPS`
                : engineMode === "browser"
                  ? browserModelError
                    ? "Browser AI unavailable"
                    : !isBrowserCameraActive
                      ? "Choose a camera to start"
                      : browserModel
                        ? "Object detection active"
                        : "Loading browser AI..."
                  : "Server not connected"}
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
                  <p className="text-base font-bold text-white">YOLO Vision Server Not Connected</p>
                  <p className="mt-1 text-xs text-white/80 max-w-sm">
                    Start the local AI engine with{" "}
                    <code className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-cyan-300">
                      python server/vision_server.py
                    </code>{" "}
                    or switch to <strong className="text-white">Browser Lens</strong> above.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
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
                    Choose your laptop camera or DroidCam above, then click &ldquo;Open
                    Camera&rdquo;.
                  </p>
                </div>
                <div className="my-1 flex flex-col items-center gap-2">
                  <CameraDeviceSelector
                    onSelectCamera={handleCameraSelect}
                    selectedCameraId={selectedCameraId}
                    isStreaming={false}
                    className="justify-center"
                  />
                  <Button
                    size="sm"
                    disabled={isStartingCamera || isLoadingBrowserModel}
                    onClick={() => startBrowserCamera()}
                    className="mt-1 bg-white text-black hover:bg-white/90 font-bold shadow-md"
                  >
                    {isStartingCamera
                      ? "Opening Camera…"
                      : isLoadingBrowserModel
                        ? "Loading AI…"
                        : "Open Camera"}
                  </Button>
                  {!selectedCameraId && (
                    <p className="max-w-xs text-xs text-amber-200" role="status">
                      Choose a camera above. If the list is empty, allow camera access first.
                    </p>
                  )}
                  {cameraError && (
                    <p className="max-w-xs text-xs text-rose-300" role="alert">
                      {cameraError}
                    </p>
                  )}
                </div>
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <CameraDeviceSelector
            onSelectCamera={handleCameraSelect}
            selectedCameraId={selectedCameraId}
            isStreaming={true}
          />
          <Button size="sm" variant="destructive" onClick={stopBrowserCamera}>
            <CameraOff className="mr-1.5 size-4" /> Stop Camera
          </Button>
          {cameraError && (
            <p className="w-full text-xs text-rose-400" role="alert">
              {cameraError}
            </p>
          )}
          {browserModelError && (
            <div
              className="flex w-full items-center justify-between gap-2 text-xs text-rose-400"
              role="alert"
            >
              <span>{browserModelError}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setModelRetryKey((key) => key + 1)}
              >
                <RefreshCw className="mr-1.5 size-3.5" /> Retry AI
              </Button>
            </div>
          )}
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
                {_leftDets.length} object{_leftDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {_leftDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Clear</span>
              ) : (
                _leftDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label}
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
                {_centerDets.length} object{_centerDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {_centerDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Path Clear</span>
              ) : (
                _centerDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label}
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
                {_rightDets.length} object{_rightDets.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {_rightDets.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">Clear</span>
              ) : (
                _rightDets.map((d, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${threatColor(
                      d.threat_level,
                    )}`}
                  >
                    {d.label}
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
            ? detections.map((d) => {
                const distanceCm =
                  d.distance_cm ??
                  (d.depth_meters !== undefined && d.depth_meters !== null
                    ? Math.round(d.depth_meters * 100)
                    : undefined);
                return {
                  label: d.label,
                  direction: d.direction,
                  ...(distanceCm !== undefined ? { distance_cm: distanceCm } : {}),
                };
              })
            : browserDetections
        }
      />
    </div>
  );
}
