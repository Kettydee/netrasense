import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Moon, Sun, Video, Volume2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { CAMERA_STREAM_URL_KEY } from "@/components/CameraFeed";
import { speak } from "@/lib/netrasense";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Audio Preferences — NetraSense" },
      {
        name: "description",
        content:
          "Tune voice alerts, spoken thresholds and appearance for the NetraSense dashboard.",
      },
      { property: "og:title", content: "Settings & Audio Preferences — NetraSense" },
      { property: "og:description", content: "Accessibility, audio and appearance preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [voiceOn, setVoiceOn] = useState(false);
  const [announceNormal, setAnnounceNormal] = useState(false);
  const [threshold, setThreshold] = useState(100);
  const [dark, setDark] = useState(true);
  const [cameraUrl, setCameraUrl] = useState("");

  useEffect(() => {
    setVoiceOn(window.localStorage.getItem("netrasense:voice") === "on");
    setAnnounceNormal(window.localStorage.getItem("netrasense:announceNormal") === "on");
    setThreshold(Number(window.localStorage.getItem("netrasense:threshold") ?? 100));
    setDark(document.documentElement.classList.contains("dark"));
    setCameraUrl(window.localStorage.getItem(CAMERA_STREAM_URL_KEY) ?? "");
  }, []);

  function persist(key: string, value: string) {
    window.localStorage.setItem(`netrasense:${key}`, value);
  }

  return (
    <AppShell
      title="Settings & Audio Preferences"
      description="Tune how NetraSense speaks and looks"
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="audio-heading" className="surface-card p-5">
          <h2 id="audio-heading" className="flex items-center gap-2 text-lg font-bold">
            <Volume2 aria-hidden="true" className="size-5 text-primary" />
            Audio feedback engine
          </h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div>
                <Label htmlFor="s-voice" className="text-base font-semibold">
                  Browser voice alerts
                </Label>
                <p className="text-sm text-muted-foreground">
                  Speaks warnings for Alarming and Collision readings.
                </p>
              </div>
              <Switch
                id="s-voice"
                checked={voiceOn}
                onCheckedChange={(v) => {
                  setVoiceOn(v);
                  persist("voice", v ? "on" : "off");
                  if (v) speak("Voice alerts enabled.");
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
              <div>
                <Label htmlFor="s-normal" className="text-base font-semibold">
                  Announce normal readings
                </Label>
                <p className="text-sm text-muted-foreground">
                  Speak every reading, including safe distances.
                </p>
              </div>
              <Switch
                id="s-normal"
                checked={announceNormal}
                onCheckedChange={(v) => {
                  setAnnounceNormal(v);
                  persist("announceNormal", v ? "on" : "off");
                }}
              />
            </div>
            <div className="rounded-lg border border-border p-4">
              <Label htmlFor="s-threshold" className="text-base font-semibold">
                Spoken alert threshold: {threshold} cm
              </Label>
              <p className="mb-4 text-sm text-muted-foreground">
                Obstacles closer than this distance trigger a spoken warning.
              </p>
              <Slider
                id="s-threshold"
                min={20}
                max={400}
                step={10}
                value={[threshold]}
                onValueChange={([v]) => {
                  const next = v ?? 100;
                  setThreshold(next);
                  persist("threshold", String(next));
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => speak(`Warning: Moving Vehicle at ${threshold} centimeters`)}
            >
              <Volume2 aria-hidden="true" className="size-4" />
              Test spoken alert
            </Button>
          </div>
        </section>

        <section aria-labelledby="appearance-heading" className="surface-card p-5">
          <h2 id="appearance-heading" className="text-lg font-bold">
            Appearance
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <Label htmlFor="s-theme" className="text-base font-semibold">
                High-contrast dark mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Switch between the dark and light high-contrast themes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dark ? (
                <Moon aria-hidden="true" className="size-4" />
              ) : (
                <Sun aria-hidden="true" className="size-4" />
              )}
              <Switch
                id="s-theme"
                checked={dark}
                onCheckedChange={(v) => {
                  setDark(v);
                  document.documentElement.classList.toggle("dark", v);
                  persist("theme", v ? "dark" : "light");
                }}
              />
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Keyboard navigation</p>
            <p className="mt-1">
              Every control is reachable with Tab and shows a high-contrast focus ring. Use the
              “Skip to main content” link at the top of each page to bypass navigation.
            </p>
          </div>
        </section>

        <section aria-labelledby="camera-heading" className="surface-card p-5">
          <h2 id="camera-heading" className="flex items-center gap-2 text-lg font-bold">
            <Video aria-hidden="true" className="size-5 text-primary" />
            Live camera feed
          </h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-border p-4">
              <Label htmlFor="s-camera-url" className="text-base font-semibold">
                Network camera stream URL
              </Label>
              <p className="mb-3 text-sm text-muted-foreground">
                MJPEG stream from an ESP32-CAM or a vision service, e.g.{" "}
                <code className="rounded bg-muted px-1 py-0.5">http://192.168.1.50:81/stream</code>.
                Leave this blank to use the current device&apos;s camera from the dashboard instead.
                A dashboard served over https cannot load an http camera — run it locally or put the
                camera behind an https tunnel.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="s-camera-url"
                  type="url"
                  inputMode="url"
                  placeholder="http://192.168.1.50:81/stream"
                  value={cameraUrl}
                  onChange={(e) => setCameraUrl(e.target.value)}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    const next = cameraUrl.trim();
                    persist("cameraStreamUrl", next);
                    speak(next ? "Camera stream URL saved." : "Camera stream URL cleared.");
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Changes take effect the next time the dashboard loads.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
