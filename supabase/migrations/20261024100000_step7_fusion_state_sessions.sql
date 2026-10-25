-- Step 7: Fusion-state telemetry persistence
-- Stores the authoritative fusion output from the production pipeline for
-- historical review.  This is telemetry, not performance evidence.
--
-- Migration guidance:
--   1. Apply with:  psql -U postgres -d <DATABASE_URL> -f this_file.sql
--   2. Or paste into the Supabase SQL editor.
--   3. Requires the public schema to exist.
--
-- No data is written until the environment provides SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS public.fusion_state_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    scenario_id text NOT NULL,
    timestamp timestamptz NOT NULL,
    fused_threat_level text NOT NULL,
    sensing_state text NOT NULL,
    fused_distance_cm numeric,
    confidence numeric NOT NULL DEFAULT 0.0,
    fresh boolean NOT NULL DEFAULT false,
    age_seconds double precision,
    signal_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.fusion_state_sessions TO authenticated;
GRANT ALL ON public.fusion_state_sessions TO service_role;

ALTER TABLE public.fusion_state_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own fusion-state" ON public.fusion_state_sessions
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_fusion_state_user ON public.fusion_state_sessions(user_id, timestamp DESC);
