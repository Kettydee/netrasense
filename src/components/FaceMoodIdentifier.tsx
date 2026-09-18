import { useState, useCallback, useEffect } from "react";
import {
  UserCheck,
  Smile,
  Loader2,
  Sparkles,
  Volume2,
  UserPlus,
  Heart,
  Check,
  ShieldCheck,
  Trash2,
  Camera,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  identifyFaceAndMood,
  enrollFaceBiometric,
  fetchEnrolledFaces,
  deleteEnrolledFace,
  getStoredFaceProfiles,
  saveStoredFaceProfile,
  deleteStoredFaceProfile,
  compressFaceImage,
  type EnrolledFaceProfile,
  type FaceMoodResult,
  FAMILIAR_CONTACTS_KEY,
} from "@/lib/aiVision";
import { speak } from "@/lib/netrasense";

interface FaceMoodIdentifierProps {
  getFrameBase64: () => string | null;
}

export function FaceMoodIdentifier({ getFrameBase64 }: FaceMoodIdentifierProps) {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isEnrolling, setIsEnrolling] = useState<boolean>(false);
  const [result, setResult] = useState<FaceMoodResult | null>(null);
  const [profiles, setProfiles] = useState<EnrolledFaceProfile[]>([]);
  const [newPersonName, setNewPersonName] = useState<string>("");
  const [isAddingTag, setIsAddingTag] = useState<boolean>(false);
  const [cooldown, setCooldown] = useState<number>(0);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  // Load enrolled face profiles from localStorage + sync with local server
  const refreshContacts = useCallback(async () => {
    const localProfiles = getStoredFaceProfiles();
    setProfiles(localProfiles);

    // Also check local python vision server if available
    try {
      const serverFaces = await fetchEnrolledFaces();
      if (serverFaces && serverFaces.length > 0) {
        // If server has faces not in localStorage, note them
        const existingNames = new Set(localProfiles.map((p) => p.name.toLowerCase()));
        for (const sf of serverFaces) {
          if (!existingNames.has(sf.name.toLowerCase())) {
            saveStoredFaceProfile({
              id: crypto.randomUUID(),
              name: sf.name,
              imageBase64: "",
              enrolledAt: sf.enrolled_at || new Date().toLocaleDateString(),
            });
          }
        }
        setProfiles(getStoredFaceProfiles());
      }
    } catch {
      // server offline
    }
  }, []);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  const handleScanFaceAndMood = useCallback(async () => {
    if (cooldown > 0) {
      toast.info(`Please wait ${cooldown}s before scanning again.`);
      return;
    }

    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Camera is inactive. Please start camera first.");
      speak("Camera is not active. Please start camera first.");
      return;
    }

    setIsScanning(true);
    toast.info("Scanning for person, biometric identity, and expression...");
    speak("Scanning face and mood...");

    try {
      const names = profiles.map((p) => p.name);
      const compressedFrame = await compressFaceImage(frame, 480);
      const res = await identifyFaceAndMood(compressedFrame, names);
      setResult(res);
      speak(res.speech);
      if (res.identifiedName) {
        toast.success(`Recognized ${res.identifiedName} (${res.confidence ? res.confidence + "%" : "Verified"})!`);
        setCooldown(3); // brief 3s pacing
      } else if (res.mood === "Cooling Down" || res.actionDescription === "Rate limit active") {
        toast.warning("AI rate limit active. 10s cooldown started.");
        setCooldown(10); // 10s cooldown for rate limit recovery
      } else if (res.peopleCount > 0) {
        toast.info("Unfamiliar person detected.");
        setCooldown(3);
      } else {
        toast.warning("No face detected in camera frame.");
        setCooldown(2);
      }
    } catch (err) {
      console.error(err);
      toast.error("Could not complete face & mood scan.");
    } finally {
      setIsScanning(false);
    }
  }, [getFrameBase64, profiles, cooldown]);

  const handleAddFamiliarPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPersonName.trim();
    if (!name) return;

    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Camera is inactive. Please start camera to capture face reference.");
      speak("Camera is inactive. Please open the camera first.");
      return;
    }

    setIsEnrolling(true);
    toast.info(`Capturing biometric reference photo for "${name}"...`);
    speak(`Analyzing and enrolling ${name}...`);

    try {
      // 1. Compress face frame to ~280px for fast, lightweight local storage & Gemini payloads
      const compressed = await compressFaceImage(frame, 280);

      // 2. Save profile with reference photo in localStorage
      saveStoredFaceProfile({
        id: crypto.randomUUID(),
        name,
        imageBase64: compressed,
        enrolledAt: new Date().toLocaleDateString(),
      });

      // 3. Also sync to local Python ArcFace server if online
      enrollFaceBiometric(name, frame).catch(() => {});

      refreshContacts();
      toast.success(`Enrolled "${name}" with biometric face reference!`);
      speak(`Successfully saved ${name} to your recognized biometric contacts.`);
      setNewPersonName("");
      setIsAddingTag(false);
    } catch (err) {
      console.error("Enrollment failed:", err);
      toast.error("Could not enroll face.");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeletePerson = async (name: string) => {
    deleteStoredFaceProfile(name);
    deleteEnrolledFace(name).catch(() => {});
    refreshContacts();
    toast.info(`Removed "${name}".`);
  };

  return (
    <div className="space-y-6">
      {/* Action Button & Description */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-base sm:text-lg font-black text-foreground flex items-center gap-2">
            <Smile className="size-5 text-amber-400" />
            ArcFace Biometric & Mood Identifier
          </h4>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            One-shot facial biometric recognition with real-time emotion & distance readout.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsAddingTag(!isAddingTag)}
            className="h-11 px-4 rounded-2xl gap-2 font-bold text-xs border-amber-500/30 hover:bg-amber-500/10 text-foreground cursor-pointer"
          >
            <UserPlus className="size-4 text-amber-400" />
            <span>Enroll Face</span>
          </Button>

          <Button
            type="button"
            onClick={handleScanFaceAndMood}
            disabled={isScanning || isEnrolling || cooldown > 0}
            className="h-11 px-5 rounded-2xl gap-2 font-black text-xs sm:text-sm bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm transition-all cursor-pointer disabled:opacity-60"
          >
            {isScanning ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Analyzing Biometrics...</span>
              </>
            ) : cooldown > 0 ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Wait {cooldown}s...</span>
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                <span>Who is in front of me?</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Quick Face Enrollment Form */}
      {isAddingTag && (
        <form
          onSubmit={handleAddFamiliarPerson}
          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center animate-in fade-in-50"
        >
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold shrink-0">
            <Camera className="size-4" />
            <span>Face Camera & Enter Name:</span>
          </div>
          <input
            type="text"
            placeholder="Enter caregiver / friend's name (e.g. Khirabdi, Dave, Mom)"
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            disabled={isEnrolling}
            className="flex-1 h-10 rounded-xl border border-border bg-card px-3 text-xs sm:text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isEnrolling || !newPersonName.trim()}
              className="h-10 px-4 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 gap-1.5 cursor-pointer"
            >
              {isEnrolling ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Enrolling...
                </>
              ) : (
                <>
                  <Check className="size-3.5" /> Save Biometrics
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAddingTag(false)}
              className="h-10 px-3 rounded-xl text-xs text-muted-foreground cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Result Display Card */}
      {result && (
        <div className="rounded-3xl border-2 border-amber-500/30 bg-amber-500/5 p-5 sm:p-6 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/20 text-3xl border border-amber-500/30 shadow-xs">
                {result.moodEmoji}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-black text-foreground">
                    {result.identifiedName ? result.identifiedName : "Unfamiliar Individual"}
                  </span>
                  {result.identifiedName ? (
                    <>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-bold px-2 py-0.5">
                        <ShieldCheck className="mr-1 size-3 text-emerald-400" />
                        Biometric Match
                      </Badge>
                      {result.confidence !== undefined && result.confidence > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-emerald-400 border-emerald-500/30 font-bold px-1.5 py-0.5"
                        >
                          {result.confidence}% Confidence
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground font-semibold px-2 py-0.5">
                      Guest / Unsaved
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-semibold text-amber-400 mt-1">
                  Expression: <span className="font-bold text-foreground">{result.mood}</span> ·{" "}
                  {result.distanceEstimate}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => speak(result.speech)}
              className="h-9 px-3.5 rounded-xl gap-2 text-xs font-bold cursor-pointer"
              title="Repeat spoken description"
            >
              <Volume2 className="size-4 text-primary" />
              <span>Repeat</span>
            </Button>
          </div>

          <div className="mt-4 rounded-2xl border border-border/80 bg-card/70 p-4 text-xs sm:text-sm leading-relaxed text-foreground shadow-xs">
            <span className="font-black text-amber-400">Spoken Readout: </span>
            &ldquo;{result.speech}&rdquo;
          </div>

          {/* Quick Tag Button when face is unfamiliar */}
          {!result.identifiedName && !isAddingTag && (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setIsAddingTag(true)}
                className="text-xs sm:text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 gap-2 font-bold cursor-pointer"
              >
                <UserPlus className="size-4" />
                <span>Save this person&apos;s face</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Enrolled Contacts Pill List */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black text-muted-foreground uppercase tracking-wider">
            Enrolled Contacts ({profiles.length}):
          </span>
          <span className="text-[11px] text-muted-foreground">
            Biometric Engine: <code className="text-amber-400 font-mono">1-Shot 512D Vectors</code>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {profiles.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No contacts enrolled yet. Click &ldquo;Enroll Face&rdquo; to add caregivers or family with camera.
            </span>
          ) : (
            profiles.map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card/80 pl-2 pr-2.5 py-1.5 text-xs font-bold text-foreground shadow-xs"
              >
                {p.imageBase64 ? (
                  <img
                    src={p.imageBase64}
                    alt={p.name}
                    className="size-6 rounded-full object-cover border border-amber-500/30"
                  />
                ) : (
                  <div className="size-6 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400 border border-amber-500/20">
                    <User className="size-3.5" />
                  </div>
                )}
                <span>{p.name}</span>
                <button
                  type="button"
                  onClick={() => handleDeletePerson(p.name)}
                  title={`Remove ${p.name}`}
                  aria-label={`Remove ${p.name}`}
                  className="size-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1 cursor-pointer"
                >
                  &times;
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
