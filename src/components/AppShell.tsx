import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShieldAlert,
  Menu,
  X,
  LayoutDashboard,
  User,
  Siren,
  FileText,
  Settings,
  LogOut,
  Radio,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

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

export function AppShell({ title, description, children, actions }: AppShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      if (signOut) await signOut();
    } catch {
      // safe fallback
    }
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* --- COLLAPSIBLE SIDEBAR --- */}
      <aside
        className={`relative flex flex-col justify-between border-r border-border bg-card/70 backdrop-blur-md transition-all duration-300 ease-in-out z-30 shrink-0 ${
          isSidebarOpen ? "w-64 p-5" : "w-20 p-3 items-center"
        }`}
      >
        <div className="w-full">
          {/* Top Branding & 3-Lines Toggle */}
          <div className={`flex items-center ${isSidebarOpen ? "justify-between" : "justify-center"}`}>
            {isSidebarOpen && (
              <Link to="/dashboard" className="flex items-center gap-2 overflow-hidden">
                <ShieldAlert aria-hidden="true" className="size-6 shrink-0 text-primary" />
                <span className="text-lg font-extrabold tracking-tight truncate">NetraSense</span>
              </Link>
            )}

            {/* 3-Lines Hamburger Button */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isSidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>

          {/* ESP32 Live Stream Status Pill */}
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

        {/* Bottom Actions: SOS & Logout */}
        <div className="mt-auto flex flex-col gap-3 pt-4 border-t border-border w-full">
          <Button
            variant="destructive"
            className={`w-full font-bold cursor-pointer ${!isSidebarOpen ? "px-0 justify-center" : ""}`}
            title="Broadcast SOS"
          >
            <Siren className="size-4 shrink-0" />
            {isSidebarOpen && <span className="ml-2">BROADCAST SOS</span>}
          </Button>

          <Button
            variant="ghost"
            onClick={handleSignOut}
            className={`w-full text-muted-foreground hover:text-foreground cursor-pointer ${
              !isSidebarOpen ? "px-0 justify-center" : ""
            }`}
            title="Log out"
          >
            <LogOut className="size-4 shrink-0" />
            {isSidebarOpen && <span className="ml-2">Log out</span>}
          </Button>
        </div>
      </aside>

      {/* --- DYNAMIC EXPANDABLE MAIN CONTENT VIEWPORT --- */}
      <main className="flex-1 overflow-y-auto px-6 py-8 transition-all duration-300 ease-in-out max-w-full">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>

        {children}
      </main>
    </div>
  );
}