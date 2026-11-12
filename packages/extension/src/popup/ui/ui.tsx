// Thành phần giao diện dùng chung — hệ thiết kế lấy từ wallet-midnight (Cult UI + Aceternity UI, Tailwind, token night/moon/accent).
import { useEffect, useId, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";
import { Check, CheckCircle2, ChevronLeft, ExternalLink, KeyRound, Loader2, X } from "lucide-react";
import { MovingBorderButton } from "./aceternity/MovingBorder";
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
      {footer && <div className="border-t border-night-800 bg-night-950/90 px-4 py-3 backdrop-blur">{footer}</div>}
    </div>
  );
}

export function TopBar({ title, onBack, left, right }: { title?: ReactNode; onBack?: () => void; left?: ReactNode; right?: ReactNode }) {
  const t = useT();
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-3 flex h-14 items-center gap-2 bg-night-950/85 px-4 backdrop-blur">
      {onBack && <IconButton label={t("common.back")} onClick={onBack}><ChevronLeft size={18} /></IconButton>}
      {left}
      {title && <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</h1>}
      {!title && <div className="flex-1" />}
      <div className="flex items-center gap-1.5">{right}</div>
    </header>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const hasPadding = /(^|\s)p-\d/.test(className ?? "");
  return <TextureCard {...rest} innerClassName={cx(!hasPadding && "p-4", className)}>{children}</TextureCard>;
}

export const SectionLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx("mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-moon-dim", className)}>{children}</div>
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
    <button aria-label={label} title={label} className={cx("grid h-9 w-9 place-items-center rounded-xl text-moon-soft transition hover:bg-night-800 hover:text-moon disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}

export function ActionButton({ icon, label, onClick, highlight, disabled }: { icon: ReactNode; label: string; onClick: () => void; highlight?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="group flex flex-col items-center gap-1.5 disabled:opacity-40">
      <span className={cx("grid h-12 w-12 place-items-center rounded-2xl border transition group-hover:-translate-y-0.5 group-active:scale-95",
        highlight ? "border-accent/60 bg-gradient-to-b from-brand-mid to-brand-deep text-on-accent shadow-glow" : "border-night-700 bg-night-850 text-moon group-hover:border-night-600")}>
        {icon}
      </span>
      <span className="text-[12px] font-medium text-moon-soft group-hover:text-moon">{label}</span>
    </button>
  );
}

export function Field({ label, hint, children, group }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const body = (<><span className="text-[12px] font-medium text-moon-soft">{label}</span>{children}{hint && <span className="block text-[11px] text-moon-dim">{hint}</span>}</>);
  return group ? <div role="group" aria-label={label} className="block space-y-1.5">{body}</div> : <label className="block space-y-1.5">{body}</label>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  const id = useId();
  return (
    <div role="tablist" className="grid gap-1 rounded-xl border border-night-800 bg-night-900 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cx("relative h-8 truncate rounded-lg px-2 text-[12px] font-medium transition-colors", value === v ? "text-ink" : "text-moon-dim hover:text-moon")}>
          {value === v && <motion.span layoutId={`seg-${id}`} transition={{ type: "spring", bounce: 0.25, duration: 0.5 }} className="absolute inset-0 rounded-lg bg-night-700 shadow-sm" />}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-moon-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-night-600 bg-night-900 text-on-accent transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60">
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      {children}
    </label>
  );
}

export const ErrorText = ({ error }: { error?: string }) =>
  error ? <p role="alert" className="error animate-fade-up whitespace-pre-wrap rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</p> : null;

export const Notice = ({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) => (
  <p className={cx("rounded-xl border px-3 py-2 text-[12px] leading-relaxed",
    tone === "warn" && "border-warn/30 bg-warn/10 text-warn", tone === "ok" && "border-ok/30 bg-ok/10 text-ok", tone === "info" && "border-night-700 bg-night-850 text-moon-soft")}>
    {children}
  </p>
);

export const Spinner = ({ size = 28 }: { size?: number }) => <Loader2 size={size} className="animate-spin text-accent" aria-label={useT()("common.loading")} />;

export function Avatar({ seed, size = 32, children }: { seed: string; size?: number; children?: ReactNode }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 50) % 360} 70% 40%))` }}>
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
    <button type="button" onClick={() => copy(value)} aria-label={t("common.copy")} className={cx("flex w-full items-start gap-2 rounded-xl border border-night-700 bg-night-900 px-3 py-2.5 text-left transition hover:border-night-600", className)}>
      <span data-testid={testId} className="min-w-0 flex-1 break-all font-mono text-[11.5px] leading-relaxed text-moon">{display ?? value}</span>
      <span className={cx("mt-0.5 shrink-0", copied ? "text-ok" : "text-moon-dim")}><CopyIcon copied={copied} size={15} /></span>
    </button>
  );
}

export function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(value, { margin: 1, width: 220, color: { dark: "#0b1020", light: "#ffffff" } }).then(setSrc); }, [value]);
  return <div className="mx-auto grid h-[236px] w-[236px] place-items-center rounded-2xl bg-white p-2">{src && <img src={src} alt="QR" className="h-full w-full" />}</div>;
}

export function WalletLogo({ size = 40 }: { size?: number }) {
  // Logo "C" mở + ba chấm (nhiều ví); bản gốc: assets/logo.svg. id riêng để nhiều logo không giành gradient của nhau.
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "rgb(var(--logo-hi))" }} />
          <stop offset="1" style={{ stopColor: "rgb(var(--logo-lo))" }} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#${id}g)`} />
      <circle cx="32" cy="32" r="30" fill={`url(#${id}s)`} />
      <path d="M43.3 20.7A17 17 0 1 0 43.3 43.3" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="40" cy="23" r="2.6" fill="#fff" />
      <circle cx="43" cy="32" r="3.4" fill="#fff" />
      <circle cx="40" cy="41" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Stars({ count = 14 }: { count?: number }) {
  const stars = Array.from({ length: count }, (_, i) => ({ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, delay: `${(i % 5) * 0.6}s`, size: i % 4 === 0 ? 2 : 1 }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {stars.map((s, i) => <span key={i} className="absolute animate-twinkle rounded-full bg-white" style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }} />)}
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
        <span className="text-[12px] font-medium text-moon-soft">{t("sign.password")}</span>
        <div className="relative">
          <KeyRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-moon-dim" />
          <input className="field pl-10" type="password" aria-label={t("sign.password")} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
      </label>
      <ErrorText error={error} />
      <MovingBorderButton type="submit" disabled={!pw || busy}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? t("send.signing") : (submitLabel ?? t("send.sign"))}
      </MovingBorderButton>
    </form>
  );
}

export function SignSheet({ title, children, onSign, onCancel, busy, error }: { title: string; children: ReactNode; onSign: (password: string) => void; onCancel: () => void; busy: boolean; error?: string }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 backdrop-blur-[2px] animate-fade-up" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92%] overflow-y-auto rounded-t-3xl border-t border-night-700 bg-night-950 p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent"><KeyRound size={17} /></span>
          <h2 className="flex-1 text-[15px] font-semibold text-ink">{title}</h2>
          <IconButton label={t("common.cancel")} onClick={onCancel} disabled={busy}><X size={16} /></IconButton>
        </div>
        <div className="mb-3 space-y-2">{children}</div>
        <p className="mb-3 text-[11px] leading-relaxed text-moon-dim">{t("sign.note")}</p>
        <SignForm onSign={onSign} busy={busy} error={error} />
      </div>
    </div>
  );
}

// ---------- Thông báo (Dynamic Island) ----------

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
      {current?.kind === "busy" && (<><Loader2 size={15} className="shrink-0 animate-spin text-brand-hi" /><span className="truncate text-[12px] font-medium">{current.message}</span></>)}
      {current?.kind === "success" && (
        <>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400"><CheckCircle2 size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{current.message}</p>
            {current.href && <a href={current.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-brand-hi hover:underline">{t("common.explorer")} <ExternalLink size={11} /></a>}
          </div>
          <button aria-label="dismiss" onClick={dismissToast} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><X size={14} /></button>
        </>
      )}
    </DynamicIsland>
  );
}
