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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { identifyFaceAndMood, type FaceMoodResult } from "@/lib/aiVision";
import { speak } from "@/lib/netrasense";

const FAMILIAR_CONTACTS_KEY = "netrasense:familiar_faces";

interface FaceMoodIdentifierProps {
  getFrameBase64: () => string | null;
}

export function FaceMoodIdentifier({ getFrameBase64 }: FaceMoodIdentifierProps) {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [result, setResult] = useState<FaceMoodResult | null>(null);
  const [savedFaces, setSavedFaces] = useState<string[]>([]);
  const [newPersonName, setNewPersonName] = useState<string>("");
  const [isAddingTag, setIsAddingTag] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAMILIAR_CONTACTS_KEY);
      if (stored) {
        setSavedFaces(JSON.parse(stored));
      } else {
        const defaults = ["Dr. Sarah (Caregiver)", "Priya (Family)", "Alex (Friend)"];
        setSavedFaces(defaults);
        localStorage.setItem(FAMILIAR_CONTACTS_KEY, JSON.stringify(defaults));
      }
    } catch {
      setSavedFaces(["Dr. Sarah", "Priya"]);
    }
  }, []);

  const handleScanFaceAndMood = useCallback(async () => {
    const frame = getFrameBase64();
    if (!frame) {
      toast.error("Camera is inactive. Please open the camera lens first.");
      speak("Camera is not active. Please start camera first.");
      return;
    }

    setIsScanning(true);
    toast.info("Scanning for person, expression, and familiarity...");
    speak("Scanning face and mood...");

    try {
      const res = await identifyFaceAndMood(frame, savedFaces);
      setResult(res);
      speak(res.speech);
      toast.success("Person & Mood identified!");
    } catch (err) {
      console.error(err);
      toast.error("Could not complete face & mood scan.");
    } finally {
      setIsScanning(false);
    }
  }, [getFrameBase64, savedFaces]);

  const handleAddFamiliarPerson = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersonName.trim()) return;

    const updated = Array.from(new Set([...savedFaces, newPersonName.trim()]));
    setSavedFaces(updated);
    localStorage.setItem(FAMILIAR_CONTACTS_KEY, JSON.stringify(updated));
    toast.success(`Saved "${newPersonName.trim()}" to familiar faces!`);
    speak(`Saved ${newPersonName.trim()} to your recognized contacts.`);
    setNewPersonName("");
    setIsAddingTag(false);
  };

  return (
    <div className="space-y-6">
      {/* Action Button & Description */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-base sm:text-lg font-black text-foreground flex items-center gap-2">
            <Smile className="size-5 text-amber-400" />
            Face & Mood Identifier
          </h4>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Recognizes familiar caregivers & reads facial emotion and presence.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleScanFaceAndMood}
          disabled={isScanning}
          className="h-11 px-5 rounded-2xl gap-2 font-black text-xs sm:text-sm bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm transition-all"
        >
          {isScanning ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              <span>Who is in front of me?</span>
            </>
          )}
        </Button>
      </div>

      {/* Result Display Card */}
      {result && (
        <div className="rounded-3xl border-2 border-amber-500/30 bg-amber-500/5 p-5 sm:p-6 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/20 text-3xl border border-amber-500/30 shadow-xs">
                {result.moodEmoji}
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-lg font-black text-foreground">
                    {result.identifiedName ? result.identifiedName : "Unfamiliar Individual"}
                  </span>
                  {result.identifiedName ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-bold px-2 py-0.5">
                      <Heart className="mr-1 size-3 fill-current" /> Recognized Caregiver
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground font-semibold px-2 py-0.5">
                      Guest
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
              className="h-9 px-3.5 rounded-xl gap-2 text-xs font-bold"
              title="Repeat spoken description"
            >
              <Volume2 className="size-4 text-primary" />
              <span>Repeat</span>
            </Button>
          </div>

          <div className="mt-4 rounded-2xl border border-border/80 bg-card/70 p-4 text-xs sm:text-sm leading-relaxed text-foreground shadow-xs">
            <span className="font-black text-primary">Spoken Readout: </span>
            &ldquo;{result.speech}&rdquo;
          </div>

          {/* Quick Tag Button */}
          {!result.identifiedName && !isAddingTag && (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setIsAddingTag(true)}
                className="text-xs sm:text-sm text-primary hover:text-primary hover:bg-primary/10 gap-2 font-bold"
              >
                <UserPlus className="size-4" />
                <span>Save this person&apos;s name</span>
              </Button>
            </div>
          )}

          {isAddingTag && (
            <form onSubmit={handleAddFamiliarPerson} className="mt-4 flex gap-2.5">
              <input
                type="text"
                placeholder="Enter person's name (e.g. Dr. Sarah, Mom, Dave)"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                className="flex-1 h-11 rounded-2xl border border-border bg-card px-4 text-xs sm:text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-xs"
                autoFocus
              />
              <Button type="submit" className="h-11 px-5 rounded-2xl font-bold text-xs sm:text-sm gap-1.5">
                <Check className="size-4" /> Save
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Familiar Contacts Pill List */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="text-xs font-black text-muted-foreground uppercase tracking-wider mr-1">
          Known Contacts:
        </span>
        {savedFaces.slice(0, 5).map((name) => (
          <span
            key={name}
            className="rounded-xl border border-border/80 bg-card/80 px-3 py-1.5 text-xs font-bold text-foreground shadow-xs"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
