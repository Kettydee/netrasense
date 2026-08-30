import { useState, useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Menu,
  X,
  LayoutDashboard,
  User,
  Siren,
  FileText,
  Settings,
  LogOut,
  Radio,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fetchSensorTelemetry } from "@/lib/sensor";

// --- Precision Framed Eye Logo Component ---
function NetraSenseFramedEye({ className = "h-8.5 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0`}
      aria-label="NetraSense Eye Logo"
    >
      {/* Outer Golden Target Reticle Frame */}
      <path
        d="M 22 10 L 10 10 L 10 22 M 78 10 L 90 10 L 90 22 M 10 78 L 10 90 L 22 90 M 90 78 L 90 90 L 78 90"
        stroke="#D4AF37"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Main Eye Contour (Cyan / Deep Teal) */}
      <path
        d="M 14 50 C 28 26, 72 26, 86 50 C 72 74, 28 74, 14 50 Z"
        stroke="#0F52BA"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Outer Golden Concentric Ring */}
      <circle cx="50" cy="50" r="22" stroke="#D4AF37" strokeWidth="5.5" fill="none" />

      {/* Inner Deep Blue Pupil */}
      <circle cx="50" cy="50" r="14" fill="#0F52BA" />

      {/* White Optical Reflection Spot */}
      <circle cx="55" cy="45" r="4" fill="#FFFFFF" />
    </svg>
  );
}

interface AppShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}

const NAV_GROUPS = [
  {
    category: "OVERVIEW",
    items: [{ to: "/dashboard", label: "Live Command Center", icon: LayoutDashboard }],
  },
  {
    category: "MONITORING",
    items: [{ to: "/logs", label: "Telemetry History", icon: FileText }],
  },
  {
    category: "SAFETY",
    items: [{ to: "/contacts", label: "Emergency & Contacts", icon: Siren }],
  },
  {
    category: "SYSTEM",
    items: [
      { to: "/profile", label: "Device & Profile", icon: User },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

type ThemeMode = "light" | "dark" | "system";

export function AppShell({ title, description, children, actions }: AppShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const { signOut } = useAuth();

  useEffect(() => {
    const savedTheme = (localStorage.getItem("netrasense:theme") as ThemeMode) || "system";
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  const applyTheme = (mode: ThemeMode) => {
    const root = document.documentElement;
    if (mode === "dark") {
      root.classList.add("dark");
    } else if (mode === "light") {
      root.classList.remove("dark");
    } else {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    localStorage.setItem("netrasense:theme", newTheme);
    applyTheme(newTheme);
  };

  const handleSignOut = async () => {
    try {
      if (signOut) await signOut();
    } catch {
      // safe fallback
    }
    window.location.href = "/";
  };

  const handleSos = () => {
    window.location.href = "/contacts";
  };

  const sensorQuery = useQuery({
    queryKey: ["sensor-status-sidebar"],
    queryFn: fetchSensorTelemetry,
    refetchInterval: 4000,
    retry: false,
  });

  const isSensorConnected = !!sensorQuery.data?.sensor_status.connected;

  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-x-hidden transition-colors">
      {/* --- COLLAPSIBLE COMMAND SIDEBAR --- */}
      <aside
        className={`relative flex flex-col justify-between border-r border-border bg-card transition-all duration-200 ease-in-out z-30 shrink-0 ${
          isSidebarOpen ? "w-64 p-5" : "w-20 p-3 items-center"
        }`}
      >
        <div className="w-full">
          {/* Top Branding Section */}
          <div
            className={`flex items-center ${isSidebarOpen ? "justify-between" : "justify-center"}`}
          >
            {isSidebarOpen && (
              <Link to="/dashboard" className="flex items-center gap-3 overflow-hidden group">
                <NetraSenseFramedEye className="h-8 w-auto max-w-[40px] group-hover:scale-105 transition-transform duration-200" />
                <div className="flex flex-col">
                  <span className="text-lg font-black tracking-tight truncate text-foreground">
                    NETRASENSE
                  </span>
                  <span className="text-[10px] font-bold tracking-widest text-primary uppercase">
                    Obsidian Command
                  </span>
                </div>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isSidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>

          {/* Grouped Command Navigation */}
          <nav className="mt-6 flex flex-col gap-5 w-full" aria-label="Sidebar Navigation">
            {NAV_GROUPS.map((group) => (
              <div key={group.category} className="flex flex-col gap-1.5">
                {isSidebarOpen && (
                  <span className="px-3 text-[10px] font-extrabold tracking-widest text-muted-foreground uppercase">
                    {group.category}
                  </span>
                )}
                {group.items.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={`${group.category}-${to}`}
                    to={to}
                    activeProps={{
                      className:
                        "bg-primary/10 text-primary border-l-2 border-primary font-bold shadow-2xs dark:bg-sky-500/10 dark:text-cyan-300 dark:border-cyan-400",
                    }}
                    inactiveProps={{
                      className:
                        "text-muted-foreground hover:bg-muted/80 hover:text-foreground border-l-2 border-transparent",
                    }}
                    className={`flex w-full items-center rounded-r-xl px-3 py-2 text-sm font-medium transition-colors ${
                      isSidebarOpen ? "gap-3 justify-start" : "justify-center rounded-xl"
                    }`}
                    title={!isSidebarOpen ? label : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {isSidebarOpen && <span className="truncate">{label}</span>}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Section: Theme Switcher & Device Status */}
        <div className="mt-auto flex flex-col gap-3 pt-4 border-t border-border w-full">
          {/* Theme Switcher */}
          <div className="flex w-full items-center justify-center rounded-xl border border-border bg-muted/40 p-1">
            {isSidebarOpen ? (
              <div className="grid w-full grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => handleThemeChange("light")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-semibold transition-all ${
                    theme === "light"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sun className="size-3 text-amber-500" />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeChange("dark")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-semibold transition-all ${
                    theme === "dark"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Moon className="size-3 text-primary" />
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeChange("system")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-semibold transition-all ${
                    theme === "system"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Laptop className="size-3" />
                  Auto
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  handleThemeChange(
                    theme === "dark" ? "light" : theme === "light" ? "system" : "dark",
                  )
                }
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                title={`Theme: ${theme}`}
              >
                {theme === "light" && <Sun className="size-4 text-amber-500" />}
                {theme === "dark" && <Moon className="size-4 text-primary" />}
                {theme === "system" && <Laptop className="size-4" />}
              </button>
            )}
          </div>

          {/* Arduino Device Status Pill */}
          {isSidebarOpen ? (
            <div
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[11px] font-bold tracking-wider uppercase transition-colors ${
                isSensorConnected
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-500"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`size-2 rounded-full animate-pulse ${
                    isSensorConnected ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="truncate">
                  {isSensorConnected ? "DEVICE ONLINE" : "DEVICE STANDBY"}
                </span>
              </div>
              <span className="font-mono text-[9px] opacity-70">
                {isSensorConnected ? "ARDUINO" : "SEARCHING"}
              </span>
            </div>
          ) : (
            <div
              className="flex justify-center"
              title={isSensorConnected ? "DEVICE ONLINE" : "DEVICE STANDBY"}
            >
              <span
                className={`size-3 rounded-full animate-pulse ${
                  isSensorConnected ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
            </div>
          )}

          {/* Logout Button */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleSignOut}
            className={`w-full text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer ${
              !isSidebarOpen ? "px-0 justify-center" : "justify-start"
            }`}
            title="Log out"
          >
            <LogOut className="size-4 shrink-0" />
            {isSidebarOpen && <span className="ml-2">Log out</span>}
          </Button>
        </div>
      </aside>

      {/* --- MAIN CONTENT VIEWPORT --- */}
      <main className="flex-1 overflow-y-auto px-6 py-8 transition-all duration-300 ease-in-out max-w-full">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border/50 pb-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          </div>

          <div className="flex items-center gap-3">
            {actions}

            <button
              type="button"
              onClick={handleSos}
              className="inline-flex items-center gap-3 rounded-2xl bg-red-600 px-6 py-3 text-base font-extrabold tracking-wide text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] border border-red-400/60 hover:bg-red-500 hover:shadow-[0_0_28px_rgba(239,68,68,0.65)] hover:border-red-300 transition-all duration-200 cursor-pointer active:scale-95"
              title="Broadcast SOS Emergency Alert"
            >
              <Siren className="size-5 animate-bounce text-white shrink-0" />
              <span>BROADCAST SOS</span>
            </button>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
