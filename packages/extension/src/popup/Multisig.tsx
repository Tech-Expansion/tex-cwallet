import { useCallback, useEffect, useState, type DragEvent } from "react";
import { Check, ExternalLink, FileDown, Plus, Radar, Share2, ShieldCheck, Trash2, Users } from "lucide-react";
import { rpc, fmtAda, parseAda, shorten, type AppState, type RequestItem, type SharedInput, type SharedWalletInfo, type TxPreview } from "./rpc";
import { tokenLabel } from "./Activity";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Avatar, Button, Card, Checkbox, CopyField, ErrorText, Field, Notice, Screen, SectionLabel, ShareSheet, SignSheet, Spinner, TopBar, cx, showToast } from "./ui/ui";
import { NetworkPill, netOf } from "./Home";

export const MESH_MULTISIG_URL = "https://multisig.meshjs.dev";
const walletRoute = (id: string) => `/multisig/w/${id}`;

/** Điều hướng con của tab Multisig: /multisig, /multisig/new, /multisig/import, /multisig/w/<id> */
export function Multisig({ st, route, go }: { st: AppState; route: string; go: (r: string) => void }) {
  const wallet = st.wallets.find((w) => w.id === st.active.walletId);
  const t = useT();
  if (wallet?.kind !== "mnemonic")
    return <Screen><TopBar title={t("ms2.title")} right={<NetworkPill net={netOf(st)} />} /><Notice tone="warn">{t("ms2.walletWatch")}</Notice></Screen>;
  const w = route.match(/^\/multisig\/w\/([^?]+)(?:\?(.*))?$/);
  if (w) return <Detail st={st} id={w[1]!} go={go} created={new URLSearchParams(w[2] ?? "").get("created") === "1"} />;
  if (route.startsWith("/multisig/new")) return <Create st={st} go={go} prefillKey={new URLSearchParams(route.split("?")[1] ?? "").get("key") ?? ""} />;
  if (route === "/multisig/import") return <Import go={go} />;
  return <List st={st} go={go} />;
}

/**
 * One box for anything a cosigner sends (AI-11): a cosigner key, wallet data or a sign request, pasted
 * or dropped as a file. The wallet detects what it is and opens the right screen; a sign request is
 * checked and merged with the stored copy of the same transaction.
 */
function PasteBox({ go, onReceived }: { go: (r: string) => void; onReceived?: (walletId: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const open = useAction(async (input?: string) => {
    const value = (input ?? text).trim();
    const d = await rpc<SharedInput>({ type: "sharedDetect", input: value });
    if (d.kind === "signRequest") {
      const r = await rpc<{ walletId: string; preview: TxPreview; merged: boolean }>({ type: "sharedReceive", request: value });
      const w = (await rpc<SharedWalletInfo[]>({ type: "sharedList" })).find((x) => x.id === r.walletId);
      showToast(t(r.merged ? "ms2.requestMerged" : "ms2.requestAdded", { n: String(new Set(r.preview.signedBy).size), m: String(w?.required ?? "?") }));
      setText("");
      if (onReceived) onReceived(r.walletId);
      else go(walletRoute(r.walletId));
    } else if (d.kind === "wallet") {
      const w = await rpc<SharedWalletInfo>({ type: "sharedImport", input: value });
      showToast(t("ms2.imported"));
      setText("");
      go(walletRoute(w.id));
    } else if (d.kind === "cosignerKey") {
      setText("");
      go(`/multisig/new?key=${d.keyHash}`);
    } else throw new Error(t("ms2.unknownInput"));
  });
  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    const value = file ? (await file.text()).trim() : e.dataTransfer.getData("text").trim();
    if (!value) return;
    setText(value);
    void open.run(value);
  };
  return (
    <Card className={cx("space-y-2 p-3", drag && "ring-2 ring-accent")} data-testid="ms-paste"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => void onDrop(e)}>
      <SectionLabel className="mb-0">{t("ms2.pasteTitle")}</SectionLabel>
      <textarea className="field min-h-[64px] resize-none font-mono text-[11px]" aria-label={t("ms2.pasteTitle")} placeholder={t("ms2.pasteAny")} value={text}
        onChange={(e) => { setText(e.target.value); open.setError(""); }}
        onPaste={(e) => { const v = e.clipboardData.getData("text").trim(); if (!v) return; e.preventDefault(); setText(v); void open.run(v); }} />
      <Button block disabled={!text.trim()} loading={open.busy} onClick={() => void open.run()} data-testid="ms-paste-open">{t("ms2.open")}</Button>
      <ErrorText error={open.error} />
    </Card>
  );
}

function KeyCard() {
  const t = useT();
  const [hash, setHash] = useState("");
  const [share, setShare] = useState(false);
  // Chỉ số khóa do ví tự chọn (khóa chưa dùng đầu tiên) — người dùng không cần biết.
  useEffect(() => { void rpc<{ keyHash: string }>({ type: "sharedNext" }).then((k) => setHash(k.keyHash)).catch(() => setHash("")); }, []);
  return (
    <Card className="space-y-2 p-3">
      <SectionLabel className="mb-0">{t("ms2.mykey")}</SectionLabel>
      <p className="text-[11.5px] text-moon-dim">{t("ms2.mykeyHint")}</p>
      <CopyField value={hash} testId="ms-keyhash" />
      <Button block disabled={!hash} onClick={() => setShare(true)} data-testid="ms-share-key"><Share2 size={15} /> {t("ms2.shareKey")}</Button>
      {share && <ShareSheet title={t("ms2.shareKey")} value={hash} filename="multisig-key.txt" onClose={() => setShare(false)} />}
    </Card>
  );
}

function List({ st, go }: { st: AppState; go: (r: string) => void }) {
  const t = useT();
  const [wallets, setWallets] = useState<SharedWalletInfo[]>();
  const load = useAction(async () => setWallets(await rpc<SharedWalletInfo[]>({ type: "sharedList" })));
  // Tự khám phá một lần khi mở tab (im lặng): ví đã đăng ký on-chain sẽ tự hiện, chỉ số khóa tự cập nhật
  useEffect(() => {
    void (async () => {
      await load.run();
      try { await rpc({ type: "sharedDiscover" }); await load.run(); } catch { /* không có mạng/nguồn dữ liệu: bỏ qua */ }
    })();
  }, [st.network, st.active.walletId]); // eslint-disable-line react-hooks/exhaustive-deps
  const discover = useAction(async () => {
    const found = await rpc<SharedWalletInfo[]>({ type: "sharedDiscover" });
    showToast(found.length ? t("ms2.found", { n: String(found.length) }) : t("ms2.none"));
    await load.run();
  });
  return (
    <Screen>
      <TopBar title={t("ms2.title")} right={<NetworkPill net={netOf(st)} />} />
      <div className="space-y-4 animate-fade-up">
        <div className="grid grid-cols-3 gap-2">
          <Button loading={discover.busy} onClick={() => void discover.run()} data-testid="ms-discover"><Radar size={15} /> {t("ms2.discover")}</Button>
          <Button variant="primary" onClick={() => go("/multisig/new")} data-testid="ms-new"><Plus size={15} /> {t("ms2.create")}</Button>
          <Button onClick={() => go("/multisig/import")} data-testid="ms-import"><FileDown size={15} /> {t("ms2.import")}</Button>
        </div>
        <ErrorText error={discover.error || load.error} />
        <PasteBox go={go} />
        {!wallets ? <div className="flex justify-center py-6"><Spinner size={20} /></div> : wallets.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-moon-dim">{t("ms2.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li key={w.id}>
                <button onClick={() => go(walletRoute(w.id))} data-testid="ms-item" className="flex w-full items-center gap-3 rounded-2xl border border-night-700 bg-night-850 p-3 text-left transition hover:border-night-600">
                  <Avatar seed={w.id} size={34}><Users size={16} /></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-ink">{w.name}</div>
                    <div className="text-[11px] text-moon-dim">{t("ms2.of", { m: String(w.required), n: String(w.signers.length) })} · {shorten(w.address, 8)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <KeyCard />
        <a href={MESH_MULTISIG_URL} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 text-[12px] text-accent hover:underline"><ExternalLink size={13} /> {t("ms2.mesh")}</a>
      </div>
    </Screen>
  );
}

type CosignerRow = { name: string; key: string; hash?: string; error?: string };
type Preview = { address: string; paymentScriptHash: string; required: number; total: number; myIndex: number };

/** "Name key" lines (the old textarea format, or several keys pasted at once) -> rows. */
const parseRows = (text: string): CosignerRow[] =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)[\s,:;]+(\S+)$/);
    return m ? { name: m[1]!.trim(), key: m[2]! } : { name: "", key: l };
  });

/**
 * Create a multisig wallet step by step (AI-13): one row per cosigner, each key checked as it is typed,
 * m-of-n on a slider, and the resulting address previewed (with a copy button) before anything is saved.
 */
function Create({ st, go, prefillKey }: { st: AppState; go: (r: string) => void; prefillKey: string }) {
  const t = useT();
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [rows, setRows] = useState<CosignerRow[]>([{ name: "", key: prefillKey }]);
  const [required, setRequired] = useState(2);
  const [preview, setPreview] = useState<Preview>();
  const [previewError, setPreviewError] = useState("");
  const filled = rows.filter((r) => r.key.trim());
  const valid = filled.length > 0 && filled.every((r) => r.hash);
  const n = filled.length + 1;
  const m = Math.min(Math.max(1, required), n);
  const cosigners = filled.map((r, i) => ({ name: r.name.trim() || `Cosigner ${i + 2}`, keyHash: r.hash ?? r.key.trim() }));

  // Check each key locally as it changes
  const keys = rows.map((r) => r.key.trim()).join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(rows.map(async (r) => {
      const key = r.key.trim();
      if (!key) return { ...r, hash: undefined, error: undefined };
      try { return { ...r, hash: await rpc<string>({ type: "sharedCheckKey", input: key }), error: undefined }; }
      catch (e) { return { ...r, hash: undefined, error: e instanceof Error ? e.message : String(e) }; }
    })).then((next) => { if (live) setRows((cur) => cur.map((r, i) => (r.key === next[i]?.key ? next[i]! : r))); });
    return () => { live = false; };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview the address once every key is valid
  const sig = valid ? `${m}|${cosigners.map((c) => c.keyHash).join(",")}` : "";
  useEffect(() => {
    setPreview(undefined);
    setPreviewError("");
    if (!sig) return;
    let live = true;
    void rpc<Preview>({ type: "sharedPreview", required: m, cosigners })
      .then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) setPreviewError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useAction(async () => {
    // Same key index as the preview, so the created address is the one the user saw and copied
    const w = await rpc<SharedWalletInfo>({ type: "sharedCreate", name, required: m, cosigners, myIndex: preview!.myIndex, myName: myName || undefined });
    showToast(t("ms2.created"));
    go(`${walletRoute(w.id)}?created=1`);
  });
  const setRow = (i: number, patch: Partial<CosignerRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Screen footer={<Button variant="primary" block loading={create.busy} disabled={!preview} onClick={() => void create.run()} data-testid="ms-create-submit">{t("ms2.create")}</Button>}>
      <TopBar title={t("ms2.create")} onBack={() => go("/multisig")} right={<NetworkPill net={netOf(st)} />} />
      <div className="space-y-4 animate-fade-up">
        <div className="space-y-2.5">
          <SectionLabel className="mb-0">1 · {t("ms2.stepName")}</SectionLabel>
          <Field label={t("ms2.name")}><input className="field" aria-label={t("ms2.name")} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("ms2.myName")}><input className="field" aria-label={t("ms2.myName")} value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
        </div>

        <div className="space-y-2">
          <SectionLabel className="mb-0">2 · {t("ms2.cosigners")}</SectionLabel>
          <p className="text-[11.5px] text-moon-dim">{t("ms2.cosignerHint")}</p>
          {rows.map((r, i) => (
            <Card key={i} className="space-y-1.5 p-2.5" data-testid="ms-cosigner-row">
              <div className="flex gap-2">
                <input className="field w-28" aria-label={`${t("ms2.cosignerName")} ${i + 1}`} placeholder={t("ms2.cosignerName")} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                <input className={cx("field min-w-0 flex-1 font-mono text-[11px]", r.error && "border-bad/60")} aria-label={`${t("ms2.cosignerKey")} ${i + 1}`} placeholder={t("ms2.cosignerKeyPlaceholder")} value={r.key}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (!text.includes("\n")) return;
                    e.preventDefault();
                    const pasted = parseRows(text); // several "name key" lines at once
                    if (pasted.length) setRows((cur) => [...cur.slice(0, i), ...pasted, ...cur.slice(i + 1)]);
                  }} />
                {rows.length > 1 && <button className="text-moon-dim hover:text-bad" aria-label={t("ms2.removeCosigner")} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
              </div>
              {r.error ? <p className="text-[11px] text-bad">{r.error}</p> : r.hash && <p className="flex items-center gap-1 text-[11px] text-ok"><Check size={12} /> {shorten(r.hash, 10)}</p>}
            </Card>
          ))}
          <Button block onClick={() => setRows((cur) => [...cur, { name: "", key: "" }])} data-testid="ms-add-cosigner"><Plus size={15} /> {t("ms2.addCosigner")}</Button>
        </div>

        <div className="space-y-1.5">
          <SectionLabel className="mb-0">3 · {t("ms2.required")}</SectionLabel>
          <div className="flex items-center gap-3">
            <input type="range" className="flex-1 accent-[rgb(var(--accent))]" min={1} max={n} value={m} aria-label={t("ms2.required")} onChange={(e) => setRequired(Number(e.target.value))} />
            <span className="w-24 text-right text-[13px] font-medium text-ink" data-testid="ms-required">{t("ms2.of", { m: String(m), n: String(n) })}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <SectionLabel className="mb-0">4 · {t("ms2.previewTitle")}</SectionLabel>
          {preview ? (
            <Card className="space-y-2 p-3" data-testid="ms-preview">
              <p className="text-[11.5px] text-moon-dim">{t("ms2.previewHint")}</p>
              <CopyField value={preview.address} testId="ms-preview-address" />
            </Card>
          ) : <p className="text-[11.5px] text-moon-dim">{previewError || t("ms2.previewWaiting")}</p>}
        </div>
        <ErrorText error={create.error} />
      </div>
    </Screen>
  );
}

function Import({ go }: { go: (r: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const imp = useAction(async () => {
    const w = await rpc<SharedWalletInfo>({ type: "sharedImport", input: text, name: name || undefined });
    showToast(t("ms2.imported"));
    go(walletRoute(w.id));
  });
  return (
    <Screen footer={<Button variant="primary" block loading={imp.busy} disabled={!text.trim()} onClick={() => void imp.run()} data-testid="ms-import-submit">{t("ms2.import")}</Button>}>
      <TopBar title={t("ms2.import")} onBack={() => go("/multisig")} />
      <div className="space-y-3.5 animate-fade-up">
        <Field label={t("ms2.name")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("ms2.paste")}><textarea className="field min-h-[140px] resize-none font-mono text-[11.5px]" aria-label={t("ms2.paste")} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <ErrorText error={imp.error} />
      </div>
    </Screen>
  );
}

/** "23h 05m" from slots (preprod: 1 slot = 1 second). */
const fmtDuration = (slots: number) => {
  const h = Math.floor(slots / 3600), m = Math.floor((slots % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/** Who has signed a request and who has not (AI-14). */
function SignerStatus({ signers, signedBy, myKey }: { signers: SharedWalletInfo["signers"]; signedBy: string[]; myKey: string }) {
  const t = useT();
  return (
    <ul className="space-y-1" data-testid="ms-signer-status">
      {signers.map((s, i) => {
        const done = signedBy.includes(s.keyHash);
        return (
          <li key={s.keyHash} className="flex items-center gap-1.5 text-[11.5px]">
            <span className={cx("grid h-4 w-4 place-items-center rounded-full", done ? "bg-ok/20 text-ok" : "bg-night-800 text-moon-dim")}>{done ? <Check size={10} /> : "·"}</span>
            <span className={done ? "text-ink" : "text-moon-dim"}>{s.name || `Cosigner ${i + 1}`}{s.keyHash === myKey ? ` (${t("ms2.you")})` : ""}</span>
            <span className="ml-auto text-[10.5px] text-moon-dim">{done ? t("ms2.signedShort") : t("ms2.waiting")}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PreviewCard({ p, required, mine, own }: { p: TxPreview; required: number; mine?: boolean; own: string }) {
  const t = useT();
  return (
    <div className="space-y-1.5 text-[12px]">
      {p.outputs.map((o, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-moon-soft" title={o.address}>{o.change || o.address === own ? t("ms2.change") : shorten(o.address, 9)}</span>
          <span className="shrink-0 font-medium tabular-nums text-ink">{fmtAda(o.lovelace)}{o.assets.length ? ` + ${o.assets.length} token` : ""}</span>
        </div>
      ))}
      <div className="flex justify-between text-moon-dim"><span>{t("ms2.fee")}</span><span className="tabular-nums">{fmtAda(p.fee)}</span></div>
      {p.net && (
        <div className="space-y-0.5 border-t border-night-700 pt-1.5" data-testid="ms-net">
          <div className="flex justify-between font-semibold text-ink"><span>{t("ms2.net")}</span><span className="tabular-nums">{fmtAda(p.net.lovelace)}</span></div>
          {p.net.assets.map((a) => <div key={a.unit} className="flex justify-between text-ink"><span className="truncate" title={a.unit}>{tokenLabel(a.unit)}</span><span className="tabular-nums">{BigInt(a.quantity).toLocaleString("en-US")}</span></div>)}
        </div>
      )}
      <div className={cx("flex items-center gap-1.5 font-medium", p.enough ? "text-ok" : "text-warn")}>
        {p.enough ? <Check size={13} /> : <ShieldCheck size={13} />} {t("ms2.sigs", { n: String(new Set(p.signedBy).size), m: String(required) })}{mine ? ` · ${t("ms2.signed")}` : ""}
      </div>
    </div>
  );
}

function Detail({ st, id, go, created }: { st: AppState; id: string; go: (r: string) => void; created?: boolean }) {
  const t = useT();
  const net = netOf(st);
  const [w, setW] = useState<SharedWalletInfo | null>();
  const [bal, setBal] = useState<string>();
  const [myKey, setMyKey] = useState("");
  const [reqs, setReqs] = useState<RequestItem[]>();
  const [share, setShare] = useState<{ title: string; value: string; filename: string; extra?: { label: string; value: string } }>();
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [signFor, setSignFor] = useState<{ kind: "propose" } | { kind: "sign"; request: string; preview: TxPreview } | undefined>();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [memo, setMemo] = useState("");

  const reload = useCallback(async () => {
    const list = await rpc<SharedWalletInfo[]>({ type: "sharedList" });
    const cur = list.find((x) => x.id === id) ?? null;
    setW(cur);
    if (!cur) return;
    if (cur.myIndex !== undefined) void rpc<{ keyHash: string }>({ type: "sharedKey", y: cur.myIndex }).then((k) => setMyKey(k.keyHash)).catch(() => setMyKey(""));
    setReqs(await rpc<RequestItem[]>({ type: "sharedRequests", id }));
    void rpc<{ unit: string; quantity: string }[]>({ type: "sharedBalance", id }).then((b) => setBal(b.find((x) => x.unit === "lovelace")?.quantity ?? "0")).catch(() => setBal(undefined));
  }, [id]);
  const load = useAction(reload);
  useEffect(() => { void load.run(); }, [id, st.network, st.active.walletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const register = useAction(async () => { const h = await rpc<string>({ type: "sharedRegister", id }); showToast(t("ms2.registered"), net.explorerTxUrl + h); await reload(); });
  const act = useAction(async (password: string) => {
    if (!signFor) return;
    if (signFor.kind === "propose") {
      const lov = parseAda(amt);
      if (lov === null) throw new Error("Số ADA không hợp lệ");
      await rpc<string>({ type: "sharedPropose", id, to: to.trim(), lovelace: lov.toString(), memo: memo || undefined, password });
      setTo(""); setAmt(""); setMemo("");
    } else {
      const signed = await rpc<{ request: string; preview: TxPreview }>({ type: "sharedSign", request: signFor.request, password });
      if (autoSubmit && signed.preview.enough) {
        // Last required signature: submit right away instead of a second click (AI-14)
        const h = await rpc<string>({ type: "sharedSubmit", request: signed.request });
        showToast(t("ms2.submitted"), net.explorerTxUrl + h);
      }
    }
    setSignFor(undefined);
    await reload();
  });
  // Full check (inputs against the wallet's UTxOs, net outflow) before the sign sheet opens (AI-45)
  const [reviewing, setReviewing] = useState("");
  const review = useAction(async (request: string) => {
    act.setError("");
    setReviewing(request);
    const info = await rpc<{ preview: TxPreview }>({ type: "sharedInspect", request });
    setSignFor({ kind: "sign", request, preview: info.preview });
  });
  const submit = useAction(async (request: string) => { const h = await rpc<string>({ type: "sharedSubmit", request }); showToast(t("ms2.submitted"), net.explorerTxUrl + h); await reload(); });
  const remove = useAction(async () => { if (!w || !confirm(t("ms2.removeConfirm", { name: w.name }))) return; await rpc({ type: "sharedRemove", id }); go("/multisig"); });

  if (w === undefined) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (w === null) return <Screen><TopBar title={t("ms2.title")} onBack={() => go("/multisig")} /><Notice tone="warn">…</Notice></Screen>;
  const canSign = w.myIndex !== undefined;

  return (
    <>
      <Screen>
        <TopBar title={w.name} onBack={() => go("/multisig")} right={<NetworkPill net={net} />} />
        <div className="space-y-4 animate-fade-up">
          {created && (
            <Card className="space-y-2.5 border-ok/40 p-3" data-testid="ms-created">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ok"><Check size={15} /> {t("ms2.created")}</div>
              <p className="text-[11.5px] text-moon-dim">{t("ms2.createdHint")}</p>
              <CopyField value={w.address} testId="ms-created-address" />
              <Button block onClick={() => void rpc<string>({ type: "sharedExport", id }).then((j) => setShare({ title: t("ms2.shareWallet"), value: j, filename: `multisig-wallet-${w.paymentScriptHash.slice(0, 8)}.json` }))} data-testid="ms-created-share"><Share2 size={15} /> {t("ms2.shareWallet")}</Button>
              {!w.registeredTx && canSign && (
                <>
                  <p className="text-[11.5px] text-moon-dim">{t("ms2.registerHint")}</p>
                  <Button variant="primary" block loading={register.busy} onClick={() => void register.run()} data-testid="ms-created-register">{t("ms2.register")}</Button>
                  <ErrorText error={register.error} />
                </>
              )}
            </Card>
          )}
          <Card className="space-y-2 p-3">
            <div className="flex items-end justify-between">
              <div><div className="text-[11px] uppercase tracking-wide text-moon-dim">{t("ms2.balance")}</div><div className="text-[26px] font-semibold tabular-nums text-ink" data-testid="ms-balance">{bal === undefined ? t("ms2.balanceLoading") : fmtAda(bal)} <span className="text-[13px] text-moon-dim">{net.unit}</span></div></div>
              <div className="text-[12px] font-medium text-moon-soft">{t("ms2.of", { m: String(w.required), n: String(w.signers.length) })}</div>
            </div>
            <CopyField value={w.address} testId="ms-address" />
            <p className="text-[11px] leading-relaxed text-moon-dim">{t("ms2.fundHint")}</p>
          </Card>

          <div>
            <SectionLabel>{t("ms2.signers")}</SectionLabel>
            <ul className="space-y-1.5">
              {w.signers.map((s, i) => (
                <li key={s.keyHash} className="flex items-center gap-2 text-[12px]">
                  <Avatar seed={s.keyHash} size={22}>{(s.name || "?").slice(0, 1).toUpperCase()}</Avatar>
                  <span className="font-medium text-ink">{s.name || `Cosigner ${i + 1}`}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-moon-dim">{shorten(s.keyHash, 8)}</span>
                  {s.keyHash === myKey && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("ms2.you")}</span>}
                </li>
              ))}
            </ul>
            {!canSign && <Notice tone="warn">{t("ms2.noKey")}</Notice>}
          </div>

          {canSign && (
            <Card className="space-y-2.5 p-3">
              <SectionLabel className="mb-0">{t("ms2.propose")}</SectionLabel>
              <textarea className="field min-h-[60px] resize-none font-mono text-[11.5px]" aria-label={t("ms2.to")} placeholder={`${net.addressPrefix}…`} value={to} onChange={(e) => setTo(e.target.value)} />
              <input className="field" inputMode="decimal" aria-label={t("ms2.amount")} placeholder={t("ms2.amount")} value={amt} onChange={(e) => setAmt(e.target.value)} />
              <input className="field" aria-label={t("ms2.memo")} placeholder={t("ms2.memo")} value={memo} onChange={(e) => setMemo(e.target.value)} />
              <Button variant="primary" block disabled={!to.trim() || !amt} data-testid="ms-propose" onClick={() => { act.setError(""); setSignFor({ kind: "propose" }); }}>{t("ms2.propose")}</Button>
            </Card>
          )}

          <div>
            <SectionLabel>{t("ms2.pending")}</SectionLabel>
            {!reqs ? <Spinner size={18} /> : reqs.length === 0 ? <p className="text-[12px] text-moon-dim">{t("ms2.noPending")}</p> : (
              <ul className="space-y-2">
                {reqs.map((r) => (
                  <li key={r.preview.txHash} data-testid="ms-request">
                    <Card className="space-y-2 p-3">
                      {r.memo && <div className="text-[12.5px] font-medium text-ink">{r.memo}</div>}
                      <PreviewCard p={r.preview} required={w.required} mine={r.iSigned} own={w.address} />
                      <SignerStatus signers={w.signers} signedBy={r.preview.signedBy} myKey={myKey} />
                      {r.slotsLeft !== undefined && !r.expired && <p className="text-[11px] text-moon-dim" data-testid="ms-time-left">{t("ms2.timeLeft", { t: fmtDuration(r.slotsLeft) })}</p>}
                      {r.stale && <Notice tone="warn">{t("ms2.stale")}</Notice>}
                      {r.expired && <Notice tone="warn">{t("ms2.expired")}</Notice>}
                      <div className="grid grid-cols-2 gap-2">
                        <Button data-testid="ms-share-request" onClick={() => void rpc<string>({ type: "sharedRequestCbor", request: r.request }).then((cbor) => setShare({
                          title: t("ms2.shareRequest"), value: r.request, filename: `multisig-request-${r.preview.txHash.slice(0, 8)}.json`, extra: { label: t("ms2.copyCbor"), value: cbor },
                        }))}><Share2 size={15} /> {t("ms2.shareRequest")}</Button>
                        {r.preview.enough
                          ? <Button variant="primary" loading={submit.busy} disabled={r.stale || r.expired} onClick={() => void submit.run(r.request)} data-testid="ms-submit">{t("ms2.submit")}</Button>
                          : <Button variant="primary" disabled={r.iSigned || !canSign || r.stale || r.expired} loading={review.busy && reviewing === r.request} onClick={() => void review.run(r.request)} data-testid="ms-sign">{t("ms2.sign")}</Button>}
                      </div>
                      {reviewing === r.request && <ErrorText error={review.error} />}
                      <button className="text-[11px] text-moon-dim hover:text-bad" onClick={() => void rpc({ type: "sharedDismiss", id, request: r.request }).then(reload)}>{t("ms2.dismiss")}</button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <ErrorText error={submit.error} />
          </div>

          <PasteBox go={go} onReceived={(wid) => (wid === id ? void reload() : go(walletRoute(wid)))} />

          <Card className="space-y-2 p-3">
            {w.registeredTx ? <div className="flex items-center gap-1.5 text-[12px] text-ok"><Check size={14} /> {t("ms2.registered")}</div> : canSign && (
              <>
                <p className="text-[11.5px] text-moon-dim">{t("ms2.registerHint")}</p>
                <Button block loading={register.busy} onClick={() => void register.run()} data-testid="ms-register">{t("ms2.register")}</Button>
                <ErrorText error={register.error} />
              </>
            )}
            <Button block onClick={() => void rpc<string>({ type: "sharedExport", id }).then((j) => setShare({ title: t("ms2.shareWallet"), value: j, filename: `multisig-wallet-${w.paymentScriptHash.slice(0, 8)}.json` }))} data-testid="ms-export"><Share2 size={15} /> {t("ms2.shareWallet")}</Button>
            <Button variant="danger" block onClick={() => void remove.run()}><Trash2 size={15} /> {t("ms2.remove")}</Button>
          </Card>
          <ErrorText error={load.error} />
        </div>
      </Screen>
      {share && <ShareSheet {...share} onClose={() => setShare(undefined)} />}
      {signFor && (
        <SignSheet title={t("ms2.reviewTitle")} onSign={(pw) => void act.run(pw)} onCancel={() => setSignFor(undefined)} busy={act.busy} error={act.error}>
          {signFor.kind === "propose"
            ? <Card className="space-y-1 p-3"><div className="text-[22px] font-semibold tabular-nums text-ink">{amt} {net.unit}</div><div className="break-all font-mono text-[11.5px] text-moon">{to.trim()}</div></Card>
            : (
              <>
                <Card className="space-y-2 p-3">
                  {signFor.preview.memo && <div className="text-[12.5px] font-medium text-ink">{signFor.preview.memo}</div>}
                  <PreviewCard p={signFor.preview} required={w.required} own={w.address} />
                </Card>
                {new Set(signFor.preview.signedBy).size + 1 >= w.required && (
                  <Checkbox checked={autoSubmit} onChange={setAutoSubmit}>{t("ms2.autoSubmit")}</Checkbox>
                )}
              </>
            )}
        </SignSheet>
      )}
    </>
  );
}
