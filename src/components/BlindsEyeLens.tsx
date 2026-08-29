import React, { useRef, useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { Camera, CameraOff, Volume2, VolumeX, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BlindsEyeLens() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [voiceAlerts, setVoiceAlerts] = useState<boolean>(true);
  const [detectedItem, setDetectedItem] = useState<string>("Scanning...");
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  const [lastSpoken, setLastSpoken] = useState<string>("");

  // Load the COCO-SSD object recognition model
  useEffect(() => {
    async function initModel() {
      try {
        await tf.ready();
        const loadedModel = await cocoSsd.load();
        setModel(loadedModel);
      } catch (err) {
        console.error("Failed to load object detection model:", err);
      } finally {
        setIsLoadingModel(false);
      }
    }
    initModel();
  }, []);

  // Text-To-Speech function
  const speak = (text: string) => {
    if (!voiceAlerts || !("speechSynthesis" in window)) return;
    if (text === lastSpoken) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
    setLastSpoken(text);
  };

  // Start Camera Stream
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
    }
  };

  // Stop Camera Stream
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
      setDetectedItem("Lens Inactive");
    }
  };

  // Continuous Detection Loop
  useEffect(() => {
    let animationFrameId: number;

    const detectFrame = async () => {
      if (
        model &&
        videoRef.current &&
        videoRef.current.readyState === 4 &&
        canvasRef.current
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const predictions = await model.detect(video);

        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          predictions.forEach((prediction) => {
            const [x, y, width, height] = prediction.bbox;

            // Draw bounding box
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, width, height);

            // Draw label container
            ctx.fillStyle = "#38bdf8";
            const label = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
            const textWidth = ctx.measureText(label).width;
            ctx.fillRect(x, y > 24 ? y - 24 : y, textWidth + 12, 22);

            // Draw label text
            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 13px Inter, sans-serif";
            ctx.fillText(label, x + 6, y > 24 ? y - 8 : y + 16);
          });

          // Primary high-confidence object announcement
          if (predictions.length > 0 && predictions[0].score > 0.6) {
            const topObject = predictions[0].class;
            setDetectedItem(`${topObject} (${Math.round(predictions[0].score * 100)}%)`);
            speak(`${topObject} detected ahead`);
          } else {
            setDetectedItem("Path clear");
          }
        }
      }

      if (isCameraActive) {
        animationFrameId = requestAnimationFrame(detectFrame);
      }
    };

    if (isCameraActive) {
      detectFrame();
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isCameraActive, model, voiceAlerts, lastSpoken]);

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400">
            <Eye className="size-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Blind's Eye — Object Vision</h3>
            <p className="text-xs text-slate-400">
              AI Object Identification & Spoken Warnings
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mute / Unmute Voice */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVoiceAlerts(!voiceAlerts)}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            {voiceAlerts ? (
              <Volume2 className="size-4 text-emerald-400" />
            ) : (
              <VolumeX className="size-4 text-slate-500" />
            )}
          </Button>

          {/* Toggle Camera Button */}
          <Button
            size="sm"
            disabled={isLoadingModel}
            onClick={isCameraActive ? stopCamera : startCamera}
            className={
              isCameraActive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-sky-600 text-white hover:bg-sky-700"
            }
          >
            {isLoadingModel ? (
              "Loading AI..."
            ) : isCameraActive ? (
              <>
                <CameraOff className="mr-1.5 size-4" /> Stop Lens
              </>
            ) : (
              <>
                <Camera className="mr-1.5 size-4" /> Open Camera
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Camera Live Viewport */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center">
        {!isCameraActive && (
          <div className="text-center">
            <p className="text-sm font-medium text-slate-400">Camera feed is off</p>
            <p className="text-xs text-slate-600 mt-1">Click "Open Camera" to activate live object detection</p>
          </div>
        )}
        <video
          ref={videoRef}
          className={`absolute inset-0 size-full object-cover ${!isCameraActive ? "hidden" : ""}`}
          muted
          playsInline
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 size-full object-cover pointer-events-none ${!isCameraActive ? "hidden" : ""}`}
        />
      </div>

      {/* Detection Status Banner */}
      {isCameraActive && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Detected Object
          </span>
          <span className="text-sm font-bold text-sky-400">
            {detectedItem}
          </span>
        </div>
      )}
    </div>
  );
}
