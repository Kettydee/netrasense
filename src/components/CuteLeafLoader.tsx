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
  const containerSizes = {
    sm: "size-14",
    md: "size-24",
    lg: "size-32",
  };

  return (
    <div
      role="status"
      aria-label={text}
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
    >
      {/* Revolving Orbit Ring */}
      <div className={`relative ${containerSizes[size]} animate-spin [animation-duration:1.8s]`}>
        {/* Bubble 1: Tiny (0° - Top) */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center justify-center">
          <span className="size-1.5 rounded-full bg-sky-300 opacity-60 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
        </div>

        {/* Bubble 2: Small (45° - Top-Right) */}
        <div className="absolute top-[14%] right-[14%] translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          <span className="size-2 rounded-full bg-sky-400 opacity-70 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
        </div>

        {/* Bubble 3: Medium-Small (90° - Right) */}
        <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          <span className="size-2.5 rounded-full bg-sky-400/90 shadow-[0_0_8px_rgba(14,165,233,0.9)]" />
        </div>

        {/* Bubble 4: Medium (135° - Bottom-Right) */}
        <div className="absolute bottom-[14%] right-[14%] translate-x-1/2 translate-y-1/2 flex items-center justify-center">
          <span className="size-3.5 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.9)]" />
        </div>

        {/* Bubble 5: Medium-Large (180° - Bottom) */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center justify-center">
          <span className="size-4 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(37,99,235,0.9)]" />
        </div>

        {/* Bubble 6: Large (225° - Bottom-Left) */}
        <div className="absolute bottom-[14%] left-[14%] -translate-x-1/2 translate-y-1/2 flex items-center justify-center">
          <span className="size-4.5 rounded-full bg-blue-600 shadow-[0_0_14px_rgba(37,99,235,1)]" />
        </div>

        {/* Bubble 7: Extra-Large (270° - Left) */}
        <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          <span className="size-5 rounded-full bg-indigo-600 shadow-[0_0_16px_rgba(79,70,229,1)]" />
        </div>

        {/* Bubble 8: Jumbo (315° - Top-Left) */}
        <div className="absolute top-[14%] left-[14%] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          <span className="size-5.5 rounded-full bg-gradient-to-tr from-blue-700 via-sky-500 to-cyan-300 shadow-[0_0_18px_rgba(14,165,233,1)]" />
        </div>
      </div>

      {/* Pulsing Loading Caption */}
      <span className="text-sm font-bold tracking-wider text-sky-600 dark:text-sky-400 animate-pulse">
        {text}
      </span>
    </div>
  );
}
