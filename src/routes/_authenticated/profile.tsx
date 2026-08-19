import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, HeartPulse } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchContacts, fetchProfile } from "@/lib/queries";
import { BLOOD_GROUPS, IMPAIRMENT_LEVELS, type ImpairmentLevel } from "@/lib/aegis";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Medical ID — AegisNav" },
      { name: "description", content: "View and edit personal, medical and impairment details, and print an emergency medical ID card." },
      { property: "og:title", content: "Profile & Medical ID — AegisNav" },
      { property: "og:description", content: "Manage your medical ID details for emergency responders." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const profileQuery = useQuery({ queryKey: ["profile", userId], enabled: !!userId, queryFn: () => fetchProfile(userId) });
  const contactsQuery = useQuery({ queryKey: ["contacts", userId], enabled: !!userId, queryFn: fetchContacts });

  const [form, setForm] = useState({
    full_name: "",
    age: "",
    blood_group: "O+",
    impairment_level: "Partial" as ImpairmentLevel,
    home_address: "",
    emergency_medical_notes: "",
  });

  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    setForm({
      full_name: p.full_name ?? "",
      age: p.age ? String(p.age) : "",
      blood_group: p.blood_group ?? "O+",
      impairment_level: (p.impairment_level ?? "Partial") as ImpairmentLevel,
      home_address: p.home_address ?? "",
      emergency_medical_notes: p.emergency_medical_notes ?? "",
    });
  }, [profileQuery.data]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: form.full_name,
      age: form.age ? Number(form.age) : null,
      blood_group: form.blood_group,
      impairment_level: form.impairment_level,
      home_address: form.home_address,
      emergency_medical_notes: form.emergency_medical_notes,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not save your profile.");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    toast.success("Profile updated.");
  }

  const primary = (contactsQuery.data ?? []).filter((c) => c.is_primary);

  return (
    <AppShell title="User Profile & Medical ID" description="Keep your medical details current for responders">
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="profile-form-heading" className="surface-card p-5 lg:p-6 print:hidden">
          <h2 id="profile-form-heading" className="text-lg font-bold">
            Personal & medical information
          </h2>
          {profileQuery.isLoading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={handleSave}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="p-name">Full name</Label>
                  <Input id="p-name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-age">Age</Label>
                  <Input id="p-age" type="number" min={1} max={120} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-blood">Blood group</Label>
                  <Select value={form.blood_group} onValueChange={(v) => setForm({ ...form, blood_group: v })}>
                    <SelectTrigger id="p-blood">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOOD_GROUPS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-impairment">Impairment level</Label>
                  <Select
                    value={form.impairment_level}
                    onValueChange={(v) => setForm({ ...form, impairment_level: v as ImpairmentLevel })}
                  >
                    <SelectTrigger id="p-impairment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPAIRMENT_LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-address">Home address</Label>
                <Input id="p-address" value={form.home_address} onChange={(e) => setForm({ ...form, home_address: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-notes">Critical medical notes</Label>
                <Textarea
                  id="p-notes"
                  rows={4}
                  placeholder="Allergies, medication, conditions responders should know."
                  value={form.emergency_medical_notes}
                  onChange={(e) => setForm({ ...form, emergency_medical_notes: e.target.value })}
                />
              </div>
              <Button type="submit" size="lg" disabled={busy}>
                {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                Save profile
              </Button>
            </form>
          )}
        </section>

        <section aria-labelledby="medical-id-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3 print:hidden">
            <h2 id="medical-id-heading" className="text-lg font-bold">
              Emergency medical ID card
            </h2>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" className="size-4" />
              Print card
            </Button>
          </div>
          <article className="surface-card overflow-hidden">
            <div className="flex items-center gap-3 bg-collision p-4 text-collision-foreground">
              <HeartPulse aria-hidden="true" className="size-7" />
              <div>
                <p className="text-lg font-extrabold uppercase tracking-wide">Emergency Medical ID</p>
                <p className="text-sm">AegisNav assistive navigation user</p>
              </div>
            </div>
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="text-lg font-bold">{form.full_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Age</dt>
                <dd className="text-lg font-bold">{form.age || "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Blood group</dt>
                <dd className="text-2xl font-extrabold text-collision">{form.blood_group}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Impairment level</dt>
                <dd className="text-lg font-bold">{form.impairment_level}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm text-muted-foreground">Critical medical notes</dt>
                <dd className="font-semibold">{form.emergency_medical_notes || "None recorded"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm text-muted-foreground">Home address</dt>
                <dd className="font-semibold">{form.home_address || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm text-muted-foreground">Primary emergency contacts</dt>
                <dd className="font-semibold">
                  {primary.length === 0
                    ? "No primary contact saved"
                    : primary.map((c) => `${c.contact_name} (${c.relationship ?? "contact"}) · ${c.phone_number}`).join(" — ")}
                </dd>
              </div>
            </dl>
          </article>
        </section>
      </div>
    </AppShell>
  );
}
