import { MemoryStore, type KeyValueStore } from "@wallet/core";
import { WalletApi, type Req, type SessionStore, type Approval } from "./api";

const chromeStore: KeyValueStore = {
  async get<T>(key: string) {
    return (await chrome.storage.local.get(key))[key] as T | undefined;
  },
  async set<T>(key: string, value: T) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key: string) {
    await chrome.storage.local.remove(key);
  },
};
const sessionStore: SessionStore = {
  async get() {
    return ((await chrome.storage.session.get("s")).s as any) ?? {};
  },
  async set(v) {
    await chrome.storage.session.set({ s: v });
  },
};
void MemoryStore;

const PROXY = (import.meta.env.VITE_PROXY_URL as string | undefined) || undefined;
const api = new WalletApi(chromeStore, sessionStore, undefined, undefined, { proxyUrl: PROXY });

api.onApprovalNeeded = (a: Approval) => {
  chrome.windows.create({ url: chrome.runtime.getURL(`popup.html#/approve/${a.id}`), type: "popup", width: 380, height: 640 });
};

const errMsg = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), code: (e as any)?.code });

chrome.runtime.onMessage.addListener((msg: any, sender, reply) => {
  const run =
    msg?.kind === "dapp"
      ? // chỉ tin origin do trình duyệt cung cấp, không tin giá trị từ trang
        api.dapp(sender.origin ?? new URL(sender.url ?? "").origin, msg.method, msg.params)
      : sender.id === chrome.runtime.id && msg?.kind === "wallet"
        ? api.handle(msg.req as Req)
        : Promise.reject(new Error("Yêu cầu không hợp lệ"));
  run.then((data) => reply({ ok: true, data }), (e) => reply(errMsg(e)));
  return true;
});
