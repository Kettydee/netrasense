import { Leaf } from "lucide-react";

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
    sm: "size-10",
    md: "size-16",
    lg: "size-24",
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
      {/* Revolving Leaf Ring */}
      <div className={`relative ${sizeClasses[size]} animate-spin [animation-duration:2.5s]`}>
        {/* Leaf 1 - North */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
          <Leaf className={`${leafSizes[size]} text-emerald-500 fill-emerald-400 rotate-12 drop-shadow-sm`} />
        </div>

        {/* Leaf 2 - East */}
        <div className="absolute top-1/2 right-0 translate-x-1 -translate-y-1/2">
          <Leaf className={`${leafSizes[size]} text-green-500 fill-green-400 rotate-90 drop-shadow-sm`} />
        </div>

        {/* Leaf 3 - South */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1">
          <Leaf className={`${leafSizes[size]} text-teal-500 fill-teal-400 rotate-180 drop-shadow-sm`} />
        </div>

        {/* Leaf 4 - West */}
        <div className="absolute top-1/2 left-0 -translate-x-1 -translate-y-1/2">
          <Leaf className={`${leafSizes[size]} text-emerald-600 fill-emerald-500 -rotate-90 drop-shadow-sm`} />
        </div>
      </div>

      {/* Pulsing Loading Label */}
      <span className="text-sm font-bold tracking-wide text-emerald-600 dark:text-emerald-400 animate-pulse">
        {text}
      </span>
    </div>
  );
}
