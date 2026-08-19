import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { fetchTelemetry } from "@/lib/queries";
import { THREAT_LEVELS, threatStyles, toCsv } from "@/lib/aegis";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Incident & Telemetry Logs — AegisNav" },
      { name: "description", content: "Search, filter and export every obstacle detection recorded by your assistive sensor." },
      { property: "og:title", content: "Incident & Telemetry Logs — AegisNav" },
      { property: "og:description", content: "Full history of obstacle detections with CSV export." },
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
    link.download = `aegisnav-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Incident & Telemetry Logs" description="Every reading recorded by your assistive sensor">
      <section aria-labelledby="filters-heading" className="surface-card mb-5 p-5">
        <h2 id="filters-heading" className="text-lg font-bold">
          Filter records
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_14rem_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="log-search">Search detected object</Label>
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
              <thead className="bg-surface">
                <tr>
                  <th scope="col" className="px-5 py-3 font-bold">Timestamp</th>
                  <th scope="col" className="px-5 py-3 font-bold">Detected object</th>
                  <th scope="col" className="px-5 py-3 font-bold">Distance (cm)</th>
                  <th scope="col" className="px-5 py-3 font-bold">Threat classification</th>
                  <th scope="col" className="px-5 py-3 font-bold">Action taken</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-5 py-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3 font-semibold">{r.detected_object}</td>
                    <td className="px-5 py-3">{Math.round(Number(r.distance_cm))}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${threatStyles[r.threat_level].badge}`}>
                        {r.threat_level}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.action_taken ?? "Logged"}</td>
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
