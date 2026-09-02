import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
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

  useEffect(() => {
    const saved = localStorage.getItem(AI_VOICE_STORAGE_KEY) || "nova";
    setSelectedVoice(saved);
  }, []);

  const handleSelect = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem(AI_VOICE_STORAGE_KEY, voiceId);
    onVoiceChange?.(voiceId);

    // Speak immediate personalized sample preview in selected voice
    const profile = AI_VOICE_PROFILES.find((p) => p.id === voiceId);
    if (profile) {
      speak(profile.sampleText, voiceId);
    }
  };

  const currentProfile =
    AI_VOICE_PROFILES.find((p) => p.id === selectedVoice) || AI_VOICE_PROFILES[0];

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Select value={selectedVoice} onValueChange={handleSelect}>
        <SelectTrigger
          className="h-8.5 w-[200px] sm:w-[225px] text-xs font-bold rounded-xl border border-slate-300 !bg-white !text-slate-900 shadow-sm hover:!bg-slate-100 transition-all focus:ring-2 focus:ring-primary flex items-center justify-between gap-2 px-3 mx-auto"
          aria-label="Select AI Voice"
        >
          <div className="flex items-center justify-between gap-2 w-full truncate">
            <div className="flex items-center gap-1.5 truncate">
              <Bot className="size-3.5 text-blue-600 shrink-0" />
              <span className="font-extrabold text-slate-900">{currentProfile.name}</span>
              <span className="text-slate-500 font-normal truncate hidden sm:inline">
                · {currentProfile.vibe}
              </span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 tracking-wider ${
                currentProfile.lang === "HIN"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-blue-100 text-blue-900 border border-blue-300"
              }`}
            >
              {currentProfile.lang}
            </span>
          </div>
        </SelectTrigger>

        <SelectContent className="w-[245px] rounded-2xl border border-slate-200 !bg-white !text-slate-900 shadow-2xl z-50 p-1.5">
          {AI_VOICE_PROFILES.map((profile: AiVoiceProfile) => (
            <SelectItem
              key={profile.id}
              value={profile.id}
              className="!text-slate-900 hover:!bg-slate-100 focus:!bg-slate-100 cursor-pointer py-2 px-2.5 rounded-xl my-0.5 transition-colors"
            >
              <div className="flex items-center justify-between w-full gap-2">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-extrabold text-slate-900 text-xs">{profile.name}</span>
                  <span className="text-[11px] text-slate-500 font-medium truncate">
                    · {profile.vibe}
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 tracking-wider ${
                    profile.lang === "HIN"
                      ? "bg-amber-100 text-amber-900 border border-amber-300"
                      : "bg-blue-100 text-blue-900 border border-blue-300"
                  }`}
                >
                  {profile.lang}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
