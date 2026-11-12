import { useCallback, useEffect, useRef, useState } from "react";
import { rpc, type AppState } from "./rpc";

export function useStatus() {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { setState(await rpc<AppState>({ type: "state" })); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, error, refresh };
}

/** Chạy một hành động bất đồng bộ, theo dõi busy/error. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    setBusy(true);
    setError("");
    try { return await fn(...a); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); } finally { if (alive.current) setBusy(false); }
  }, [fn]); // eslint-disable-line react-hooks/exhaustive-deps
  return { busy, error, run, setError };
}

export type Bal = { unit: string; quantity: string }[];
export type Hist = { hash: string; blockTime: number; netLovelace: string }[];

/** Số dư + lịch sử + địa chỉ của tài khoản đang dùng; tải lại khi đổi mạng/ví/account. */
export function useWalletData(st: AppState) {
  const [addr, setAddr] = useState("");
  const [bal, setBal] = useState<Bal>();
  const [hist, setHist] = useState<Hist>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAddr((await rpc<{ baseAddress: string }>({ type: "account" })).baseAddress);
      const [b, h] = await Promise.all([rpc<Bal>({ type: "balance" }), rpc<Hist>({ type: "history", limit: 3 })]);
      setBal(b);
      setHist(h);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [st.network, st.active.walletId, st.active.account]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBal(undefined); setHist(undefined); void load(); }, [load]);
  return { addr, bal, hist, error, loading, reload: load };
}

/** Lịch sử đầy đủ (Blockfrost tốn 1 + N request) — chỉ tải khi người dùng mở tab Hoạt động. */
export function useHistory(st: AppState, limit = 20) {
  const [hist, setHist] = useState<Hist>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setHist(await rpc<Hist>({ type: "history", limit })); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [st.network, st.active.walletId, st.active.account, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHist(undefined); void load(); }, [load]);
  return { hist, error, loading, reload: load };
}
