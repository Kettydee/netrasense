import { supabase } from "@/integrations/supabase/client";
import type { Contact, DailyStats, Profile, Telemetry } from "@/lib/netrasense";

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
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

export async function fetchDailyStats(userId: string): Promise<DailyStats[]> {
  const { data, error } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(7);
  if (error) throw error;
  return data ?? [];
}
