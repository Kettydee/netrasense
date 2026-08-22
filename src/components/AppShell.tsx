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

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

// --- Embedded NetraSense Eye Logo Graphic ---
function NetraSenseEyeLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 140 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0`}
      aria-label="NetraSense Logo"
    >
      {/* Outer Sweeping Brow Lines */}
      <path
        d="M 12 42 C 28 16, 75 14, 102 34"
        stroke="#104f86"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M 22 38 C 36 24, 70 22, 92 37"
        stroke="#104f86"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Lower Eye Contour */}
      <path
        d="M 28 44 C 44 64, 80 62, 96 44"
        stroke="#104f86"
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Center Iris & Pupil */}
      <circle cx="62" cy="40" r="16" stroke="#104f86" strokeWidth="5" fill="none" />
      <circle cx="62" cy="40" r="8" fill="#104f86" />
      <circle cx="65" cy="37" r="2.5" fill="#ffffff" />

      {/* Teardrop Vision Loop */}
      <path
        d="M 94 36 C 102 24, 118 26, 118 40 C 118 58, 94 72, 94 56 C 94 45, 108 38, 113 44"
        stroke="#104f86"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

interface AppShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Realtime Dashboard", icon: LayoutDashboard },
  { to: "/profile", label: "User Profile & Medical ID", icon: User },
  { to: "/contacts", label: "Emergency Contacts Hub", icon: Siren },
  { to: "/logs", label: "Incident & Telemetry Logs", icon: FileText },
  { to: "/settings", label: "Settings & Audio Preferences", icon: Settings },
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

  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-x-hidden transition-colors">
      {/* --- COLLAPSIBLE LEFT SIDEBAR --- */}
      <aside
        className={`relative flex flex-col justify-between border-r border-border bg-card/80 backdrop-blur-md transition-all duration-300 ease-in-out z-30 shrink-0 ${
          isSidebarOpen ? "w-64 p-5" : "w-20 p-3 items-center"
        }`}
      >
        <div className="w-full">
          {/* Top Branding with Embedded Blue Eye Logo */}
          <div className={`flex items-center ${isSidebarOpen ? "justify-between" : "justify-center"}`}>
            {isSidebarOpen && (
              <Link to="/dashboard" className="flex items-center gap-2.5 overflow-hidden group">
                <NetraSenseEyeLogo className="h-8 w-auto max-w-[44px]" />
                <span className="text-lg font-black tracking-tight truncate text-foreground">
                  NetraSense
                </span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isSidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="mt-4 flex w-full items-center justify-center rounded-xl border border-border bg-muted/40 p-1">
            {isSidebarOpen ? (
              <div className="grid w-full grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => handleThemeChange("light")}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    theme === "light"
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Light Theme"
                >
                  <Sun className="size-3.5" />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeChange("dark")}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    theme === "dark"
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Dark Theme"
                >
                  <Moon className="size-3.5" />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeChange("system")}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    theme === "system"
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="System Default"
                >
                  <Laptop className="size-3.5" />
                  <span>Auto</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleThemeChange(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                title={`Current Theme: ${theme.toUpperCase()} (Click to cycle)`}
              >
                {theme === "light" && <Sun className="size-4 text-amber-500" />}
                {theme === "dark" && <Moon className="size-4 text-primary" />}
                {theme === "system" && <Laptop className="size-4" />}
              </button>
            )}
          </div>

          {/* ESP32 Status Pill */}
          {isSidebarOpen ? (
            <div className="mt-4 inline-flex w-full items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-semibold text-live">
              <Radio className="size-3.5 animate-pulse text-live shrink-0" />
              <span className="truncate">ESP32 Live Stream: Connected</span>
            </div>
          ) : (
            <div className="mt-4 flex justify-center" title="ESP32 Live Stream: Connected">
              <Radio className="size-4 animate-pulse text-live" />
            </div>
          )}

          {/* Navigation Items */}
          <nav className="mt-6 flex flex-col gap-2 w-full" aria-label="Sidebar Navigation">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeProps={{
                  className: "bg-primary text-primary-foreground shadow-sm font-semibold",
                }}
                inactiveProps={{
                  className: "text-muted-foreground hover:bg-muted hover:text-foreground",
                }}
                className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isSidebarOpen ? "gap-3 justify-start" : "justify-center"
                }`}
                title={!isSidebarOpen ? label : undefined}
              >
                <Icon className="size-5 shrink-0" />
                {isSidebarOpen && <span className="truncate">{label}</span>}
              </Link>
            ))}
          </nav>
        </div>

        {/* Logout Button */}
        <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-border w-full">
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