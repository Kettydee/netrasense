import { useState, useEffect, useCallback } from "react";
import {
  Smartphone,
  Camera,
  RefreshCw,
  HelpCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CameraDeviceSelectorProps {
  onSelectCamera: (deviceId: string) => void;
  selectedCameraId?: string;
  isStreaming?: boolean;
  className?: string;
}

export function CameraDeviceSelector({
  onSelectCamera,
  selectedCameraId,
  isStreaming = false,
  className = "",
}: CameraDeviceSelectorProps) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>(selectedCameraId || "");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  const loadCameras = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    setIsRefreshing(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      setCameras(videoInputs);

      // Auto-select DroidCam if available and nothing selected yet
      if (!selectedId) {
        const droidCam = videoInputs.find((d) => /droidcam|phone|iriun/i.test(d.label));
        if (droidCam) {
          setSelectedId(droidCam.deviceId);
          onSelectCamera(droidCam.deviceId);
        } else if (videoInputs.length > 0 && videoInputs[0]) {
          setSelectedId(videoInputs[0].deviceId);
          onSelectCamera(videoInputs[0].deviceId);
        }
      }
    } catch (err) {
      console.warn("Could not enumerate camera devices:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedId, onSelectCamera]);

  useEffect(() => {
    loadCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadCameras);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadCameras);
    };
  }, [loadCameras]);

  useEffect(() => {
    if (selectedCameraId && selectedCameraId !== selectedId) {
      setSelectedId(selectedCameraId);
    }
  }, [selectedCameraId]);

  const handleChange = (deviceId: string) => {
    setSelectedId(deviceId);
    onSelectCamera(deviceId);
  };

  const hasDroidCam = cameras.some((c) => /droidcam/i.test(c.label));

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* Camera Source Dropdown */}
      <div className="flex items-center gap-1.5">
        <Select value={selectedId} onValueChange={handleChange}>
          <SelectTrigger className="h-8 w-[210px] sm:w-[240px] text-xs font-bold rounded-xl border border-border bg-card/80 text-foreground shadow-xs flex items-center justify-between gap-1.5 px-2.5">
            <div className="flex items-center gap-1.5 truncate">
              {hasDroidCam && /droidcam/i.test(cameras.find((c) => c.deviceId === selectedId)?.label || "") ? (
                <Smartphone className="size-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Camera className="size-3.5 text-primary shrink-0" />
              )}
              <span className="truncate">
                {cameras.find((c) => c.deviceId === selectedId)?.label ||
                  (cameras.length > 0 ? "Select Camera" : "Camera (Default)")}
              </span>
            </div>
          </SelectTrigger>

          <SelectContent className="w-[260px] rounded-xl border border-border bg-card text-foreground shadow-xl p-1 z-50">
            {cameras.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No cameras listed yet. Click &ldquo;Open Camera&rdquo; first to grant permission.
              </div>
            ) : (
              cameras.map((camera, index) => {
                const isPhone = /droidcam|phone|iriun/i.test(camera.label);
                const label = camera.label || `Camera ${index + 1}`;
                return (
                  <SelectItem
                    key={camera.deviceId || index}
                    value={camera.deviceId}
                    className="cursor-pointer rounded-lg py-2 px-2.5 text-xs font-semibold my-0.5"
                  >
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        {isPhone ? (
                          <Smartphone className="size-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <Camera className="size-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate">{label}</span>
                      </div>
                      {isPhone && (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] font-black px-1 py-0 uppercase shrink-0">
                          Phone
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                );
              })
            )}
          </SelectContent>
        </Select>

        {/* Refresh Devices Button */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={loadCameras}
          disabled={isRefreshing}
          className="size-8 p-0 rounded-xl"
          title="Refresh camera devices list"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-primary" : "text-muted-foreground"}`} />
        </Button>
      </div>

      {/* DroidCam Setup Quick Help Modal */}
      <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
          >
            <Smartphone className="size-3.5" />
            <span className="hidden sm:inline">Connect DroidCam</span>
            <HelpCircle className="size-3 text-muted-foreground ml-0.5" />
          </Button>
        </DialogTrigger>

        <DialogContent className="max-w-md rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-extrabold">
              <Smartphone className="size-5 text-emerald-400" />
              How to Connect DroidCam Phone Camera
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 pt-2 text-xs">
            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-muted/30 p-3">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px]">
                1
              </div>
              <div>
                <p className="font-bold text-foreground">Open DroidCam on Phone & PC</p>
                <p className="text-muted-foreground mt-0.5">
                  Launch the DroidCam app on your phone and the DroidCam Client on your laptop. Make sure both are connected to the same Wi-Fi (or USB).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-muted/30 p-3">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px]">
                2
              </div>
              <div>
                <p className="font-bold text-foreground">Click &ldquo;Start&rdquo; in DroidCam PC Client</p>
                <p className="text-muted-foreground mt-0.5">
                  Enter your phone&apos;s Wi-Fi IP into the PC Client and click <strong>Start</strong>. You should see your phone&apos;s camera feed inside the PC Client.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-muted/30 p-3">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px]">
                3
              </div>
              <div>
                <p className="font-bold text-foreground">Select &ldquo;DroidCam Source&rdquo; in NetraSense</p>
                <p className="text-muted-foreground mt-0.5">
                  In the camera dropdown above, select <strong>DroidCam Source 2</strong> or <strong>DroidCam Source 3</strong> and click <strong>Open Camera</strong>.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300 font-semibold leading-relaxed">
              💡 <strong>Tip:</strong> If DroidCam doesn&apos;t show in the dropdown yet, click the <RefreshCw className="inline size-3 mx-0.5" /> <strong>Refresh</strong> icon right after starting the DroidCam PC Client.
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setIsHelpOpen(false);
                  loadCameras();
                }}
                className="font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <CheckCircle2 className="mr-1.5 size-3.5" /> Ready! Refresh Devices
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
