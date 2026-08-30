import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, Loader2, RefreshCw, Video, VideoOff, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FeedStatus = "idle" | "connecting" | "live" | "error";

/** localStorage key shared with the Settings page. */
export const CAMERA_STREAM_URL_KEY = "netrasense:cameraStreamUrl";

/**
 * This project does not wire its CSS custom properties into Tailwind (no `@theme`),
 * so semantic color utilities like `bg-muted` / `text-primary` render nothing.
 * The camera "screen" is always a dark viewport, so its surface + inner text are
 * given explicit values here and stay correct in both light and dark themes.
 */
const SCREEN_BG = "#0b1315";
const SCREEN_BORDER = "1px solid rgba(255,255,255,0.12)";
const SCREEN_TEXT = "rgba(255,255,255,0.82)";

function resolveConfiguredStreamUrl(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(CAMERA_STREAM_URL_KEY)?.trim();
    if (stored) return stored;
  }
  const envUrl = (import.meta.env["VITE_CAMERA_STREAM_URL"] as string | undefined)?.trim();
  return envUrl ?? "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "network stream";
  }
}

/**
 * Live camera feed shown under the Live proximity radar.
 *
 * Two sources, no backend required:
 *  - "device": this browser's camera via getUserMedia (works on the deployed https site).
 *  - "network": an MJPEG stream URL from an Arduino / vision service, set in Settings
 *    or via the VITE_CAMERA_STREAM_URL env var. Note that an https dashboard cannot load an
 *    http camera (browser mixed-content rule) — use a tunnel or run the dashboard locally.
 */
export function CameraFeed() {
  const [streamUrl, setStreamUrl] = useState("");
  const [useDeviceCamera, setUseDeviceCamera] = useState(false);
  const [status, setStatus] = useState<FeedStatus>("idle");
  const [message, setMessage] = useState("Camera feed is off.");
  const [reloadKey, setReloadKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Resolve the configured network stream URL after hydration (client only).
  useEffect(() => {
    const url = resolveConfiguredStreamUrl();
    setStreamUrl(url);
    if (url) {
      setStatus("connecting");
      setMessage("Connecting to network camera stream…");
    }
  }, []);

  const stopDeviceCamera = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopDeviceCamera(), [stopDeviceCamera]);

  const startDeviceCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setMessage(
        "This browser can't open a camera here. It needs an HTTPS page (or localhost) and camera permission.",
      );
      return;
    }
    setUseDeviceCamera(true);
    setStatus("connecting");
    setMessage("Requesting camera permission…");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw err;
        }
      }
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("live");
      setMessage("Live camera feed active.");
    } catch (err) {
      stopDeviceCamera();
      setUseDeviceCamera(false);
      setStatus("error");
      const name = err instanceof DOMException ? err.name : "";
      setMessage(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera permission was denied. Allow camera access for this site, then try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : name === "NotReadableError"
              ? "The camera is already in use by another app. Close it and try again."
              : "Could not start the camera.",
      );
    }
  }, [stopDeviceCamera]);

  const stopCamera = useCallback(() => {
    stopDeviceCamera();
    setUseDeviceCamera(false);
    if (streamUrl) {
      setStatus("connecting");
      setMessage("Connecting to network camera stream…");
    } else {
      setStatus("idle");
      setMessage("Camera feed is off.");
    }
  }, [stopDeviceCamera, streamUrl]);

  const retryStream = useCallback(() => {
    setStatus("connecting");
    setMessage("Reconnecting to network camera stream…");
    setReloadKey((key) => key + 1);
  }, []);

  const showNetworkStream = !!streamUrl && !useDeviceCamera;
  const showDeviceVideo = useDeviceCamera;
  const showPlaceholder = !showNetworkStream && !showDeviceVideo && status !== "error";

  const dotColor =
    status === "live" ? "#22c55e" : status === "error" ? "#f87171" : "rgba(148,163,184,0.9)";
  const badgeLabel = status === "live" ? "Live" : status === "error" ? "Offline" : "Idle";

  return (
    <section aria-labelledby="camera-heading" className="surface-card mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="camera-heading" className="flex items-center gap-2 text-base font-bold">
          <Camera aria-hidden="true" className="size-5 shrink-0" />
          Live camera feed
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide"
          style={{ border: "1px solid rgba(148,163,184,0.35)" }}
        >
          <span
            className={cn("size-2 rounded-full", status === "live" && "animate-pulse")}
            style={{ backgroundColor: dotColor }}
          />
          {badgeLabel}
        </span>
      </div>

      <div
        className="relative mt-4 aspect-video w-full overflow-hidden rounded-lg"
        style={{ backgroundColor: SCREEN_BG, border: SCREEN_BORDER, color: SCREEN_TEXT }}
      >
        {showNetworkStream && (
          <img
            key={`${streamUrl}:${reloadKey}`}
            src={streamUrl}
            alt="Live video from the connected navigation camera"
            className="size-full object-cover"
            onLoad={() => {
              setStatus("live");
              setMessage("Live camera feed active.");
            }}
            onError={() => {
              setStatus("error");
              setMessage(
                "Could not load the camera stream. Check the URL — and note an https dashboard cannot load an http camera.",
              );
            }}
          />
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn("size-full object-cover", showDeviceVideo ? "block" : "hidden")}
        />

        {showPlaceholder && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <VideoOff aria-hidden="true" className="size-8 opacity-70" />
            <p className="text-sm opacity-80">
              No camera connected. Start this device&apos;s camera, or set a stream URL in Settings.
            </p>
          </div>
        )}

        {status === "connecting" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          >
            <Loader2 aria-hidden="true" className="size-6 animate-spin" />
          </div>
        )}

        {status === "error" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
            style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
          >
            <CircleAlert aria-hidden="true" className="size-8" style={{ color: "#f87171" }} />
            <p className="text-sm font-semibold">{message}</p>
          </div>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {message}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {showDeviceVideo ? (
          <Button variant="outline" size="sm" onClick={stopCamera}>
            <VideoOff aria-hidden="true" className="size-4" />
            Stop camera
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void startDeviceCamera()}>
            <Video aria-hidden="true" className="size-4" />
            Start this device&apos;s camera
          </Button>
        )}

        {showNetworkStream && status === "error" && (
          <Button variant="outline" size="sm" onClick={retryStream}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Retry stream
          </Button>
        )}

        {streamUrl && !showDeviceVideo && (
          <span className="inline-flex items-center gap-1.5 self-center text-xs opacity-70">
            <Wifi aria-hidden="true" className="size-3.5" />
            {safeHost(streamUrl)}
          </span>
        )}
      </div>
    </section>
  );
}
