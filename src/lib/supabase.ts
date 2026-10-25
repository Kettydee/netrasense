// NetraSense — Supabase persistence layer (Step 7 integration)
//
// Purpose:
//   - Publish fusion-state records from the production fusion pipeline.
//   - Publish alert-log entries for state transitions and warning events.
//
// Safety:
//   - Requires Supabase service-role credentials: SUPABASE_URL and
//     SUPABASE_SERVICE_ROLE_KEY (set as environment variables, never in
//     source control).
//   - Writes are best-effort.  A missing or invalid credential leaves the
//     application fully functional; the API returns a graceful degradation
//     rather than a hard failure.
//   - Credentials are loaded only on the server side.  The browser never
//     receives service-role keys.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

type Env = Record<string, string | undefined>;

function envOr(env: Env, key: string): string | undefined {
  return env[key];
}

const SUPABASE_URL =
  envOr(import.meta.env, "VITE_SUPABASE_URL") ?? envOr(process.env, "SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  envOr(import.meta.env, "SUPABASE_SERVICE_ROLE_KEY") ??
  envOr(process.env, "SUPABASE_SERVICE_ROLE_KEY");

let _client: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseClient(): ReturnType<typeof createClient<Database>> | null {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return null;
    }
    try {
      _client = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: {
          fetch: async (input, init) => {
            const res = await fetch(input, init);
            if (!res.ok) {
              // Preserve the original error shape for callers.
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? `Supabase HTTP ${res.status}`);
            }
            return res;
          },
        },
      });
    } catch {
      return null;
    }
  }
  return _client;
}

export type FusionStateRecord = Database["public"]["Tables"]["fusion_state_sessions"]["Row"];
export type AlertLogRecord = Database["public"]["Tables"]["alert_logs"]["Row"];

/**
 * Publish a production fusion-state record.
 *
 * Returns true when the record was inserted.  Returns false when
 * Supabase is not configured or the insert failed.
 */
export async function publishFusionState(record: FusionStateRecord): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    return false;
  }

  try {
    await client.from("fusion_state_sessions").insert(record).select().single();
    return true;
  } catch {
    return false;
  }
}

/**
 * Append an alert-log entry.
 *
 * On success the entry is published to the alert_logs table.  Returns true
 * when the write succeeded; false otherwise.
 */
export async function publishAlertLog(record: AlertLogRecord): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    return false;
  }

  try {
    await client.from("alert_logs").insert(record).select().single();
    return true;
  } catch {
    return false;
  }
}

/**
 * Read recent fusion-state records for a user.
 *
 * Returns an empty array when Supabase is not configured.  Callers must
 * treat an empty array as "no data yet", not as a success.
 */
export async function readFusionStateRecords(
  userId: string,
  limit = 50,
): Promise<FusionStateRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from("fusion_state_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }
    return data ?? [];
  } catch {
    return [];
  }
}

export const SUPABASE_UTILS = {
  getSupabaseClient,
  publishFusionState,
  publishAlertLog,
  readFusionStateRecords,
};
