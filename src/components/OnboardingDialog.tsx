import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { BLOOD_GROUPS, IMPAIRMENT_LEVELS, type ImpairmentLevel } from "@/lib/netrasense";

export function OnboardingDialog({ open }: { open: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    age: "",
    blood_group: "O+",
    impairment_level: "Partial" as ImpairmentLevel,
    contact_name: "",
    relationship: "",
    phone_number: "",
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: form.full_name,
        age: form.age ? Number(form.age) : null,
        blood_group: form.blood_group,
        impairment_level: form.impairment_level,
      });
      if (profileError) throw profileError;

      const { error: contactError } = await supabase.from("emergency_contacts").insert({
        user_id: user.id,
        contact_name: form.contact_name,
        relationship: form.relationship,
        phone_number: form.phone_number,
        is_primary: true,
        notify_on_collision: true,
      });
      if (contactError) throw contactError;

      await queryClient.invalidateQueries();
      toast.success("Profile ready. Welcome to NetraSense.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set up your safety profile</DialogTitle>
          <DialogDescription>
            These details power your emergency medical ID and caregiver alerts. All fields are required.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ob-name">Full name</Label>
              <Input
                id="ob-name"
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-age">Age</Label>
              <Input
                id="ob-age"
                type="number"
                min={1}
                max={120}
                required
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-blood">Blood group</Label>
              <Select value={form.blood_group} onValueChange={(v) => setForm({ ...form, blood_group: v })}>
                <SelectTrigger id="ob-blood">
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
              <Label htmlFor="ob-impairment">Impairment level</Label>
              <Select
                value={form.impairment_level}
                onValueChange={(v) => setForm({ ...form, impairment_level: v as ImpairmentLevel })}
              >
                <SelectTrigger id="ob-impairment">
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

          <fieldset className="space-y-4 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-bold">Primary emergency contact</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ob-contact">Contact name</Label>
                <Input
                  id="ob-contact"
                  required
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-relationship">Relationship</Label>
                <Input
                  id="ob-relationship"
                  required
                  placeholder="Caregiver, Daughter, Neighbour"
                  value={form.relationship}
                  onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-phone">Phone number</Label>
              <Input
                id="ob-phone"
                type="tel"
                required
                value={form.phone_number}
                onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
              />
            </div>
          </fieldset>

          <Button type="submit" size="lg" className="w-full text-base" disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Save and open dashboard
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
