// Bản web: chạy WalletApi ngay trong trang (không có service worker). Khóa vẫn chỉ nằm ở trình duyệt người dùng.
import { createRoot } from "react-dom/client";
import { MemoryStore, type KeyValueStore } from "@wallet/core";
import { WalletApi, type SessionStore } from "../background/api";
import { setRpc } from "../popup/rpc";
import { App } from "../popup/App";
import "../popup/style.css";

document.documentElement.dataset.layout = "web";

const lsStore: KeyValueStore = (() => {
  try {
    localStorage.setItem("__t", "1");
    localStorage.removeItem("__t");
  } catch {
    return new MemoryStore(); // localStorage bị chặn: ví chỉ sống trong phiên này
  }
  return {
    async get<T>(k: string) {
      const v = localStorage.getItem("w:" + k);
      return v === null ? undefined : (JSON.parse(v) as T);
    },
    async set<T>(k: string, v: T) {
      localStorage.setItem("w:" + k, JSON.stringify(v));
    },
    async remove(k: string) {
      localStorage.removeItem("w:" + k);
    },
  };
})();

// Phiên chỉ nằm trong RAM của tab: tải lại trang là ví tự khóa (an toàn hơn lưu mật khẩu ở sessionStorage).
let sess: Awaited<ReturnType<SessionStore["get"]>> = {};
const session: SessionStore = { get: async () => ({ ...sess }), set: async (v) => void (sess = { ...v }) };

const proxyUrl = (import.meta.env.VITE_PROXY_URL as string | undefined) || `${location.origin}/proxy`;
// Koios không gửi header CORS cho phản hồi POST → testnet đi qua proxy cùng origin
const api = new WalletApi(lsStore, session, undefined, undefined, { proxyUrl, koiosViaProxy: true });
setRpc(async (req) => (await api.handle(req as never)) as never);

createRoot(document.getElementById("root")!).render(<App />);
