import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Plus, Download } from "lucide-react";
import { rpc } from "./rpc";
import { useAction } from "./hooks";
import { useT } from "./i18n";
import { Button, Checkbox, ErrorText, Field, Notice, Screen, Segmented, TopBar, WalletLogo, Stars, cx } from "./ui/ui";

export function Welcome({ go }: { go: (r: string) => void }) {
  const t = useT();
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden px-6 text-center">
      <Stars count={22} />
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 0.7 }} className="relative">
        <div className="absolute inset-0 -z-10 rounded-full bg-accent/30 blur-2xl" />
        <WalletLogo size={84} />
      </motion.div>
      <div className="relative space-y-2">
        <h1 className="text-[22px] font-semibold text-ink">{t("welcome.title")}</h1>
        <p className="text-[13px] leading-relaxed text-moon-soft">{t("welcome.sub")}</p>
      </div>
      <div className="relative w-full space-y-2.5">
        <Button variant="primary" block onClick={() => go("/create")}><Plus size={16} /> {t("welcome.create")}</Button>
        <Button block onClick={() => go("/import")}><Download size={16} /> {t("welcome.import")}</Button>
      </div>
    </div>
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
            <div className="grid grid-cols-3 gap-1.5" data-testid="words">
              {words.map((w, i) => (
                <span key={i} className="word rounded-lg border border-night-700 bg-night-900 px-2 py-1.5 text-[11.5px] text-moon"><span className="text-moon-dim">{i + 1}.</span> {w}</span>
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
    <div className="relative flex h-full flex-col items-center justify-center gap-5 overflow-hidden px-6">
      <Stars count={18} />
      <WalletLogo size={64} />
      <h1 className="relative text-[20px] font-semibold text-ink">{t("unlock.title")}</h1>
      <form className="relative w-full space-y-3" onSubmit={(e) => { e.preventDefault(); if (pw) void a.run(); }}>
        <div className="relative">
          <KeyRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-moon-dim" />
          <input className={cx("field pl-10")} type="password" autoFocus aria-label={t("common.password")} placeholder={t("unlock.hint")} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <ErrorText error={a.error} />
        <Button variant="primary" block type="submit" loading={a.busy} disabled={!pw}>{t("unlock.submit")}</Button>
      </form>
    </div>
  );
}
