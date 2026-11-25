// Shared UI in the CKBolt style: ink on paper, pills to act, squares to label, mono for machine-made text,
// color only for state (ok = settled, warn = pending / action needed, bad = failed).
import { useEffect, useId, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";
import { Check, CheckCircle2, ChevronLeft, ExternalLink, KeyRound, Loader2, X } from "lucide-react";
import { DynamicIsland } from "./cult/DynamicIsland";
import { TextureCard } from "./cult/TextureCard";
import { TextureButton, type TextureVariant } from "./cult/TextureButton";
import { CopyIcon } from "./cult/CopyButton";
import { useT } from "../i18n";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Screen({ children, footer, className }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cx("scroll-area flex-1 overflow-y-auto px-4 pb-4", className)}>{children}</div>
      {footer && <div className="border-t border-hair bg-night-950 px-4 py-3">{footer}</div>}
    </div>
  );
}

export function TopBar({ title, onBack, left, right }: { title?: ReactNode; onBack?: () => void; left?: ReactNode; right?: ReactNode }) {
  const t = useT();
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-14 items-center gap-2 border-b border-hair bg-night-950 px-4">
      {onBack && <IconButton label={t("common.back")} onClick={onBack}><ChevronLeft size={18} /></IconButton>}
      {left}
      {title && <h1 className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-display text-ink">{title}</h1>}
      {!title && <div className="flex-1" />}
      <div className="flex items-center gap-1.5">{right}</div>
    </header>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const hasPadding = /(^|\s)p-\d/.test(className ?? "");
  return <TextureCard {...rest} innerClassName={cx(!hasPadding && "p-4", className)}>{children}</TextureCard>;
}

/** Eyebrow label: a 1px rule, then mono text (the site's section labels). */
export const SectionLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx("mb-2.5 flex items-center gap-2.5 font-mono text-[11px] text-moon-soft", className)}>
    <span aria-hidden className="h-px w-5 shrink-0 bg-moon-soft/60" />
    <span className="min-w-0 truncate">{children}</span>
  </div>
);

/** Square mono tag with a hairline (ticker, "You", …). */
export const Tag = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 border border-hair px-1.5 py-px font-mono text-[10.5px] text-moon-soft", className)}>{children}</span>
);

export function Button({ variant = "secondary", loading, className, children, block, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: TextureVariant; loading?: boolean; block?: boolean }) {
  return (
    <TextureButton variant={variant} className={cx(block && "w-full", className)} disabled={rest.disabled || loading} {...rest}>
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </TextureButton>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx("grid h-9 w-9 place-items-center rounded-full text-moon-soft transition-colors hover:bg-night-850 hover:text-ink disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}

/** Dashboard action: square icon box with a hairline that inverts to ink on hover; the primary action is ink already. */
export function ActionButton({ icon, label, onClick, highlight, disabled }: { icon: ReactNode; label: string; onClick: () => void; highlight?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="group flex flex-col items-center gap-1.5 disabled:opacity-40">
      <span className={cx("grid h-12 w-12 place-items-center border transition-colors",
        highlight ? "border-ink bg-ink text-night-950" : "border-hair bg-night-900 text-ink group-enabled:group-hover:border-ink group-enabled:group-hover:bg-ink group-enabled:group-hover:text-night-950")}>
        {icon}
      </span>
      <span className="text-[12px] text-moon-soft group-enabled:group-hover:text-ink">{label}</span>
    </button>
  );
}

export function Field({ label, hint, children, group }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const body = (<><span className="text-[12px] font-medium text-ink">{label}</span>{children}{hint && <span className="block text-[11px] leading-relaxed text-moon-dim">{hint}</span>}</>);
  return group ? <div role="group" aria-label={label} className="block space-y-1.5">{body}</div> : <label className="block space-y-1.5">{body}</label>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  const id = useId();
  return (
    <div role="tablist" className="grid gap-1 rounded-full border border-hair bg-night-900 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cx("relative h-8 truncate rounded-full px-2 text-[12.5px] transition-colors", value === v ? "text-on-accent" : "text-moon-soft hover:text-ink")}>
          {value === v && <motion.span layoutId={`seg-${id}`} transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} className="absolute inset-0 rounded-full bg-accent" />}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-moon">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border border-hair-strong bg-night-900 text-on-accent transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ink/60">
        {checked && <Check size={12} strokeWidth={2.5} />}
      </span>
      {children}
    </label>
  );
}

export const ErrorText = ({ error }: { error?: string }) =>
  error ? <p role="alert" className="error tone-bad animate-fade-up whitespace-pre-wrap border px-3 py-2 text-[12px] leading-relaxed">{error}</p> : null;

export const Notice = ({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) => (
  <p className={cx("border px-3 py-2.5 text-[12px] leading-relaxed",
    tone === "warn" && "tone-warn", tone === "ok" && "tone-ok", tone === "info" && "border-hair bg-night-850 text-moon-soft")}>
    {children}
  </p>
);

export const Spinner = ({ size = 28 }: { size?: number }) => <Loader2 size={size} className="animate-spin text-moon-dim" aria-label={useT()("common.loading")} />;

/** Square initial box. No generated colors: in this system color only means state. */
export function Avatar({ seed, size = 32, children }: { seed: string; size?: number; children?: ReactNode }) {
  return (
    <span data-seed={seed} className="grid shrink-0 place-items-center border border-hair bg-night-850 font-mono uppercase text-ink" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {children}
    </span>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: (v: string) => {
      void navigator.clipboard?.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
  };
}

export function CopyField({ value, display, className, testId }: { value: string; display?: string; className?: string; testId?: string }) {
  const { copied, copy } = useCopy();
  const t = useT();
  return (
    <button type="button" onClick={() => copy(value)} aria-label={t("common.copy")} className={cx("flex w-full items-start gap-2 border border-hair bg-night-900 px-3 py-2.5 text-left transition-colors hover:border-hair-strong", className)}>
      <span data-testid={testId} className="min-w-0 flex-1 break-all font-mono text-[11.5px] leading-relaxed text-ink">{display ?? value}</span>
      <span className={cx("mt-0.5 shrink-0", copied ? "text-ok" : "text-moon-dim")}><CopyIcon copied={copied} size={15} /></span>
    </button>
  );
}

export function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(value, { margin: 1, width: 220, color: { dark: "#080503", light: "#ffffff" } }).then(setSrc); }, [value]);
  return <div className="mx-auto grid h-[236px] w-[236px] place-items-center border border-hair bg-white p-2">{src && <img src={src} alt="QR" className="h-full w-full" />}</div>;
}

export function WalletLogo({ size = 40 }: { size?: number }) {
  // TEX Wallet mark (assets/logo.svg): a straight-stroke "C" with a square clasp. Ink tile with a paper mark;
  // in dark mode the colors swap (paper tile, ink mark). Below 24 px use the heavier logo-16 strokes.
  const small = size < 24;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" style={{ fill: "rgb(var(--ink))" }} />
      <g style={{ stroke: "rgb(var(--night-950))", fill: "rgb(var(--night-950))" }}>
        {small
          ? <><path d="M47 16H26a9 9 0 0 0-9 9v14a9 9 0 0 0 9 9h21" fill="none" strokeWidth="8" /><rect x="36" y="27" width="10" height="10" stroke="none" /></>
          : <><path d="M46 17H26a8 8 0 0 0-8 8v14a8 8 0 0 0 8 8h20" fill="none" strokeWidth="6.5" /><rect x="37" y="28" width="8" height="8" stroke="none" /></>}
      </g>
    </svg>
  );
}

/** Outline status pill with a 6px state dot (the site's "Fiber node" pill). */
export const StatusPill = ({ children, tone = "ok", testId }: { children: ReactNode; tone?: "ok" | "warn" | "bad"; testId?: string }) => (
  <span data-testid={testId} className="flex items-center gap-1.5 rounded-full border border-hair-strong px-2.5 py-1 text-[11.5px] text-ink">
    <span className={cx("h-1.5 w-1.5 rounded-full", tone === "ok" && "bg-ok-bright", tone === "warn" && "bg-warn-bright", tone === "bad" && "bg-bad")} />
    {children}
  </span>
);

/** Bottom sheet: square, hairline on top, ink scrim. */
export function Sheet({ label, children, className, testId }: { label: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgb(8_5_3/0.45)] animate-fade-up" role="dialog" aria-modal="true" aria-label={label}>
      <div data-testid={testId} className={cx("max-h-[92%] overflow-y-auto border-t border-hair bg-night-950 p-4", className)}>{children}</div>
    </div>
  );
}

// ---------- Ký giao dịch (nhập lại mật khẩu) ----------

export function SignForm({ onSign, busy, error, submitLabel }: { onSign: (password: string) => void; busy: boolean; error?: string; submitLabel?: string }) {
  const t = useT();
  const [pw, setPw] = useState("");
  useEffect(() => {
    if (!busy) return;
    showBusy(t("send.signing"));
    return clearBusy;
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="space-y-2.5" data-testid="sign-form" onSubmit={(e) => { e.preventDefault(); if (pw) onSign(pw); }}>
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-ink">{t("sign.password")}</span>
        <div className="relative">
          <KeyRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-moon-dim" />
          <input className="field pl-10" type="password" aria-label={t("sign.password")} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
      </label>
      <ErrorText error={error} />
      <Button variant="primary" block type="submit" disabled={!pw || busy}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? t("send.signing") : (submitLabel ?? t("send.sign"))}
      </Button>
    </form>
  );
}

export function SignSheet({ title, children, onSign, onCancel, busy, error }: { title: string; children: ReactNode; onSign: (password: string) => void; onCancel: () => void; busy: boolean; error?: string }) {
  const t = useT();
  return (
    <Sheet label={title}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center border border-hair text-ink"><KeyRound size={17} /></span>
        <h2 className="flex-1 text-[16px] font-medium tracking-display text-ink">{title}</h2>
        <IconButton label={t("common.cancel")} onClick={onCancel} disabled={busy}><X size={16} /></IconButton>
      </div>
      <div className="mb-3 space-y-2">{children}</div>
      <p className="mb-3 text-[11px] leading-relaxed text-moon-dim">{t("sign.note")}</p>
      <SignForm onSign={onSign} busy={busy} error={error} />
    </Sheet>
  );
}

/** Longest text shown as a QR code; longer data is shared by copy or file only. */
export const QR_MAX_CHARS = 1000;

/**
 * Share one piece of data three ways (AI-12): a QR code when it is short enough to scan, a copy button,
 * and a file download. `extra` adds one more copy action, e.g. raw CBOR for other wallets.
 */
export function ShareSheet({ title, value, filename, extra, onClose }: {
  title: string; value: string; filename: string; extra?: { label: string; value: string }; onClose: () => void;
}) {
  const t = useT();
  const main = useCopy();
  const second = useCopy();
  const download = () => {
    const url = URL.createObjectURL(new Blob([value], { type: filename.endsWith(".json") ? "application/json" : "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Sheet label={title} className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[16px] font-medium tracking-display text-ink">{title}</h2>
        <IconButton label={t("common.close")} onClick={onClose}><X size={16} /></IconButton>
      </div>
      {value.length <= QR_MAX_CHARS ? <Qr value={value} /> : <Notice>{t("share.qrTooLong")}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={() => main.copy(value)} data-testid="share-copy"><CopyIcon copied={main.copied} size={15} /> {t("common.copy")}</Button>
        <Button onClick={download} data-testid="share-download">{t("share.download")}</Button>
      </div>
      {extra && <Button block onClick={() => second.copy(extra.value)} data-testid="share-extra"><CopyIcon copied={second.copied} size={15} /> {extra.label}</Button>}
    </Sheet>
  );
}

// ---------- Thông báo (status pill) ----------

type Island = { kind: "busy"; message: string } | { kind: "success"; message: string; href?: string };
let island: Island | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const setIsland = (next: Island | null) => { island = next; listeners.forEach((l) => l()); };

export function showToast(message: string, href?: string) {
  clearTimeout(hideTimer);
  setIsland({ kind: "success", message, href });
  hideTimer = setTimeout(() => setIsland(null), 7000);
}
export function showBusy(message: string) { clearTimeout(hideTimer); setIsland({ kind: "busy", message }); }
export function clearBusy() { if (island?.kind === "busy") setIsland(null); }
export const dismissToast = () => setIsland(null);

export function Toaster() {
  const t = useT();
  const current = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => island);
  return (
    <DynamicIsland open={!!current} size={current?.kind === "success" ? "long" : "compact"} testId={current?.kind === "success" ? "toast" : "island-busy"}>
      {current?.kind === "busy" && (<><Loader2 size={15} className="shrink-0 animate-spin opacity-70" /><span className="truncate text-[12.5px]">{current.message}</span></>)}
      {current?.kind === "success" && (
        <>
          <CheckCircle2 size={20} className="shrink-0 text-ok-bright" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{current.message}</p>
            {current.href && <a href={current.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] opacity-70 hover:underline">{t("common.explorer")} <ExternalLink size={11} /></a>}
          </div>
          <button aria-label="dismiss" onClick={dismissToast} className="grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"><X size={14} /></button>
        </>
      )}
    </DynamicIsland>
  );
}
