import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  HeartPulse,
  Phone,
  Printer,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchContacts, fetchProfile } from "@/lib/queries";
import type { ImpairmentLevel } from "@/lib/netrasense";

export const Route = createFileRoute("/_authenticated/medical-id")({
  head: () => ({
    meta: [
      { title: "Emergency Medical ID — NetraSense" },
      {
        name: "description",
        content:
          "Printable emergency medical ID card for first responders and caregivers.",
      },
      { property: "og:title", content: "Emergency Medical ID — NetraSense" },
      {
        property: "og:description",
        content:
          "Print-ready medical identity card with blood group, impairment level and emergency contacts.",
      },
    ],
  }),
  component: MedicalIdPage,
});

function MedicalIdPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: () => fetchProfile(userId),
  });

  const contactsQuery = useQuery({
    queryKey: ["contacts", userId],
    enabled: !!userId,
    queryFn: fetchContacts,
  });

  const p = profileQuery.data;
  const contacts = contactsQuery.data ?? [];
  const primaryContacts = contacts.filter((c) => c.is_primary);

  const fullName = p?.full_name || "—";
  const age = p?.age ? String(p.age) : "—";
  const bloodGroup = p?.blood_group || "—";
  const impairment = (p?.impairment_level || "—") as ImpairmentLevel | "—";
  const medicalNotes = p?.emergency_medical_notes || "None recorded";
  const homeAddress = p?.home_address || "—";

  if (profileQuery.isLoading) {
    return (
      <AppShell title="Emergency Medical ID" description="Loading…">
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Emergency Medical ID"
      description="Read-only medical identity card for first responders"
    >
      <div className="mx-auto max-w-2xl space-y-6 print:max-w-none print:space-y-0">
        {/* Top actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden" data-print-hidden>
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Back to profile
          </Link>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            Print card
          </Button>
        </div>

        {/* ── The medical ID card ── */}
        <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg print:rounded-none print:border-none print:shadow-none">
          {/* Red header */}
          <div className="flex items-center gap-4 bg-collision px-6 py-5 text-collision-foreground print:py-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/20">
              <HeartPulse className="size-7" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-extrabold uppercase tracking-wide">
                Emergency Medical ID
              </p>
              <p className="text-sm opacity-90">
                NetraSense assistive navigation user
              </p>
            </div>
          </div>

          {/* Primary info — two columns */}
          <div className="grid grid-cols-1 gap-0 border-b border-border sm:grid-cols-2 print:border-b print:border-gray-300">
            <Field label="Full name" value={fullName} />
            <Field label="Age" value={age} />
            <Field
              label="Blood group"
              value={bloodGroup}
              accent
            />
            <Field label="Impairment level" value={impairment} />
          </div>

          {/* Secondary info — full width */}
          <div className="border-b border-border print:border-b print:border-gray-300">
            <Field label="Critical medical notes" value={medicalNotes} span />
            <Field label="Home address" value={homeAddress} span />
          </div>

          {/* Emergency contacts */}
          <div className="px-6 py-5 print:px-5 print:py-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted-foreground print:text-gray-500">
              <Phone className="size-3.5" aria-hidden="true" />
              Primary emergency contacts
            </h3>
            {primaryContacts.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground italic print:text-gray-500 print:not-italic">
                <AlertCircle className="size-4 shrink-0" />
                No primary contact saved — add one in{" "}
                <Link to="/contacts" className="font-semibold underline underline-offset-2 hover:text-foreground">
                  Emergency &amp; Contacts
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {primaryContacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-4 py-3 print:border-gray-300 print:bg-white print:rounded-none"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{c.contact_name}</p>
                      <p className="text-sm text-muted-foreground print:text-gray-600">
                        {c.relationship ?? "Contact"} · {c.phone_number}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0 print:hidden">
                      <a href={`tel:${c.phone_number}`}>
                        <Phone className="mr-1 size-3.5" />
                        Call
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer disclaimer */}
          <div className="border-t border-border bg-muted/30 px-6 py-3 print:border-t print:border-gray-300 print:bg-gray-50 print:px-5">
            <p className="flex items-start gap-2 text-xs text-muted-foreground print:text-gray-500">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              This card is generated by NetraSense. If you find someone wearing this card who
              appears to need medical assistance, please call emergency services and reference
              the details above.
            </p>
          </div>
        </article>
      </div>
    </AppShell>
  );
}

/* ── Reusable field row ──────────────────────────────────────────────── */
function Field({
  label,
  value,
  accent,
  span,
}: {
  label: string;
  value: string;
  accent?: boolean;
  span?: boolean;
}) {
  return (
    <div className={`px-6 py-4 print:px-5 print:py-3 ${span ? "sm:col-span-2" : ""}`}>
      <dt className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground print:text-gray-500">
        {label}
      </dt>
      <dd
        className={`mt-1 ${
          accent
            ? "text-3xl font-extrabold text-collision print:text-red-600"
            : "text-lg font-bold"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
