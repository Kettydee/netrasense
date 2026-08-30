import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { fetchTelemetry } from "@/lib/queries";
import { THREAT_LEVELS, threatStyles, toCsv } from "@/lib/netrasense";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Incident & Telemetry Logs — NetraSense" },
      {
        name: "description",
        content:
          "Search, filter and export every obstacle detection recorded by your assistive sensor.",
      },
      { property: "og:title", content: "Incident & Telemetry Logs — NetraSense" },
      {
        property: "og:description",
        content: "Full history of obstacle detections with CSV export.",
      },
    ],
  }),
  component: LogsPage,
});

function LogsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");

  const telemetryQuery = useQuery({
    queryKey: ["telemetry", userId, "all"],
    enabled: !!userId,
    queryFn: () => fetchTelemetry(500),
  });

  const rows = useMemo(() => {
    const all = telemetryQuery.data ?? [];
    return all.filter(
      (r) =>
        (level === "all" || r.threat_level === level) &&
        r.detected_object.toLowerCase().includes(search.trim().toLowerCase()),
    );
  }, [telemetryQuery.data, level, search]);

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `netrasense-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const criticalCount = useMemo(
    () =>
      (telemetryQuery.data ?? []).filter(
        (r) => r.threat_level === "Collision" || r.threat_level === "Alarming",
      ).length,
    [telemetryQuery.data],
  );

  const avgDistance = useMemo(() => {
    const data = telemetryQuery.data ?? [];
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, r) => acc + Number(r.distance_cm), 0);
    return Math.round(sum / data.length);
  }, [telemetryQuery.data]);

  return (
    <AppShell
      title="Incident & Telemetry Logs"
      description="Every reading recorded by your assistive sensor"
    >
      {/* Metrics Summary Row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="surface-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total Records
            </p>
            <p className="text-2xl font-black">{telemetryQuery.data?.length ?? 0}</p>
          </div>
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Search className="size-5" />
          </div>
        </div>

        <div className="surface-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              High Risk Alerts
            </p>
            <p className="text-2xl font-black text-rose-500">{criticalCount}</p>
          </div>
          <div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-500">
            <span className="size-3 rounded-full bg-rose-500 animate-ping inline-block" />
          </div>
        </div>

        <div className="surface-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Avg Proximity
            </p>
            <p className="text-2xl font-black">{avgDistance} cm</p>
          </div>
          <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-500 font-bold text-xs">CM</div>
        </div>
      </div>

      <section aria-labelledby="filters-heading" className="surface-card mb-5 p-5">
        <h2 id="filters-heading" className="text-lg font-bold">
          Filter records
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_14rem_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="log-search">Search detected object</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="log-search"
                className="pl-9"
                placeholder="Stairs, vehicle, pole…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="log-level">Threat classification</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger id="log-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {THREAT_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download aria-hidden="true" className="size-4" />
            Export CSV
          </Button>
        </div>
      </section>

      <section aria-labelledby="table-heading" className="surface-card overflow-hidden">
        <h2 id="table-heading" className="border-b border-border p-5 text-lg font-bold">
          {rows.length} record{rows.length === 1 ? "" : "s"}
        </h2>
        {telemetryQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No telemetry records match your filters yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <caption className="sr-only">Historical obstacle detection records</caption>
              <thead className="bg-muted/40 border-b border-border text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3.5">
                    Timestamp
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Detected Object
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Distance
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Threat Level
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Action Taken
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
                      {new Date(r.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-3 font-bold text-foreground">{r.detected_object}</td>
                    <td className="px-5 py-3 font-mono text-sm font-extrabold text-foreground tabular-nums">
                      {Math.round(Number(r.distance_cm))} cm
                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                        ({(Number(r.distance_cm) / 100).toFixed(2)}m)
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-lg px-2.5 py-1 text-xs font-black uppercase tracking-wider border ${
                          r.threat_level === "Collision"
                            ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                            : r.threat_level === "Alarming"
                              ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                              : r.threat_level === "Warning"
                                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        }`}
                      >
                        {r.threat_level}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {r.action_taken ?? "Logged"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
