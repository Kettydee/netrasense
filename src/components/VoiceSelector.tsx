import { useEffect, useState } from "react";
import { Bot, Check, Volume2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_VOICE_PROFILES,
  AI_VOICE_STORAGE_KEY,
  speak,
  type AiVoiceProfile,
} from "@/lib/netrasense";

interface VoiceSelectorProps {
  onVoiceChange?: (voiceId: string) => void;
  className?: string;
}

export function VoiceSelector({ onVoiceChange, className = "" }: VoiceSelectorProps) {
  const [selectedVoice, setSelectedVoice] = useState<string>("nova");
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(AI_VOICE_STORAGE_KEY) || "nova";
    setSelectedVoice(saved);

    const loadVoices = () => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const allVoices = window.speechSynthesis.getVoices();
      // Filter primarily for English or clean system voices
      const filtered = allVoices.filter(
        (v) => v.lang.startsWith("en") || v.default
      );
      setSystemVoices(filtered.length > 0 ? filtered : allVoices.slice(0, 8));
    };

    loadVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleSelect = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem(AI_VOICE_STORAGE_KEY, voiceId);
    onVoiceChange?.(voiceId);

    // Speak a brief preview in the newly selected voice
    const profile = AI_VOICE_PROFILES.find((p) => p.id === voiceId);
    const voiceName = profile ? profile.name : voiceId.replace(/^(Microsoft|Google)\s+/, "");
    speak(`Voice set to ${voiceName}`, voiceId);
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Select value={selectedVoice} onValueChange={handleSelect}>
        <SelectTrigger
          className="h-8 w-[165px] sm:w-[185px] text-xs font-semibold rounded-lg border-border bg-muted/30 px-2.5 text-foreground hover:bg-muted/60 transition-colors focus:ring-1 focus:ring-primary"
          aria-label="Select AI Voice"
        >
          <div className="flex items-center gap-1.5 truncate">
            <Bot className="size-3.5 text-primary shrink-0" />
            <SelectValue placeholder="Select AI Voice" />
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-72 w-[220px] rounded-xl border-border bg-popover text-popover-foreground shadow-xl z-50">
          <SelectGroup>
            <SelectLabel className="text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase px-2 py-1.5">
              AI Voice Personas
            </SelectLabel>
            {AI_VOICE_PROFILES.map((profile: AiVoiceProfile) => (
              <SelectItem
                key={profile.id}
                value={profile.id}
                className="text-xs font-medium cursor-pointer py-1.5 px-2 rounded-lg"
              >
                <div className="flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">{profile.name}</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      {profile.gender === "female" ? "♀ Female" : "♂ Male"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{profile.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>

          {systemVoices.length > 0 && (
            <SelectGroup className="mt-2 border-t border-border/60 pt-1">
              <SelectLabel className="text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase px-2 py-1.5">
                Device Voices
              </SelectLabel>
              {systemVoices.map((voice) => (
                <SelectItem
                  key={voice.name}
                  value={voice.name}
                  className="text-xs font-medium cursor-pointer py-1 px-2 rounded-lg truncate"
                >
                  <span className="truncate">{voice.name.replace(/^(Microsoft|Google)\s+/, "")}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
