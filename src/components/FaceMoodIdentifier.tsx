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
    <div className="space-y-4">
      {/* Action Button & Description */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-extrabold text-foreground flex items-center gap-1.5">
            <Smile className="size-4 text-amber-400" />
            Face & Mood Identifier
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recognizes familiar caregivers & reads facial emotion and presence.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleScanFaceAndMood}
          disabled={isScanning}
          className="gap-2 font-bold text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md"
        >
          {isScanning ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              <span>Who is in front of me?</span>
            </>
          )}
        </Button>
      </div>

      {/* Result Display Card */}
      {result && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/20 text-2xl border border-amber-500/30">
                {result.moodEmoji}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-foreground">
                    {result.identifiedName ? result.identifiedName : "Unfamiliar Individual"}
                  </span>
                  {result.identifiedName ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                      <Heart className="mr-1 size-2.5 fill-current" /> Recognized Caregiver
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Guest
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-semibold text-amber-400 mt-0.5">
                  Expression: <span className="font-bold text-foreground">{result.mood}</span> ·{" "}
                  {result.distanceEstimate}
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => speak(result.speech)}
              className="h-8 gap-1.5 text-xs font-semibold"
              title="Repeat spoken description"
            >
              <Volume2 className="size-3.5 text-primary" />
              <span>Repeat</span>
            </Button>
          </div>

          <div className="mt-3 rounded-xl border border-border/80 bg-card/60 p-3 text-xs leading-relaxed text-foreground">
            <span className="font-bold text-primary">Spoken Readout: </span>
            &ldquo;{result.speech}&rdquo;
          </div>

          {/* Quick Tag Button */}
          {!result.identifiedName && !isAddingTag && (
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setIsAddingTag(true)}
                className="text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1.5"
              >
                <UserPlus className="size-3.5" />
                <span>Save this person&apos;s name</span>
              </Button>
            </div>
          )}

          {isAddingTag && (
            <form onSubmit={handleAddFamiliarPerson} className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Enter person's name (e.g. Dr. Sarah, Mom, Dave)"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                className="flex-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <Button type="submit" size="sm" className="font-bold text-xs gap-1">
                <Check className="size-3.5" /> Save
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Familiar Contacts Pill List */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
          Known People:
        </span>
        {savedFaces.slice(0, 5).map((name) => (
          <span
            key={name}
            className="rounded-lg border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
