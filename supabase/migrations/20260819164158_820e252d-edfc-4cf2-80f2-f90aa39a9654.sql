CREATE TYPE public.impairment_level AS ENUM ('Partial', 'Legal Blindness', 'Total');
CREATE TYPE public.threat_level AS ENUM ('Normal', 'Warning', 'Alarming', 'Collision');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  age integer,
  blood_group text,
  emergency_medical_notes text,
  impairment_level public.impairment_level,
  home_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  relationship text,
  phone_number text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  notify_on_collision boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own contacts" ON public.emergency_contacts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX emergency_contacts_user_idx ON public.emergency_contacts(user_id);

CREATE TABLE public.telemetry_stream (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  detected_object text NOT NULL,
  distance_cm numeric NOT NULL,
  threat_level public.threat_level NOT NULL DEFAULT 'Normal',
  action_taken text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_stream TO authenticated;
GRANT ALL ON public.telemetry_stream TO service_role;
ALTER TABLE public.telemetry_stream ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own telemetry" ON public.telemetry_stream FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX telemetry_user_created_idx ON public.telemetry_stream(user_id, created_at DESC);

CREATE TABLE public.daily_stats (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  obstacles_avoided integer NOT NULL DEFAULT 0,
  safe_distance_walked_m numeric NOT NULL DEFAULT 0,
  active_session_minutes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_stats TO authenticated;
GRANT ALL ON public.daily_stats TO service_role;
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own stats" ON public.daily_stats FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetry_stream;
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_stats;