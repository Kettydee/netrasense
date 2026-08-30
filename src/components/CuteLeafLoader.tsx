interface BlueBubbleLoaderProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function CuteLeafLoader({
  text = "Loading...",
  size = "md",
  className = "",
}: BlueBubbleLoaderProps) {
  const sizeClasses = {
    sm: "size-10",
    md: "size-16",
    lg: "size-24",
  };

  return (
    <div
      role="status"
      aria-label={text}
      className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}
    >
      {/* 10-Bubble Smooth Gradual Ring (All light sky-blue) */}
      <svg
        viewBox="0 0 100 100"
        className={`${sizeClasses[size] || "size-16"} animate-spin [animation-duration:1.4s] drop-shadow-[0_0_8px_rgba(56,189,248,0.45)]`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 1. (0° - Top) - Radius: 2px */}
        <circle cx="50" cy="12" r="2.0" fill="#38BDF8" opacity="0.45" />

        {/* 2. (36°) - Radius: 2.5px */}
        <circle cx="72.3" cy="19.3" r="2.5" fill="#38BDF8" opacity="0.5" />

        {/* 3. (72°) - Radius: 3.0px */}
        <circle cx="86.1" cy="38.3" r="3.0" fill="#38BDF8" opacity="0.55" />

        {/* 4. (108°) - Radius: 3.5px */}
        <circle cx="86.1" cy="61.7" r="3.5" fill="#38BDF8" opacity="0.65" />

        {/* 5. (144°) - Radius: 4.0px */}
        <circle cx="72.3" cy="80.7" r="4.0" fill="#38BDF8" opacity="0.75" />

        {/* 6. (180° - Bottom) - Radius: 4.5px */}
        <circle cx="50" cy="88" r="4.5" fill="#38BDF8" opacity="0.85" />

        {/* 7. (216°) - Radius: 5.0px */}
        <circle cx="27.7" cy="80.7" r="5.0" fill="#38BDF8" opacity="0.9" />

        {/* 8. (252°) - Radius: 5.5px */}
        <circle cx="13.9" cy="61.7" r="5.5" fill="#38BDF8" opacity="0.95" />

        {/* 9. (288°) - Radius: 6.0px */}
        <circle cx="13.9" cy="38.3" r="6.0" fill="#38BDF8" opacity="1.0" />

        {/* 10. (324°) - Radius: 6.5px */}
        <circle cx="27.7" cy="19.3" r="6.5" fill="#38BDF8" opacity="1.0" />
      </svg>

      {/* Gentle Pulsing Text */}
      <span className="text-xs font-semibold tracking-wider text-sky-400 animate-pulse">
        {text}
      </span>
    </div>
  );
}
