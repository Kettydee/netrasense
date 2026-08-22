import { Leaf, Sparkles } from "lucide-react";

interface CuteLeafLoaderProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function CuteLeafLoader({
  text = "Loading...",
  size = "md",
  className = "",
}: CuteLeafLoaderProps) {
  const sizeClasses = {
    sm: "size-12",
    md: "size-20",
    lg: "size-28",
  };

  const leafSizes = {
    sm: "size-3.5",
    md: "size-5",
    lg: "size-7",
  };

  return (
    <div
      role="status"
      aria-label={text}
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
    >
      {/* 8-Leaf Spinning Orbit */}
      <div className={`relative ${sizeClasses[size]} animate-spin [animation-duration:3s]`}>
        {/* Leaf 1 (0° - North) */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
          <Leaf className={`${leafSizes[size]} text-emerald-500 fill-emerald-400 rotate-12 drop-shadow-sm`} />
        </div>

        {/* Leaf 2 (45° - North-East) */}
        <div className="absolute top-[14%] right-[14%] translate-x-1 -translate-y-1">
          <Leaf className={`${leafSizes[size]} text-lime-500 fill-lime-400 rotate-45 drop-shadow-sm`} />
        </div>

        {/* Leaf 3 (90° - East) */}
        <div className="absolute top-1/2 right-0 translate-x-1 -translate-y-1/2">
          <Leaf className={`${leafSizes[size]} text-green-500 fill-green-400 rotate-90 drop-shadow-sm`} />
        </div>

        {/* Leaf 4 (135° - South-East) */}
        <div className="absolute bottom-[14%] right-[14%] translate-x-1 translate-y-1">
          <Leaf className={`${leafSizes[size]} text-emerald-600 fill-emerald-500 rotate-[135deg] drop-shadow-sm`} />
        </div>

        {/* Leaf 5 (180° - South) */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1">
          <Leaf className={`${leafSizes[size]} text-teal-500 fill-teal-400 rotate-180 drop-shadow-sm`} />
        </div>

        {/* Leaf 6 (225° - South-West) */}
        <div className="absolute bottom-[14%] left-[14%] -translate-x-1 translate-y-1">
          <Leaf className={`${leafSizes[size]} text-green-600 fill-green-500 rotate-[225deg] drop-shadow-sm`} />
        </div>

        {/* Leaf 7 (270° - West) */}
        <div className="absolute top-1/2 left-0 -translate-x-1 -translate-y-1/2">
          <Leaf className={`${leafSizes[size]} text-emerald-500 fill-emerald-400 rotate-[270deg] drop-shadow-sm`} />
        </div>

        {/* Leaf 8 (315° - North-West) */}
        <div className="absolute top-[14%] left-[14%] -translate-x-1 -translate-y-1">
          <Leaf className={`${leafSizes[size]} text-lime-600 fill-lime-500 rotate-[315deg] drop-shadow-sm`} />
        </div>

        {/* Center Sparkle Accent */}
        <div className="absolute inset-0 m-auto flex items-center justify-center">
          <Sparkles className="size-4 text-emerald-400 animate-pulse" />
        </div>
      </div>

      {/* Pulsing Loading Text */}
      <span className="text-sm font-bold tracking-wide text-emerald-600 dark:text-emerald-400 animate-pulse">
        {text}
      </span>
    </div>
  );
}
