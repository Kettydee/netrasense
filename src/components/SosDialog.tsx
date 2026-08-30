import { useEffect, useState } from "react";
import { PhoneCall, Siren } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { speak, type Contact } from "@/lib/netrasense";

export function SosDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [logged, setLogged] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("*")
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open || !user || logged) return;
    setLogged(true);
    speak("Emergency broadcast activated. Contacting your emergency contacts.");
    void supabase
      .from("telemetry_stream")
      .insert({
        user_id: user.id,
        detected_object: "Manual SOS Broadcast",
        distance_cm: 0,
        threat_level: "Collision",
        action_taken: "SOS broadcast to emergency contacts",
      })
      .then(({ error }) => {
        if (error) {
          toast.error("Could not log the SOS alert.");
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ["telemetry"] });
        toast.error("SOS broadcast logged as a critical alert.");
      });
  }, [open, user, logged, queryClient]);

  useEffect(() => {
    if (!open) setLogged(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-collision sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-collision">
            <Siren aria-hidden="true" className="size-6 pulse-threat" />
            Emergency SOS Broadcast
          </DialogTitle>
          <DialogDescription>
            A critical alert has been logged. Call your emergency contacts now.
          </DialogDescription>
        </DialogHeader>
        <div
          aria-live="assertive"
          className="rounded-lg bg-collision/15 p-4 text-sm font-semibold text-collision"
        >
          SOS active — caregivers flagged for collision notification are being alerted.
        </div>
        <ul className="space-y-2">
          {contacts.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No emergency contacts saved yet. Add one in the Emergency Contacts Hub.
            </li>
          )}
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {c.contact_name}
                  {c.is_primary && (
                    <span className="ml-2 text-xs font-bold text-primary">PRIMARY</span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {c.relationship ?? "Contact"} · {c.phone_number}
                </p>
              </div>
              <Button asChild size="sm">
                <a href={`tel:${c.phone_number}`} aria-label={`Call ${c.contact_name}`}>
                  <PhoneCall aria-hidden="true" className="size-4" />
                  Call
                </a>
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Dismiss emergency panel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
