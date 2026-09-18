import { supabase } from "@/integrations/supabase/client";
import type { Contact, DailyStats, Profile, Telemetry } from "@/lib/netrasense";

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchTelemetry(limit = 200): Promise<Telemetry[]> {
  const { data, error } = await supabase
    .from("telemetry_stream")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type TelemetryPage = {
  rows: Telemetry[];
  totalCount: number;
};

/**
 * Fetch a single page of telemetry records.
 * Also returns the total count for pagination controls.
 */
export async function fetchTelemetryPage(
  page: number,
  pageSize: number,
): Promise<TelemetryPage> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const [pageResult, countResult] = await Promise.all([
    supabase
      .from("telemetry_stream")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from("telemetry_stream")
      .select("id", { count: "exact", head: true }),
  ]);

  if (pageResult.error) throw pageResult.error;
  if (countResult.error) throw countResult.error;

  return {
    rows: pageResult.data ?? [],
    totalCount: countResult.count ?? 0,
  };
}

export async function fetchDailyStats(userId: string): Promise<DailyStats[]> {
  const { data, error } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(365);
  if (error) throw error;
  return data ?? [];
}
