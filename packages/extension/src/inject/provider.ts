// Chạy trong page (MAIN world): đăng ký window.cardano.walletcardano theo CIP-30.
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.data?.target !== "wallet-cardano-page") return;
  const p = pending.get(ev.data.id);
  if (!p) return;
  pending.delete(ev.data.id);
  ev.data.ok ? p.resolve(ev.data.data) : p.reject({ code: -3, info: ev.data.error });
});

const call = (method: string, ...params: any[]) =>
  new Promise<any>((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    window.postMessage({ target: "wallet-cardano-bg", id, method, params }, window.location.origin);
  });

const fullApi = Object.freeze({
  getNetworkId: () => call("getNetworkId"),
  getUtxos: () => call("getUtxos"),
  getBalance: () => call("getBalance"),
  getUsedAddresses: () => call("getUsedAddresses"),
  getUnusedAddresses: () => call("getUnusedAddresses"),
  getChangeAddress: () => call("getChangeAddress"),
  getRewardAddresses: () => call("getRewardAddresses"),
  getExtensions: () => call("getExtensions"),
  getCollateral: () => call("getCollateral"),
  signTx: (tx: string, partial = false) => call("signTx", tx, partial),
  signData: (addr: string, payload: string) => call("signData", addr, payload),
  submitTx: (tx: string) => call("submitTx", tx),
  cip30: Object.freeze({ getExtensions: () => call("getExtensions") }),
});

const wallet = Object.freeze({
  name: "TEX Wallet",
  icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#080503"/><path d="M46 17H26a8 8 0 0 0-8 8v14a8 8 0 0 0 8 8h20" fill="none" stroke="#FAFAF9" stroke-width="6.5"/><rect x="37" y="28" width="8" height="8" fill="#FAFAF9"/></svg>'),
  apiVersion: "0.1.0",
  supportedExtensions: [],
  isEnabled: () => call("isEnabled"),
  enable: async () => {
    await call("enable");
    return fullApi;
  },
});

const w = window as any;
w.cardano = w.cardano ?? {};
w.cardano.walletcardano = wallet;
