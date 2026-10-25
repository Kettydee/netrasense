import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, ScanLine, UserPlus, Volume2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { speak } from "@/lib/netrasense";
import { toast } from "sonner";

type Contact = { id: string; name: string; relationship: string };
const KEY = "netrasense:qr-contacts:v1";
const PREFIX = "netrasense-person:";
const readContacts = (): Contact[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is Contact =>
      !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.relationship === "string"
    ) : [];
  } catch { return []; }
};

export function QRPersonIdentifier({ getFrameBase64 }: { getFrameBase64: () => string | null }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("Friend");
  const [scanning, setScanning] = useState(false);
  const [identified, setIdentified] = useState<Contact | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to scan");
  const busy = useRef(false);
  const lastAnnouncement = useRef("");

  useEffect(() => { setContacts(readContacts()); }, []);
  const save = (next: Contact[]) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    setContacts(next);
  };
  const addContact = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const person = { id: crypto.randomUUID(), name: trimmed, relationship: relationship.trim() || "Contact" };
    save([...contacts, person]);
    setSelected(person.id);
    setName("");
    toast.success("QR contact created. Share their QR code with their consent.");
  };
  const removeContact = (id: string) => {
    save(contacts.filter((c) => c.id !== id));
    if (selected === id) setSelected(null);
    if (identified?.id === id) setIdentified(null);
  };
  const decodeFrame = useCallback(async (dataUrl: string) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  }, []);
  const scan = useCallback(async () => {
    if (busy.current) return;
    const frame = getFrameBase64();
    if (!frame) { setStatus("Start the NetraSense camera to scan QR codes."); return; }
    busy.current = true;
    try {
      const payload = await decodeFrame(frame);
      if (!payload) { setStatus("Looking for a QR code. Ask the person to show it to the camera."); return; }
      if (!payload.startsWith(PREFIX)) { setStatus("This QR code is not a NetraSense contact."); return; }
      const id = payload.slice(PREFIX.length);
      const person = readContacts().find((c) => c.id === id);
      if (!person) {
        setIdentified(null);
        setStatus("Unregistered QR code. Identity unknown.");
        if (lastAnnouncement.current !== id) { speak("Unknown QR contact."); lastAnnouncement.current = id; }
        return;
      }
      setIdentified(person);
      setStatus(`QR contact matched: ${person.name}`);
      if (lastAnnouncement.current !== id) {
        speak(`${person.name}, your ${person.relationship}, is nearby and has presented their QR code.`);
        lastAnnouncement.current = id;
      }
    } catch {
      setStatus("Could not read camera frame. Try browser camera mode or a clearer QR code.");
    } finally { busy.current = false; }
  }, [getFrameBase64, decodeFrame]);
  useEffect(() => {
    if (!scanning) return;
    void scan();
    const timer = window.setInterval(() => { void scan(); }, 900);
    return () => window.clearInterval(timer);
  }, [scanning, scan]);
  const current = contacts.find((c) => c.id === selected);
  return (
    <section className="mt-5 space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5" aria-label="QR person identification">
      <div className="flex items-start gap-3">
        <QrCode className="mt-1 size-6 text-primary" aria-hidden="true" />
        <div>
          <h4 className="font-black text-foreground">QR Person Identification</h4>
          <p className="text-sm text-muted-foreground">Register a consenting contact, give them their QR code, and scan it to announce their name. This identifies a registered code, not the face or the code holder's verified identity.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => { lastAnnouncement.current = ""; setScanning((v) => !v); }} className="gap-2">
          <ScanLine className="size-4" /> {scanning ? "Stop QR Scan" : "Start QR Scan"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void scan()}>Scan Once</Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
      {identified && <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
        <div><strong className="text-foreground">{identified.name}</strong><p className="text-xs text-muted-foreground">{identified.relationship} · Registered QR match</p></div>
        <Button type="button" variant="outline" size="sm" onClick={() => speak(`${identified.name}, ${identified.relationship}.`)}><Volume2 className="size-4" /> Repeat</Button>
      </div>}
      <form onSubmit={addContact} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input aria-label="Person's name" placeholder="Name (e.g. Rahul)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="h-10 rounded-xl border border-border bg-card px-3 text-sm" />
        <input aria-label="Relationship" placeholder="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={80} className="h-10 rounded-xl border border-border bg-card px-3 text-sm" />
        <Button type="submit" className="gap-2"><UserPlus className="size-4" /> Generate QR</Button>
      </form>
      {current && <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
        <div className="rounded-lg bg-white p-3"><QRCodeSVG value={PREFIX + current.id} size={170} level="M" /></div>
        <div className="space-y-2"><p className="font-semibold">{current.name} · {current.relationship}</p>
          <p className="max-w-xs text-xs text-muted-foreground">Have this person save or print their code. It works only in this browser's registered contacts; static codes can be copied.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const svg = document.querySelector("section[aria-label='QR person identification'] svg[xmlns='http://www.w3.org/2000/svg']") as SVGSVGElement | null;
            if (!svg) return;
            const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "netrasense-contact-qr.svg"; a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download QR</Button>
        </div>
      </div>}
      {contacts.length > 0 && <div className="space-y-2"><h5 className="text-xs font-bold uppercase text-muted-foreground">Registered QR contacts ({contacts.length})</h5>
        {contacts.map((c) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => setSelected(c.id)}>{c.name} <span className="font-normal text-muted-foreground">({c.relationship})</span></button>
          <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${c.name}`} onClick={() => removeContact(c.id)}><Trash2 className="size-4" /></Button>
        </div>)}
      </div>}
    </section>
  );
}
