import type { PersonaAvatar as Avatar, PersonaRecord } from "@homeling/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchPersonas, PersonaAppearanceError, updatePersonaAppearance, type PersonaAppearancePatch } from "./api.ts";
import { PersonaAvatar } from "./PersonaAvatar.tsx";
import { useSessionSnapshot } from "./SessionBoundary.tsx";

const control = "min-h-12 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300 disabled:opacity-50";
const palette = ["#86efac", "#fda4af", "#93c5fd", "#c4b5fd", "#fcd34d"];
const characters = [["smile", "Smile"], ["curious", "Curious"], ["sleepy", "Sleepy"]] as const;
const pets = [["none", "No pet"], ["cat", "Cat"], ["dog", "Dog"]] as const;
// Keep an uncertain save visible across navigation. Reads may confirm it, never replay it.
const uncertainSaves = new Map<string, PersonaAppearancePatch>();

export function PersonaCustomize({ personaId }: { personaId: string }) {
  return <CustomizeForm key={personaId} personaId={personaId} />;
}

function CustomizeForm({ personaId }: { personaId: string }) {
  const session = useSessionSnapshot();
  const [persona, setPersona] = useState<PersonaRecord | null>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<Avatar>({ color: "#86efac", character: "smile", pet: "none" });
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(() => uncertainSaves.has(personaId));
  const [error, setError] = useState<string | null>(() => uncertainSaves.has(personaId) ? "Previous save outcome unknown. Check saved customization; it will not be retried automatically." : null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  function apply(record: PersonaRecord) {
    setPersona(record); setName(record.name);
    setAvatar({ ...record.avatar, character: record.avatar.character ?? "smile", pet: record.avatar.pet ?? "none" });
  }
  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    void fetchPersonas(AbortSignal.any([ctrl.signal, AbortSignal.timeout(10_000)])).then((result) => {
      if (ctrl.signal.aborted) return;
      const current = result.personas.find((item) => item.id === personaId);
      if (current) apply(current); else setError("Persona not found. Return to Homelings.");
    }).catch((error: unknown) => { if (!ctrl.signal.aborted) setError(`Customization unavailable: ${error instanceof Error ? error.message : "connection lost"}. Return to the persona and try again.`); });
    return () => { mounted.current = false; ctrl.abort(); };
  }, [personaId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!persona || inFlight.current || unknown || !name.trim()) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const patch = { name: name.trim(), avatar };
    try {
      const saved = await updatePersonaAppearance(personaId, patch);
      if (mounted.current) { apply(saved); setNotice("Saved. Your avatar and name are shared across Homelings, details and conversation."); }
    } catch (error) {
      const notDispatched = error instanceof PersonaAppearanceError && error.notDispatched;
      if (!notDispatched) uncertainSaves.set(personaId, patch);
      if (mounted.current) {
        setUnknown(!notDispatched);
        setError(notDispatched ? `${error.message}. This attempt was not dispatched; unlock or correct the input before explicitly saving again.` : "Save outcome unknown. Check saved customization before retrying; no automatic retry will run.");
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  async function checkSaved() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await fetchPersonas(AbortSignal.timeout(10_000));
      const current = result.personas.find((item) => item.id === personaId);
      const expected = uncertainSaves.get(personaId);
      if (!mounted.current) return;
      if (current && expected && current.name === expected.name && current.avatar.color === expected.avatar.color && (current.avatar.character ?? "smile") === (expected.avatar.character ?? "smile") && (current.avatar.pet ?? "none") === (expected.avatar.pet ?? "none")) {
        uncertainSaves.delete(personaId); setUnknown(false); setError(null); apply(current); setNotice("Saved customization confirmed from the daemon.");
      } else setError("Previous save is still unconfirmed. The daemon does not yet show those changes. Do not repeat the save; check again after the connection recovers.");
    } catch { if (mounted.current) setError("Unable to check saved customization. Previous save remains unknown; check again when connected."); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  if (!persona) return <p role={error ? "alert" : "status"}>{error ?? "Loading customization…"}</p>;
  const disabled = busy || unknown || !session.ready;
  return <form onSubmit={save} aria-label="Customize avatar" className="space-y-7">
    <div className="flex flex-col items-center gap-4 py-3"><PersonaAvatar avatar={avatar} size="detail" /><p className="max-w-full truncate text-xl font-medium">{name || persona.name}</p></div>
    <fieldset disabled={disabled} className="space-y-7">
      <div><label htmlFor="customize-name" className="mb-2 block font-medium">Name</label><input id="customize-name" name="name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={80} required autoComplete="off" className={`${control} w-full`} /></div>
      <fieldset><legend className="mb-3 font-medium">Color</legend><div className="flex flex-wrap gap-3">
        {(palette.includes(avatar.color) ? palette : [avatar.color, ...palette]).map((color) => <label key={color} className="relative flex size-12 cursor-pointer items-center justify-center rounded-full focus-within:outline focus-within:outline-2 focus-within:outline-green-300">
          <input type="radio" name="color" value={color} checked={avatar.color === color} onChange={() => setAvatar({ ...avatar, color })} aria-label={`Color ${color}`} className="peer sr-only" />
          <span aria-hidden="true" className="size-8 rounded-full peer-checked:ring-2 peer-checked:ring-white peer-checked:ring-offset-2 peer-checked:ring-offset-neutral-950" style={{ backgroundColor: color }} />
        </label>)}
      </div></fieldset>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div><label htmlFor="customize-character" className="mb-2 block font-medium">Character</label><select id="customize-character" name="character" value={avatar.character} onChange={(event) => setAvatar({ ...avatar, character: event.currentTarget.value })} className={`${control} w-full`}>
          {!characters.some(([value]) => value === avatar.character) ? <option value={avatar.character}>Current character (legacy)</option> : null}{characters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <div><label htmlFor="customize-pet" className="mb-2 block font-medium">Pet</label><select id="customize-pet" name="pet" value={avatar.pet} onChange={(event) => setAvatar({ ...avatar, pet: event.currentTarget.value })} className={`${control} w-full`}>
          {!pets.some(([value]) => value === avatar.pet) ? <option value={avatar.pet}>Current pet (legacy)</option> : null}{pets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
      </div>
    </fieldset>
    {!session.ready ? <p role="status" className="text-sm text-amber-200">Unlock Homeling before saving. Your draft is preserved.</p> : null}
    {notice ? <p role="status" className="text-sm text-green-200">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm leading-relaxed text-rose-300">{error}</p> : null}
    {unknown ? <button type="button" disabled={busy} onClick={() => void checkSaved()} className={`${control} w-full`}>{busy ? "Checking…" : "Check saved customization"}</button> : <button type="submit" disabled={disabled || !name.trim()} className="min-h-12 w-full rounded-xl bg-green-300 px-4 py-3 font-semibold text-green-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-200 disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>}
  </form>;
}
