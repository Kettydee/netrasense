import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  UserRound,
  Siren,
  ScrollText,
  Settings,
  Menu,
  LogOut,
  ShieldAlert,
  Radio,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { SosDialog } from "@/components/SosDialog";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Realtime Dashboard", icon: LayoutDashboard },
  { to: "/profile", label: "User Profile & Medical ID", icon: UserRound },
  { to: "/contacts", label: "Emergency Contacts Hub", icon: Siren },
  { to: "/logs", label: "Incident & Telemetry Logs", icon: ScrollText },
  { to: "/settings", label: "Settings & Audio Preferences", icon: Settings },
] as const;

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useAuth();
  const [sosOpen, setSosOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden="true" className="size-6 text-primary" />
          <span className="text-lg font-extrabold tracking-tight">AegisNav</span>
        </div>
        <p
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-live-border bg-live-surface px-3 py-1 text-xs font-bold text-live"
          role="status"
        >
          <Radio aria-hidden="true" className="size-3.5 pulse-threat" />
          ESP32 Live Stream: Connected
        </p>
      </div>

      <nav aria-label="Primary" className="flex-1">
        <ul className="space-y-1.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-primary data-[status=active]:font-bold data-[status=active]:text-primary-foreground"
                activeProps={{ "aria-current": "page" }}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-border pt-4">
        <Button
          variant="destructive"
          size="lg"
          className="w-full text-base font-extrabold uppercase tracking-wide"
          onClick={() => setSosOpen(true)}
        >
          <Siren aria-hidden="true" className="size-5" />
          Broadcast SOS
        </Button>
        <Button variant="outline" className="w-full" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" className="size-4" />
          Log out
        </Button>
      </div>
      <SosDialog open={sosOpen} onOpenChange={setSosOpen} />
    </div>
  );
}

export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside
        aria-label="Sidebar navigation"
        className="hidden w-80 shrink-0 border-r border-border bg-card lg:sticky lg:top-0 lg:block lg:h-screen"
      >
        <SidebarBody />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[88vw] overflow-y-auto border-r border-border bg-card">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
                <X aria-hidden="true" className="size-5" />
              </Button>
            </div>
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-8 lg:py-5">
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold lg:text-2xl">{title}</h1>
            {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
          </div>
        </header>
        <main id="main-content" className={cn("flex-1 px-4 pb-16 pt-5 lg:px-8")}>
          {children}
        </main>
      </div>
    </div>
  );
}
