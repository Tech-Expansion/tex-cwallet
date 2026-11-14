import { useEffect, useState, type ReactNode } from "react";
import { MotionConfig, motion } from "framer-motion";
import { History, Settings as SettingsIcon, Users, Wallet as WalletIcon } from "lucide-react";
import { I18nProvider, useT, type MessageKey } from "./i18n";
import { useStatus, useWalletData } from "./hooks";
import { rpc, type AppState } from "./rpc";
import { Unlock, Welcome, WalletForm } from "./Onboarding";
import { Dashboard, Receive } from "./Home";
import { Send } from "./Send";
import { Activity } from "./Activity";
import { Approve, Settings, VerifySignature, Wallets } from "./Settings";
import { Multisig } from "./Multisig";
import { Contacts } from "./Contacts";
import { Nfts } from "./Nft";
import { Staking } from "./Staking";
import { Spinner, Toaster, cx } from "./ui/ui";

function useHashRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.slice(1) || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (r) => (window.location.hash = r)];
}

const NAV = [
  { route: "/", label: "nav.wallet", icon: WalletIcon },
  { route: "/activity", label: "nav.activity", icon: History },
  { route: "/multisig", label: "nav.multisig", icon: Users },
  { route: "/settings", label: "nav.settings", icon: SettingsIcon },
] as const satisfies readonly { route: string; label: MessageKey; icon: unknown }[];

/** Multisig requests that need me (AI-14), refreshed on navigation and every 30 seconds. */
function usePendingMultisig(route: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => void rpc<number>({ type: "sharedPendingCount" }).then((v) => { if (live) setN(v); }).catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [route]);
  return n;
}

function WithNav({ route, go, children }: { route: string; go: (r: string) => void; children: ReactNode }) {
  const t = useT();
  const pending = usePendingMultisig(route);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      <nav className="grid grid-cols-4 border-t border-night-800 bg-night-950/95 px-2 pb-2 pt-1.5 backdrop-blur">
        {NAV.map(({ route: r, label, icon: Icon }) => {
          const active = route === r;
          return (
            <button key={r} onClick={() => go(r)} aria-current={active ? "page" : undefined} aria-label={`Tab ${t(label)}`}
              className={cx("relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors", active ? "text-ink" : "text-moon-dim hover:text-moon")}>
              {active && <motion.span layoutId="nav-active" transition={{ type: "spring", bounce: 0.25, duration: 0.5 }} className="absolute inset-0 rounded-xl bg-accent/10 ring-1 ring-accent/25" />}
              <Icon size={19} className={cx("relative", active && "text-accent")} />
              <span className="relative">{t(label)}</span>
              {r === "/multisig" && pending > 0 && (
                <span data-testid="ms-badge" aria-label={t("ms2.pendingBadge", { n: String(pending) })}
                  className="absolute right-[22%] top-0.5 grid min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">{pending}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Unlocked({ st, refresh, route, go }: { st: AppState; refresh: () => void; route: string; go: (r: string) => void }) {
  const data = useWalletData(st);
  if (route === "/multisig" || route.startsWith("/multisig/")) return <WithNav route="/multisig" go={go}><Multisig st={st} route={route} go={go} /></WithNav>;
  switch (route) {
    case "/send": return <Send st={st} data={data} go={go} />;
    case "/receive": return <Receive st={st} data={data} go={go} />;
    case "/wallets": return <Wallets st={st} refresh={refresh} go={go} />;
    case "/wallets/add": return <WalletForm initial="new" needPassword={false} onBack={() => go("/wallets")} onDone={() => { refresh(); go("/"); }} />;
    case "/verify": return <VerifySignature go={go} />;
    case "/staking": return <Staking st={st} go={go} />;
    case "/nfts": return <Nfts st={st} go={go} />;
    case "/contacts": return <Contacts st={st} go={go} />;
    case "/activity": return <WithNav route={route} go={go}><Activity st={st} /></WithNav>;
    case "/settings": return <WithNav route={route} go={go}><Settings st={st} refresh={refresh} go={go} /></WithNav>;
    default: return <WithNav route="/" go={go}><Dashboard st={st} data={data} go={go} /></WithNav>;
  }
}

function Routes() {
  const { state: st, error, refresh } = useStatus();
  const [route, go] = useHashRoute();
  if (error) return <div className="p-4 text-bad" role="alert">{error}</div>;
  if (!st) return <div className="grid h-full place-items-center"><Spinner /></div>;

  const approve = route.match(/^\/approve\/([\w-]+)$/);
  if (!st.hasVault) {
    if (route === "/create") return <WalletForm initial="new" needPassword onBack={() => go("/")} onDone={() => { refresh(); go("/"); }} />;
    if (route === "/import") return <WalletForm initial="import" needPassword onBack={() => go("/")} onDone={() => { refresh(); go("/"); }} />;
    return <Welcome go={go} />;
  }
  if (!st.unlocked) return <Unlock onDone={refresh} />;
  if (approve) return <Approve id={approve[1]!} />;
  if (!st.wallets.length) return <WalletForm initial="new" needPassword={false} onDone={refresh} />;
  return <Unlocked st={st} refresh={refresh} route={route} go={go} />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <Routes />
        <Toaster />
      </I18nProvider>
    </MotionConfig>
  );
}
