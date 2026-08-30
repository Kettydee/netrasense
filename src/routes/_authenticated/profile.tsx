import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchProfile } from "@/lib/queries";
import { BLOOD_GROUPS, IMPAIRMENT_LEVELS, type ImpairmentLevel } from "@/lib/netrasense";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Medical ID — NetraSense" },
      {
        name: "description",
        content:
          "View and edit personal, medical and impairment details, and print an emergency medical ID card.",
      },
      { property: "og:title", content: "Profile & Medical ID — NetraSense" },
      {
        property: "og:description",
        content: "Manage your medical ID details for emergency responders.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: () => fetchProfile(userId),
  });
  const [form, setForm] = useState({
    full_name: "John Doe",
    age: "28",
    blood_group: "O+",
    impairment_level: "Partial" as ImpairmentLevel,
    home_address: "123 Navigation Way, Innovation Hub",
    emergency_medical_notes: "No known drug allergies. Wears audio feedback headset.",
  });

  useEffect(() => {
    // Load from local storage fallback first
    const saved = localStorage.getItem("netrasense:profile_local");
    if (saved) {
      try {
        setForm((prev) => ({ ...prev, ...JSON.parse(saved) }));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    setForm({
      full_name: p.full_name ?? "John Doe",
      age: p.age ? String(p.age) : "28",
      blood_group: p.blood_group ?? "O+",
      impairment_level: (p.impairment_level ?? "Partial") as ImpairmentLevel,
      home_address: p.home_address ?? "123 Navigation Way, Innovation Hub",
      emergency_medical_notes:
        p.emergency_medical_notes ?? "No known drug allergies. Wears audio feedback headset.",
    });
  }, [profileQuery.data]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    // Save locally first
    localStorage.setItem("netrasense:profile_local", JSON.stringify(form));

    if (userId) {
      const { error } = await supabase.from("profiles").upsert({
        id: userId,
        full_name: form.full_name,
        age: form.age ? Number(form.age) : null,
        blood_group: form.blood_group,
        impairment_level: form.impairment_level,
        home_address: form.home_address,
        emergency_medical_notes: form.emergency_medical_notes,
      });
      if (error) {
        console.warn("Supabase profile upsert warning (saved locally):", error);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      }
    }
    setBusy(false);
    toast.success("Profile & Medical ID updated successfully.");
  }

  return (
    <AppShell
      title="Device & Profile"
      description="Manage your personal and medical information"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <section
          aria-labelledby="profile-form-heading"
          className="surface-card p-5 lg:p-6 print:hidden"
          data-print-hidden
        >
          <h2 id="profile-form-heading" className="text-lg font-bold">
            Personal & medical information
          </h2>
          <form className="mt-4 space-y-5" onSubmit={handleSave}>
            {/* Row 1: Name + Age */}
            <fieldset className="space-y-4 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-bold text-muted-foreground">Personal details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="p-name">Full name</Label>
                  <Input
                    id="p-name"
                    required
                    placeholder="e.g. John Doe"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-age">Age</Label>
                  <Input
                    id="p-age"
                    type="number"
                    min={1}
                    max={120}
                    required
                    placeholder="e.g. 28"
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                  />
                </div>
              </div>
            </fieldset>

            {/* Row 2: Blood group + Impairment */}
            <fieldset className="space-y-4 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-bold text-muted-foreground">Medical profile</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 relative z-10">
                  <Label htmlFor="p-blood">Blood group</Label>
                  <Select
                    value={form.blood_group}
                    onValueChange={(v) => setForm({ ...form, blood_group: v })}
                  >
                    <SelectTrigger id="p-blood" className="w-full">
                      <SelectValue placeholder="Select blood group" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {BLOOD_GROUPS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 relative z-10">
                  <Label htmlFor="p-impairment">Impairment level</Label>
                  <Select
                    value={form.impairment_level}
                    onValueChange={(v) =>
                      setForm({ ...form, impairment_level: v as ImpairmentLevel })
                    }
                  >
                    <SelectTrigger id="p-impairment" className="w-full">
                      <SelectValue placeholder="Select impairment level" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {IMPAIRMENT_LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </fieldset>

            {/* Row 3: Address */}
            <fieldset className="space-y-4 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-bold text-muted-foreground">Location</legend>
              <div className="space-y-2">
                <Label htmlFor="p-address">Home address</Label>
                <Input
                  id="p-address"
                  required
                  placeholder="e.g. 123 Navigation Way, Innovation Hub"
                  value={form.home_address}
                  onChange={(e) => setForm({ ...form, home_address: e.target.value })}
                />
              </div>
            </fieldset>

            {/* Row 4: Medical notes */}
            <fieldset className="space-y-4 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-bold text-muted-foreground">Critical medical notes</legend>
              <p className="text-xs text-muted-foreground -mt-2">
                Important information for emergency responders — allergies, medications, conditions.
              </p>
              <div className="space-y-2">
                <Textarea
                  id="p-notes"
                  rows={4}
                  placeholder="e.g. No known drug allergies. Wears audio feedback headset."
                  value={form.emergency_medical_notes}
                  onChange={(e) => setForm({ ...form, emergency_medical_notes: e.target.value })}
                />
              </div>
            </fieldset>

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Save profile
            </Button>
          </form>
        </section>

        {/* CTA to view the printable card */}
        <section className="surface-card p-5 lg:p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-collision/20 bg-collision/10">
                <ShieldCheck aria-hidden="true" className="size-5 text-collision" />
              </div>
              <div>
                <p className="font-bold">Emergency Medical ID Card</p>
                <p className="text-sm text-muted-foreground">
                  View and print a read-only card for first responders.
                </p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/medical-id">
                View card
                <ArrowRight aria-hidden="true" className="ml-1.5 size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
