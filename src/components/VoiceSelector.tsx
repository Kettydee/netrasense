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
    <div className={`flex items-center justify-center ${className}`}>
      <Select value={selectedVoice} onValueChange={handleSelect}>
        <SelectTrigger
          className="h-8.5 w-[170px] sm:w-[195px] text-xs font-bold rounded-xl border border-slate-300 !bg-white !text-slate-900 shadow-sm hover:!bg-slate-100 transition-all focus:ring-2 focus:ring-primary flex items-center justify-center gap-2 px-3 mx-auto"
          aria-label="Select AI Voice"
        >
          <div className="flex items-center justify-center gap-1.5 truncate text-center mx-auto">
            <Bot className="size-3.5 text-blue-600 shrink-0" />
            <SelectValue placeholder="Select AI Voice" />
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-72 w-[225px] rounded-2xl border border-slate-200 !bg-white !text-slate-900 shadow-2xl z-50 p-1.5">
          <SelectGroup>
            <SelectLabel className="text-[10px] font-black tracking-widest !text-slate-400 uppercase text-center py-1">
              AI Voice Personas
            </SelectLabel>
            {AI_VOICE_PROFILES.map((profile: AiVoiceProfile) => (
              <SelectItem
                key={profile.id}
                value={profile.id}
                className="!text-slate-900 hover:!bg-slate-100 focus:!bg-slate-100 cursor-pointer py-2 px-2.5 rounded-xl my-0.5"
              >
                <div className="flex flex-col items-center justify-center text-center w-full">
                  <div className="flex items-center justify-center gap-1 font-bold text-slate-900 text-xs">
                    <span>{profile.name}</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({profile.gender === "female" ? "Female" : "Male"})
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 text-center">{profile.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>

          {systemVoices.length > 0 && (
            <SelectGroup className="mt-2 border-t border-slate-200 pt-1.5">
              <SelectLabel className="text-[10px] font-black tracking-widest !text-slate-400 uppercase text-center py-1">
                Device Voices
              </SelectLabel>
              {systemVoices.map((voice) => (
                <SelectItem
                  key={voice.name}
                  value={voice.name}
                  className="!text-slate-900 hover:!bg-slate-100 focus:!bg-slate-100 cursor-pointer py-1.5 px-2.5 rounded-xl my-0.5"
                >
                  <div className="text-center w-full truncate font-semibold text-xs text-slate-900">
                    {voice.name.replace(/^(Microsoft|Google)\s+/, "")}
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
