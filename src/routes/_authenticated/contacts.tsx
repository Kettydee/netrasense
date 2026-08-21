import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, PencilLine, PhoneCall, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchContacts } from "@/lib/queries";
import { speak, type Contact } from "@/lib/netrasense";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Emergency Contacts Hub — NetraSense" },
      { name: "description", content: "Add, edit and test the caregivers who are alerted when a collision is detected." },
      { property: "og:title", content: "Emergency Contacts Hub — NetraSense" },
      { property: "og:description", content: "Manage caregivers notified during emergencies." },
    ],
  }),
  component: ContactsPage,
});

type FormState = {
  contact_name: string;
  relationship: string;
  phone_number: string;
  is_primary: boolean;
  notify_on_collision: boolean;
};

const EMPTY: FormState = {
  contact_name: "",
  relationship: "",
  phone_number: "",
  is_primary: false,
  notify_on_collision: true,
};

function ContactsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const contactsQuery = useQuery({ queryKey: ["contacts", userId], enabled: !!userId, queryFn: fetchContacts });

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setForm({
      contact_name: contact.contact_name,
      relationship: contact.relationship ?? "",
      phone_number: contact.phone_number,
      is_primary: contact.is_primary,
      notify_on_collision: contact.notify_on_collision,
    });
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    const payload = { ...form, user_id: userId };
    const { error } = editing
      ? await supabase.from("emergency_contacts").update(payload).eq("id", editing.id)
      : await supabase.from("emergency_contacts").insert(payload);
    setBusy(false);
    if (error) {
      toast.error("Could not save the contact.");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
    toast.success(editing ? "Contact updated." : "Contact added.");
    setOpen(false);
  }

  async function handleDelete(contact: Contact) {
    const { error } = await supabase.from("emergency_contacts").delete().eq("id", contact.id);
    if (error) {
      toast.error("Could not delete the contact.");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
    toast.success(`${contact.contact_name} removed.`);
  }

  const contacts = contactsQuery.data ?? [];

  return (
    <AppShell title="Emergency Contacts Hub" description="Caregivers alerted when a collision is detected">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {contacts.length} contact{contacts.length === 1 ? "" : "s"} saved
        </p>
        <Button size="lg" onClick={openAdd}>
          <Plus aria-hidden="true" className="size-5" />
          Add contact
        </Button>
      </div>

      {contactsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <h2 className="text-lg font-bold">No emergency contacts yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Add at least one primary caregiver so NetraSense can raise an alert on your behalf.
          </p>
          <Button className="mt-5" onClick={openAdd}>
            <Plus aria-hidden="true" className="size-4" />
            Add your first contact
          </Button>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{c.contact_name}</h2>
                  <p className="text-sm text-muted-foreground">{c.relationship || "Contact"}</p>
                </div>
                {c.is_primary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                    <Star aria-hidden="true" className="size-3.5" />
                    Primary
                  </span>
                )}
              </div>
              <p className="mt-3 text-base font-semibold">{c.phone_number}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <BellRing aria-hidden="true" className="size-4" />
                {c.notify_on_collision ? "Notified on collision" : "Collision alerts off"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={`tel:${c.phone_number}`} aria-label={`Call ${c.contact_name}`}>
                    <PhoneCall aria-hidden="true" className="size-4" />
                    Call
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    speak(`Test alert. This is NetraSense calling ${c.contact_name}.`);
                    toast.success(`Test alert simulated for ${c.contact_name}.`);
                  }}
                >
                  <BellRing aria-hidden="true" className="size-4" />
                  Test alert call
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                  <PencilLine aria-hidden="true" className="size-4" />
                  Edit
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void handleDelete(c)}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit contact" : "Add emergency contact"}</DialogTitle>
            <DialogDescription>These details are used for calls and collision notifications.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="c-name">Contact name</Label>
              <Input id="c-name" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-relationship">Relationship</Label>
              <Input id="c-relationship" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">Phone number</Label>
              <Input id="c-phone" type="tel" required value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <Label htmlFor="c-primary">Primary contact</Label>
              <Switch id="c-primary" checked={form.is_primary} onCheckedChange={(v) => setForm({ ...form, is_primary: v })} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <Label htmlFor="c-notify">Notify on collision (SMS / WhatsApp)</Label>
              <Switch
                id="c-notify"
                checked={form.notify_on_collision}
                onCheckedChange={(v) => setForm({ ...form, notify_on_collision: v })}
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Add contact"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
