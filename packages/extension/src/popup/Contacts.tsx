import { useCallback, useEffect, useState } from "react";
import { AtSign, BookUser, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { rpc, shorten, type AppState } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Avatar, Button, Card, ErrorText, Field, IconButton, Notice, Screen, Spinner, TopBar, cx } from "./ui/ui";

/** Saved recipient (AI-22): stored only in this browser's wallet state. */
export interface Contact { id: string; name: string; address: string; note?: string; createdAt: number }

export function useContacts() {
  const [list, setList] = useState<Contact[]>();
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setList(await rpc<Contact[]>({ type: "contactList" })); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { list, error, reload };
}

function ContactForm({ initial, prefix, onDone, onCancel }: { initial?: Partial<Contact>; prefix: string; onDone: (c: Contact) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const save = useAction(async () => onDone(await rpc<Contact>({ type: "contactSave", id: initial?.id, name, address: address.trim(), note })));
  return (
    <Card className="space-y-2.5 p-3" data-testid="contact-form">
      <Field label={t("contacts.name")}><input className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} data-testid="contact-name" /></Field>
      <Field label={t("contacts.address")}><textarea className="field min-h-[64px] resize-none font-mono" placeholder={`${prefix}…`} value={address} onChange={(e) => setAddress(e.target.value)} data-testid="contact-address" /></Field>
      <Field label={t("contacts.note")}><input className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorText error={save.error} />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" loading={save.busy} disabled={!name.trim() || !address.trim()} onClick={() => void save.run()} data-testid="contact-save">{t("common.save")}</Button>
      </div>
    </Card>
  );
}

/** Address book screen (AC-001). */
export function Contacts({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const prefix = st.networks.find((n) => n.name === st.network)!.addressPrefix;
  const { list, error, reload } = useContacts();
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [q, setQ] = useState("");
  const remove = useAction(async (c: Contact) => {
    if (!confirm(t("contacts.removeConfirm", { name: c.name }))) return;
    await rpc({ type: "contactRemove", id: c.id });
    await reload();
  });
  const shown = filterContacts(list ?? [], q);
  return (
    <Screen>
      <TopBar title={t("contacts.title")} onBack={() => go("/settings")} right={!editing && <IconButton label={t("contacts.add")} onClick={() => setEditing({})} data-testid="contact-add"><Plus size={16} /></IconButton>} />
      <div className="space-y-3 animate-fade-up">
        <Notice>{t("contacts.localOnly")}</Notice>
        {editing && <ContactForm initial={editing} prefix={prefix} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />}
        <ErrorText error={error || remove.error} />
        {list && list.length > 5 && <SearchBox value={q} onChange={setQ} />}
        {!list ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : !list.length ? (
          <p className="py-6 text-center text-[12px] text-moon-dim">{t("contacts.empty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="contact-list">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-1 py-1.5">
                <Avatar seed={c.address} size={30}>{c.name.slice(0, 1).toUpperCase()}</Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{c.name}</div>
                  <div className="truncate font-mono text-[10.5px] text-moon-dim" title={c.address}>{shorten(c.address, 10)}</div>
                  {c.note && <div className="truncate text-[10.5px] text-moon-dim">{c.note}</div>}
                </div>
                <IconButton label={t("contacts.edit")} onClick={() => setEditing(c)}><Pencil size={14} /></IconButton>
                <IconButton label={t("contacts.remove")} onClick={() => void remove.run(c)}><Trash2 size={14} /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

export const filterContacts = (list: Contact[], q: string) => {
  const s = q.trim().toLowerCase();
  return s ? list.filter((c) => c.name.toLowerCase().includes(s) || c.address.includes(s) || (c.note ?? "").toLowerCase().includes(s)) : list;
};

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="relative block">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-moon-dim" />
      <input className="field pl-8" placeholder={t("contacts.search")} aria-label={t("contacts.search")} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Sheet to pick a saved contact (AC-002). */
export function ContactPicker({ onPick, onClose }: { onPick: (c: Contact) => void; onClose: () => void }) {
  const t = useT();
  const { list, error } = useContacts();
  const [q, setQ] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgb(8_5_3/0.45)] animate-fade-up" role="dialog" aria-modal="true" aria-label={t("contacts.pick")}>
      <div className="max-h-[80%] space-y-3 overflow-y-auto border-t border-hair bg-night-950 p-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-ink">{t("contacts.pick")}</h2>
          <IconButton label={t("common.close")} onClick={onClose}><X size={16} /></IconButton>
        </div>
        <ErrorText error={error} />
        <SearchBox value={q} onChange={setQ} />
        {!list ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : !list.length ? <p className="py-4 text-center text-[12px] text-moon-dim">{t("contacts.empty")}</p> : (
          <ul className="space-y-1">
            {filterContacts(list, q).map((c) => (
              <li key={c.id}>
                <button onClick={() => onPick(c)} className="flex w-full items-center gap-2.5 px-1 py-1.5 text-left hover:bg-night-850" data-testid="contact-pick">
                  <Avatar seed={c.address} size={28}>{c.name.slice(0, 1).toUpperCase()}</Avatar>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-ink">{c.name}</span><span className="block truncate font-mono text-[10.5px] text-moon-dim">{shorten(c.address, 10)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** What the recipient field resolved to: a direct address, a contact, or an ADA Handle. */
export interface Recipient { address: string; label?: string; handle?: string; known: boolean }

/**
 * Recipient input (AI-22): address, `$handle` (resolved on preprod and shown for confirmation) or a pick from
 * the address book. Warns when the address is not in the book (first send) and offers to save it.
 */
export function RecipientField({ value, onChange, onResolved, prefix, own = [], label }: {
  value: string; onChange: (v: string) => void; onResolved: (r: Recipient | undefined) => void; prefix: string; own?: string[]; label?: string;
}) {
  const t = useT();
  const { list, reload } = useContacts();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [handle, setHandle] = useState<{ input: string; address?: string; error?: string; busy?: boolean }>();
  const input = value.trim();
  const isHandle = input.startsWith("$");

  useEffect(() => {
    if (!isHandle || input.length < 2) { setHandle(undefined); return; }
    let live = true;
    setHandle({ input, busy: true });
    const timer = setTimeout(() => {
      rpc<{ handle: string; address: string }>({ type: "resolveHandle", handle: input })
        .then((r) => live && setHandle({ input, address: r.address }))
        .catch((e) => live && setHandle({ input, error: e instanceof Error ? e.message : String(e) }));
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [input, isHandle]);

  const address = isHandle ? (handle?.input === input ? handle.address : undefined) : input.startsWith(prefix) ? input : undefined;
  const contact = address ? list?.find((c) => c.address === address) : undefined;
  const known = !!contact || (!!address && own.includes(address));
  useEffect(() => {
    onResolved(address ? { address, label: contact?.name, handle: isHandle ? input.toLowerCase() : undefined, known } : undefined);
  }, [address, contact?.name, known]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <Field label={label ?? t("send.to")}>
        <div className="relative">
          <textarea className="field min-h-[76px] resize-none pr-10 font-mono" aria-label={label ?? t("send.to")} placeholder={t("send.toPlaceholder", { prefix })} value={value} onChange={(e) => onChange(e.target.value)} data-testid="send-to" />
          <IconButton className="absolute right-1.5 top-1.5" label={t("contacts.pick")} onClick={() => setPicking(true)} data-testid="send-pick-contact"><BookUser size={15} /></IconButton>
        </div>
      </Field>
      {contact && <p className="flex items-center gap-1.5 text-[11.5px] text-ok" data-testid="send-contact"><BookUser size={12} /> {contact.name}</p>}
      {isHandle && handle?.busy && <p className="text-[11.5px] text-moon-dim">{t("handle.resolving")}</p>}
      {isHandle && handle?.error && <p role="alert" className="text-[11.5px] text-bad">{handle.error}</p>}
      {isHandle && address && (
        <Card className="space-y-1 p-2.5" data-testid="handle-resolved">
          <div className="flex items-center gap-1.5 text-[11.5px] text-moon"><AtSign size={12} /> {t("handle.resolved", { handle: input.toLowerCase() })}</div>
          <div className="break-all font-mono text-[11px] text-ink">{address}</div>
          <p className="text-[10.5px] text-moon-dim">{t("handle.check")}</p>
        </Card>
      )}
      {address && list && !known && (
        <div className={cx("space-y-2")} data-testid="send-new-address">
          <Notice tone="warn">{t("contacts.firstSend")}</Notice>
          {saving ? (
            <ContactForm initial={{ address, name: isHandle ? input.toLowerCase() : "" }} prefix={prefix} onCancel={() => setSaving(false)} onDone={() => { setSaving(false); void reload(); }} />
          ) : (
            <Button block onClick={() => setSaving(true)} data-testid="send-save-contact"><Plus size={14} /> {t("contacts.saveThis")}</Button>
          )}
        </div>
      )}
      {picking && <ContactPicker onClose={() => setPicking(false)} onPick={(c) => { onChange(c.address); setPicking(false); }} />}
    </div>
  );
}
