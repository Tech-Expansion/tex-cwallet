// Chạy trong page (MAIN world): đăng ký window.cardano.wallet_cardano theo CIP-30.
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
  name: "Cardano Multi Wallet",
  icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><circle cx="32" cy="32" r="30" fill="url(#bg)"/><circle cx="32" cy="32" r="30" fill="url(#sheen)"/><path d="M43.3 20.7A17 17 0 1 0 43.3 43.3" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="40" cy="23" r="2.6" fill="#fff"/><circle cx="43" cy="32" r="3.4" fill="#fff"/><circle cx="40" cy="41" r="2.6" fill="#fff"/></svg>'),
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
