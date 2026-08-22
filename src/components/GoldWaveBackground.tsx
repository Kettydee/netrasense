export function GoldWaveBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none"
    >
      {/* Ambient Deep Dark Base Radial Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-500/[0.04] via-transparent to-transparent" />

      {/* SVG Wave Streams */}
      <svg
        className="absolute -top-24 -left-20 w-[140vw] max-w-none h-[120vh] opacity-20 dark:opacity-25"
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gold Gradient Stream 1 */}
          <linearGradient id="gold-stream-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0" />
            <stop offset="35%" stopColor="#FBBF24" stopOpacity="0.4" />
            <stop offset="60%" stopColor="#D97706" stopOpacity="0.6" />
            <stop offset="85%" stopColor="#FDE68A" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#B45309" stopOpacity="0" />
          </linearGradient>

          {/* Gold Gradient Stream 2 */}
          <linearGradient id="gold-stream-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#D97706" stopOpacity="0" />
            <stop offset="40%" stopColor="#FDE68A" stopOpacity="0.35" />
            <stop offset="70%" stopColor="#F59E0B" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#78350F" stopOpacity="0" />
          </linearGradient>

          {/* Particle Glow Filter */}
          <filter id="gold-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Dynamic Curved Ribbon Paths */}
        <path
          d="M -100 250 C 300 50, 650 450, 1100 220 C 1300 120, 1500 280, 1650 350"
          stroke="url(#gold-stream-1)"
          strokeWidth="3.5"
          filter="url(#gold-glow)"
          strokeLinecap="round"
        />
        <path
          d="M -50 300 C 350 110, 720 500, 1150 260 C 1350 160, 1520 320, 1700 390"
          stroke="url(#gold-stream-1)"
          strokeWidth="1.5"
          strokeOpacity="0.7"
        />
        <path
          d="M -120 400 C 250 200, 600 620, 1050 380 C 1280 260, 1480 440, 1600 520"
          stroke="url(#gold-stream-2)"
          strokeWidth="2.5"
          filter="url(#gold-glow)"
          strokeLinecap="round"
        />
        <path
          d="M 100 580 C 450 360, 800 750, 1250 500 C 1420 400, 1580 580, 1750 630"
          stroke="url(#gold-stream-2)"
          strokeWidth="1"
          strokeDasharray="6 8"
          strokeOpacity="0.5"
        />

        {/* Shimmer Stardust Specks */}
        <circle cx="280" cy="180" r="1.5" fill="#FDE68A" opacity="0.6" className="animate-pulse" />
        <circle cx="420" cy="280" r="2" fill="#FBBF24" opacity="0.7" />
        <circle cx="780" cy="380" r="1.2" fill="#FDE68A" opacity="0.5" />
        <circle cx="920" cy="310" r="2.2" fill="#F59E0B" opacity="0.65" className="animate-pulse" />
        <circle cx="1120" cy="240" r="1.8" fill="#FDE68A" opacity="0.7" />
        <circle cx="1280" cy="340" r="1.2" fill="#FBBF24" opacity="0.4" />
        <circle cx="650" cy="520" r="1.6" fill="#FDE68A" opacity="0.6" />
        <circle cx="850" cy="460" r="2" fill="#F59E0B" opacity="0.55" className="animate-pulse" />
      </svg>
    </div>
  );
}
