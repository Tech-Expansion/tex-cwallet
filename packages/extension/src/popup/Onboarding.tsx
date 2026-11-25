import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, KeyRound, Download } from "lucide-react";
import { rpc } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Button, Checkbox, ErrorText, Field, Notice, Screen, Segmented, StatusPill, TopBar, WalletLogo, cx } from "./ui/ui";

/** Full-screen paper page with the site's faint vertical grid, logo + wordmark on top, network pill on the right. */
function Poster({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="bg-grid flex h-full flex-col px-6 pb-6 pt-5">
      <div className="flex items-center gap-2.5">
        <WalletLogo size={26} />
        <span className="text-[17px] tracking-display text-ink">{t("welcome.title")}</span>
        <span className="flex-1" />
        <StatusPill>Preprod</StatusPill>
      </div>
      {children}
    </div>
  );
}

export function Welcome({ go }: { go: (r: string) => void }) {
  const t = useT();
  return (
    <Poster>
      <div className="mt-auto space-y-5 animate-fade-up">
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-moon-soft">
          <span aria-hidden className="h-px w-8 bg-moon-soft/60" />
          CIP-30 · CIP-1852 · CIP-1854
        </div>
        <h1 className="text-[44px] leading-[0.95] tracking-display text-ink">{t("welcome.title")}</h1>
        <p className="text-[15px] leading-relaxed text-moon-soft">{t("welcome.sub")}</p>
      </div>
      <div className="mt-8 space-y-2.5">
        <Button variant="primary" block className="h-12" onClick={() => go("/create")}>{t("welcome.create")} <ArrowRight size={16} /></Button>
        <Button block className="h-12" onClick={() => go("/import")}><Download size={16} /> {t("welcome.import")}</Button>
      </div>
    </Poster>
  );
}

type Mode = "new" | "import" | "watch";

/**
 * Tạo / nhập / theo dõi ví. `needPassword`: lần đầu (chưa có mật khẩu) → yêu cầu đặt mật khẩu trước.
 */
export function WalletForm({ initial, needPassword, onDone, onBack }: { initial: Mode; needPassword: boolean; onDone: () => void; onBack?: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(initial);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [ok, setOk] = useState(false);

  const gen = useAction(async () => setWords(await rpc<string[]>({ type: "newMnemonic" })));
  useEffect(() => { if (mode === "new" && !words.length) void gen.run(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(async () => {
    if (needPassword) {
      if (pw !== pw2) throw new Error(t("setup.mismatch"));
      await rpc({ type: "setup", password: pw });
    }
    if (mode === "watch") await rpc({ type: "addWatch", name: name || "Watch", address: text.trim() });
    else await rpc({ type: "addWallet", name: name || "Wallet", mnemonic: mode === "new" ? words.join(" ") : text });
    onDone();
  });

  const disabled = (needPassword && (!pw || !pw2)) || (mode === "new" ? !ok || !words.length : !text.trim());

  return (
    <Screen
      footer={<Button variant="primary" block loading={save.busy} disabled={disabled} onClick={() => void save.run()}>{mode === "new" ? t("create.submit") : t("common.save")}</Button>}
    >
      <TopBar title={needPassword ? t("setup.title") : t("wallets.add")} onBack={onBack} />
      <div className="space-y-3.5 animate-fade-up">
        <Segmented value={mode} onChange={setMode} options={[["new", t("welcome.create")], ["import", t("import.mode.seed")], ["watch", t("import.mode.watch")]] as const} />
        {needPassword && (
          <>
            <Notice>{t("setup.hint")}</Notice>
            <Field label={t("setup.pw")}><input className="field" type="password" aria-label={t("setup.pw")} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t("setup.pw2")}><input className="field" type="password" aria-label={t("setup.pw2")} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          </>
        )}
        <Field label={t("create.name")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wallet 1" /></Field>
        {mode === "new" && (
          <>
            <Notice tone="warn">{t("create.warn")}</Notice>
            <div className="grid grid-cols-3 border-l border-t border-hair bg-night-900" data-testid="words">
              {words.map((w, i) => (
                <span key={i} className="word border-b border-r border-hair px-2 py-1.5 font-mono text-[11.5px] text-ink"><span className="inline-block w-5 text-moon-dim">{i + 1}</span>{w}</span>
              ))}
            </div>
            <Checkbox checked={ok} onChange={setOk}>{t("create.confirm")}</Checkbox>
          </>
        )}
        {mode === "import" && <Field label={t("import.words")}><textarea className="field min-h-[96px] resize-none" value={text} onChange={(e) => setText(e.target.value)} /></Field>}
        {mode === "watch" && <Field label={t("import.watchAddr")} hint={t("import.watchHint")}><textarea className="field min-h-[72px] resize-none font-mono" value={text} onChange={(e) => setText(e.target.value)} data-testid="watch-input" /></Field>}
        <ErrorText error={save.error || gen.error} />
      </div>
    </Screen>
  );
}

export function Unlock({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const a = useAction(async () => { await rpc({ type: "unlock", password: pw }); onDone(); });
  return (
    <Poster>
      <div className="mt-auto space-y-3 animate-fade-up">
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-moon-soft">
          <span aria-hidden className="h-px w-8 bg-moon-soft/60" />
          AES-GCM · PBKDF2
        </div>
        <h1 className="text-[36px] leading-[0.95] tracking-display text-ink">{t("unlock.title")}</h1>
      </div>
      <form className="mt-6 w-full space-y-3" onSubmit={(e) => { e.preventDefault(); if (pw) void a.run(); }}>
        <div className="relative">
          <KeyRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-moon-dim" />
          <input className={cx("field pl-10")} type="password" autoFocus aria-label={t("common.password")} placeholder={t("unlock.hint")} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <ErrorText error={a.error} />
        <Button variant="primary" block className="h-12" type="submit" loading={a.busy} disabled={!pw}>{t("unlock.submit")}</Button>
      </form>
    </Poster>
  );
}
