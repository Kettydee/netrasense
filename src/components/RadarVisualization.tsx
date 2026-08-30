import { useMemo } from "react";
import type { ThreatLevel } from "@/lib/netrasense";

interface DetectedRadarItem {
  id: string;
  label: string;
  distance_cm: number;
  direction: "left" | "center" | "right";
  threat_level: ThreatLevel;
  motion_state?: string;
}

interface RadarVisualizationProps {
  items: DetectedRadarItem[];
  currentDistanceCm?: number;
  currentThreatLevel?: ThreatLevel;
  className?: string;
}

export function RadarVisualization({
  items,
  currentDistanceCm,
  currentThreatLevel = "Normal",
  className = "",
}: RadarVisualizationProps) {
  // Map directional zone to angle in degrees (center = 90° up, left = 45°, right = 135°)
  const activeItems = useMemo(() => {
    if (items.length > 0) return items;
    if (currentDistanceCm !== undefined) {
      return [
        {
          id: "primary-sensor",
          label: "Obstacle",
          distance_cm: currentDistanceCm,
          direction: "center" as const,
          threat_level: currentThreatLevel,
        },
      ];
    }
    return [];
  }, [items, currentDistanceCm, currentThreatLevel]);

  const threatColorMap: Record<ThreatLevel, { stroke: string; fill: string; text: string }> = {
    Normal: { stroke: "#10B981", fill: "rgba(16, 185, 129, 0.15)", text: "#10B981" },
    Warning: { stroke: "#F59E0B", fill: "rgba(245, 158, 11, 0.15)", text: "#F59E0B" },
    Alarming: { stroke: "#F97316", fill: "rgba(249, 115, 22, 0.2)", text: "#F97316" },
    Collision: { stroke: "#EF4444", fill: "rgba(239, 68, 68, 0.25)", text: "#EF4444" },
  };

  return (
    <div
      aria-label="Spatial Radar Visualization"
      className={`relative flex flex-col items-center justify-center rounded-2xl border border-border bg-card/60 p-4 sm:p-6 backdrop-blur-xs ${className}`}
    >
      <div className="w-full flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
          <h3 className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Spatial Radar Environment
          </h3>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          MAX 400 CM · 180° FIELD OF VIEW
        </span>
      </div>

      <svg
        viewBox="0 0 300 200"
        className="w-full max-w-md h-auto overflow-visible select-none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Radial radar grid background */}
          <radialGradient id="radarSweep" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor="#5EE7FF" stopOpacity="0.08" />
            <stop offset="60%" stopColor="#5EE7FF" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#5EE7FF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer Background Arc Fill */}
        <path d="M 20 180 A 130 130 0 0 1 280 180 Z" fill="url(#radarSweep)" stroke="none" />

        {/* Concentric Distance Arcs */}
        {/* 3m Arc (outer) */}
        <path
          d="M 20 180 A 130 130 0 0 1 280 180"
          stroke="#202A36"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />
        <text x="282" y="184" fill="#8B98A9" fontSize="9" fontFamily="monospace">
          3m
        </text>

        {/* 2m Arc (middle) */}
        <path
          d="M 60 180 A 90 90 0 0 1 240 180"
          stroke="#202A36"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />
        <text x="242" y="184" fill="#8B98A9" fontSize="9" fontFamily="monospace">
          2m
        </text>

        {/* 1m Arc (inner threat threshold) */}
        <path
          d="M 100 180 A 50 50 0 0 1 200 180"
          stroke="#202A36"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />
        <text x="202" y="184" fill="#8B98A9" fontSize="9" fontFamily="monospace">
          1m
        </text>

        {/* Radial Sector Zone Lines (Left, Center, Right split) */}
        <line
          x1="150"
          y1="180"
          x2="35"
          y2="65"
          stroke="#202A36"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />
        <line
          x1="150"
          y1="180"
          x2="150"
          y2="35"
          stroke="#202A36"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />
        <line
          x1="150"
          y1="180"
          x2="265"
          y2="65"
          stroke="#202A36"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="dark:stroke-[#202A36] stroke-[#E6EAF0]"
        />

        {/* Sector Labels */}
        <text x="50" y="55" fill="#8B98A9" fontSize="10" fontWeight="600" textAnchor="middle">
          LEFT
        </text>
        <text x="150" y="25" fill="#8B98A9" fontSize="10" fontWeight="600" textAnchor="middle">
          CENTER
        </text>
        <text x="250" y="55" fill="#8B98A9" fontSize="10" fontWeight="600" textAnchor="middle">
          RIGHT
        </text>

        {/* Center USER Marker */}
        <circle
          cx="150"
          cy="180"
          r="14"
          fill="#5EE7FF"
          fillOpacity="0.15"
          stroke="#5EE7FF"
          strokeWidth="1.5"
        />
        <circle cx="150" cy="180" r="4" fill="#5EE7FF" />
        <text
          x="150"
          y="196"
          fill="#5EE7FF"
          fontSize="9"
          fontWeight="700"
          textAnchor="middle"
          letterSpacing="0.5"
        >
          USER
        </text>

        {/* Render Detected Objects Polar Coordinates */}
        {activeItems.map((item) => {
          const maxDistCm = 400;
          const clampedDist = Math.max(10, Math.min(maxDistCm, item.distance_cm));
          // Radius in SVG pixels: 180 at center, max radius = 130px
          const r = (clampedDist / maxDistCm) * 130;

          let angleDeg = 90; // center
          if (item.direction === "left") angleDeg = 45;
          if (item.direction === "right") angleDeg = 135;

          const angleRad = (angleDeg * Math.PI) / 180;
          // polar to SVG cartesian: cx = 150 - r * cos(angleRad), cy = 180 - r * sin(angleRad)
          const px = 150 - r * Math.cos(angleRad);
          const py = 180 - r * Math.sin(angleRad);

          const colors = threatColorMap[item.threat_level] || threatColorMap.Normal;

          return (
            <g key={item.id || `${item.label}-${item.distance_cm}`}>
              {/* Radar pulse ring */}
              <circle
                cx={px}
                cy={py}
                r="10"
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth="1.5"
                className="animate-ping [animation-duration:2.5s]"
              />
              <circle cx={px} cy={py} r="5" fill={colors.stroke} />

              {/* Data Tag Box */}
              <rect
                x={px - 32}
                y={py - 24}
                width="64"
                height="16"
                rx="4"
                fill="#0D1117"
                stroke={colors.stroke}
                strokeWidth="1"
                className="dark:fill-[#0D1117] fill-[#FFFFFF]"
              />
              <text
                x={px}
                y={py - 13}
                fill={colors.text}
                fontSize="9"
                fontWeight="700"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {item.label.toUpperCase()} {(item.distance_cm / 100).toFixed(1)}m
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
