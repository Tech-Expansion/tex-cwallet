import { summarizeTx, serializeBalance, serializeTxDetail, serializeSendPreview, cosignerKeyHash, WalletManager, WalletError, NETWORKS, type NetworkName, type KeyValueStore, type ProviderFactory, type ProviderSettings } from "@wallet/core";

/** Lưu trữ tạm trong phiên trình duyệt (chrome.storage.session) để sống sót khi service worker bị tắt. */
export interface SessionStore {
  get(): Promise<{ password?: string; lockAt?: number; connected?: string[] }>;
  set(v: { password?: string; lockAt?: number; connected?: string[] }): Promise<void>;
}

export interface Approval {
  id: string;
  origin: string;
  kind: "enable" | "signTx" | "signData";
  detail?: string;
}

/** Payload CIP-30 là hex: hiện dạng chữ nếu là UTF-8 in được, nếu không thì hiện hex. */
export function readable(hex: unknown): string {
  const h = String(hex ?? "");
  if (!/^([0-9a-f]{2})*$/i.test(h) || !h) return h;
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16))));
    return /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n]+$/u.test(t) ? `${t}\n\n(hex: ${h})` : h;
  } catch {
    return h;
  }
}

export const AUTO_LOCK_MS = 15 * 60 * 1000;

export type Req =
  | { type: "state" }
  | { type: "setup"; password: string }
  | { type: "unlock"; password: string }
  | { type: "lock" }
  | { type: "newMnemonic" }
  | { type: "addWallet"; name: string; mnemonic: string }
  | { type: "addWatch"; name: string; address: string }
  | { type: "removeWallet"; id: string }
  | { type: "renameWallet"; id: string; name: string }
  | { type: "addAccount"; walletId: string }
  | { type: "setActive"; walletId: string; account: number }
  | { type: "setNetwork"; network: NetworkName }
  | { type: "setProvider"; proxyUrl?: string; proxyForTestnets?: boolean }
  | { type: "account" }
  | { type: "balance" }
  | { type: "walletBalance" }
  | { type: "history"; limit?: number }
  | { type: "contactList" }
  | { type: "contactSave"; id?: string; name: string; address: string; note?: string }
  | { type: "contactRemove"; id: string }
  | { type: "resolveHandle"; handle: string }
  | { type: "historyPage"; page?: number; count?: number; sharedId?: string }
  | { type: "txDetail"; hash: string; sharedId?: string }
  | { type: "historyCsv"; from: number; to: number; sharedId?: string }
  | { type: "prepareSend"; to?: string; lovelace?: string; assets?: { unit: string; quantity: string }[]; outputs?: { to: string; lovelace?: string; assets?: { unit: string; quantity: string }[] }[]; max?: boolean; memo?: string }
  | { type: "confirmSend"; txHash: string; password: string }
  | { type: "exportMnemonic"; id: string; password: string }
  | { type: "sharedList" }
  | { type: "sharedKey"; y: number }
  | { type: "sharedNext" }
  | { type: "sharedDiscover" }
  | { type: "sharedCreate"; name: string; required: number; cosigners: { name: string; keyHash: string }[]; myIndex?: number; myName?: string }
  | { type: "sharedImport"; input: string; name?: string }
  | { type: "sharedPreview"; required: number; cosigners: { name: string; keyHash: string }[]; myIndex?: number }
  | { type: "sharedCheckKey"; input: string }
  | { type: "sharedExport"; id: string }
  | { type: "sharedRemove"; id: string }
  | { type: "sharedBalance"; id: string }
  | { type: "sharedWalletBalance"; id: string }
  | { type: "sharedRequestCbor"; request: string }
  | { type: "sharedRegister"; id: string }
  | { type: "sharedPropose"; id: string; to: string; lovelace: string; memo?: string; password: string }
  | { type: "sharedRequests"; id: string }
  | { type: "sharedInspect"; request: string }
  | { type: "sharedSign"; request: string; password: string }
  | { type: "sharedMerge"; a: string; b: string }
  | { type: "sharedSubmit"; request: string }
  | { type: "sharedDismiss"; id: string; request: string }
  | { type: "sharedDetect"; input: string }
  | { type: "sharedPendingCount" }
  | { type: "sharedReceive"; request: string }
  | { type: "pendingApprovals" }
  | { type: "resolveApproval"; id: string; ok: boolean };

export class WalletApi {
  readonly manager: WalletManager;
  private approvals = new Map<string, { a: Approval; resolve: (ok: boolean) => void }>();
  /** Gọi khi cần hiện cửa sổ phê duyệt */
  onApprovalNeeded: (a: Approval) => void = () => {};

  constructor(
    store: KeyValueStore,
    private session: SessionStore,
    providers?: ProviderFactory,
    private now: () => number = Date.now,
    defaults: ProviderSettings = {},
  ) {
    this.manager = new WalletManager(store, providers, defaults);
  }

  /** Mở khóa lại từ phiên nếu service worker vừa thức dậy; tự khóa khi hết hạn. */
  private async restore() {
    await this.manager.load();
    const s = await this.session.get();
    if (s.lockAt && this.now() > s.lockAt) {
      this.manager.lock();
      await this.session.set({});
      return;
    }
    if (!this.manager.isUnlocked() && s.password) {
      try {
        await this.manager.unlock(s.password);
      } catch {
        await this.session.set({});
      }
    }
  }
  private async touch(password?: string) {
    const cur = await this.session.get();
    await this.session.set({ ...cur, password: password ?? cur.password, lockAt: this.now() + AUTO_LOCK_MS });
  }

  async handle(req: Req): Promise<unknown> {
    await this.restore();
    const m = this.manager;
    switch (req.type) {
      case "state":
        return {
          hasVault: m.hasVault(),
          unlocked: m.isUnlocked(),
          wallets: m.isUnlocked() ? m.listWallets() : [],
          active: m.active,
          network: m.network,
          provider: m.providerSettings,
          networks: Object.values(NETWORKS).map((n) => ({
            name: n.name, label: n.label, faucetUrl: n.faucetUrl, explorerTxUrl: n.explorerTxUrl,
            unit: n.unit, addressPrefix: n.addressPrefix,
          })),
        };
      case "setup":
        await m.setupPassword(req.password);
        return this.touch(req.password);
      case "unlock":
        await m.unlock(req.password);
        // Find multisig wallets registered on-chain for my keys in the background (AI-14); offline is fine.
        void m.discoverShared().catch(() => undefined);
        return this.touch(req.password);
      case "lock":
        m.lock();
        return this.session.set({});
      case "newMnemonic":
        return m.newMnemonic();
    }
    // Mọi thao tác dưới đây cần mở khóa
    if (!m.isUnlocked()) throw new WalletError("LOCKED", "Ví đang khóa");
    await this.touch();
    switch (req.type) {
      case "addWallet":
        return m.addWallet(req.name, req.mnemonic);
      case "addWatch":
        return m.addWatchWallet(req.name, req.address);
      case "removeWallet":
        return m.removeWallet(req.id);
      case "renameWallet":
        return m.renameWallet(req.id, req.name);
      case "addAccount":
        return m.addAccount(req.walletId);
      case "setActive":
        await this.disconnectAll();
        return m.setActive(req.walletId, req.account);
      case "setNetwork":
        await this.disconnectAll();
        return m.setNetwork(req.network);
      case "setProvider":
        return m.setProviderSettings({ ...m.providerSettings, proxyUrl: req.proxyUrl?.trim() || undefined, proxyForTestnets: !!req.proxyForTestnets });
      case "account":
        return m.getAccount();
      case "balance":
        return m.getBalance();
      case "walletBalance":
        return serializeBalance(await m.getWalletBalance());
      case "history":
        return (await m.getHistory(req.limit)).map((t) => ({ ...t, netLovelace: t.netLovelace.toString() }));
      case "contactList":
        return m.listContacts();
      case "contactSave":
        return m.saveContact({ id: req.id, name: req.name, address: req.address, note: req.note });
      case "contactRemove":
        return m.removeContact(req.id);
      case "resolveHandle":
        return m.resolveHandle(req.handle);
      case "historyPage": {
        const p = await m.historyPage({ page: req.page, count: req.count, sharedId: req.sharedId });
        return { items: p.items.map(serializeTxDetail), hasMore: p.hasMore };
      }
      case "txDetail":
        return serializeTxDetail(await m.txDetail(req.hash, req.sharedId));
      case "historyCsv":
        return m.exportHistoryCsv(Number(req.from), Number(req.to), req.sharedId);
      case "prepareSend": {
        const out = (o: { to?: string; lovelace?: string; assets?: { unit: string; quantity: string }[] }) => ({
          to: String(o.to ?? ""),
          lovelace: o.lovelace === undefined || o.lovelace === "" ? undefined : toBigInt(o.lovelace),
          assets: (o.assets ?? []).map((x) => ({ unit: x.unit, quantity: toBigInt(x.quantity) })),
        });
        return serializeSendPreview(await m.prepareSend({
          ...(Array.isArray(req.outputs) ? { outputs: req.outputs.map(out) } : out(req)),
          max: req.max === true,
          memo: typeof req.memo === "string" ? req.memo : undefined,
        }));
      }
      case "confirmSend":
        return m.confirmSend(req.txHash, req.password);
      case "exportMnemonic":
        return m.exportMnemonic(req.id, req.password);
      case "sharedList":
        await m.adoptLocalShared(); // multisig wallets another wallet on this device already holds
        return m.listShared();
      case "sharedKey":
        return m.sharedKeyInfo(req.y);
      case "sharedNext":
        return m.sharedNextIndex();
      case "sharedDiscover":
        return m.discoverShared();
      case "sharedCreate":
        return m.createShared(req);
      case "sharedPreview":
        return m.previewShared({ required: req.required, cosigners: req.cosigners, myIndex: req.myIndex });
      case "sharedCheckKey":
        return cosignerKeyHash(req.input);
      case "sharedImport":
        return m.importShared(req.input, req.name);
      case "sharedExport":
        return m.exportShared(req.id);
      case "sharedRemove":
        return m.removeShared(req.id);
      case "sharedBalance":
        return m.sharedBalance(req.id);
      case "sharedWalletBalance":
        return serializeBalance(await m.sharedWalletBalance(req.id));
      case "sharedRequestCbor":
        return m.requestCbor(req.request);
      case "sharedRegister":
        return m.registerShared(req.id);
      case "sharedPropose":
        await m.verifyPassword(req.password);
        return m.proposeShared(req.id, req.to, BigInt(req.lovelace), req.memo);
      case "sharedRequests":
        return m.listRequests(req.id);
      case "sharedInspect":
        return m.inspectRequest(req.request);
      case "sharedSign":
        return m.signRequest(req.request, req.password);
      case "sharedMerge":
        return m.mergeRequests(req.a, req.b);
      case "sharedSubmit":
        return m.submitRequest(req.request);
      case "sharedPendingCount":
        await m.adoptLocalShared();
        return m.pendingActionCount();
      case "sharedDetect":
        return m.detectSharedInput(req.input);
      case "sharedReceive":
        return m.receiveRequest(req.request);
      case "sharedDismiss":
        return m.dismissRequest(req.id, req.request);
      case "pendingApprovals":
        return [...this.approvals.values()].map((x) => x.a);
      case "resolveApproval": {
        const p = this.approvals.get(req.id);
        p?.resolve(req.ok);
        this.approvals.delete(req.id);
        return null;
      }
      default:
        // Unknown request types (e.g. the removed setMainnet) fail instead of resolving to undefined.
        throw new WalletError("NOT_FOUND", `Không hỗ trợ yêu cầu ${(req as { type?: string }).type}`);
    }
  }

  // ---------------- dApp (CIP-30) ----------------
  private ask(a: Omit<Approval, "id">): Promise<boolean> {
    const full: Approval = { ...a, id: crypto.randomUUID() };
    return new Promise((resolve) => {
      this.approvals.set(full.id, { a: full, resolve });
      this.onApprovalNeeded(full);
    });
  }

  /** Quyền theo origin + ví đang hoạt động */
  private async connectedSet() {
    return new Set((await this.session.get()).connected ?? []);
  }
  private async setConnected(c: Set<string>) {
    await this.session.set({ ...(await this.session.get()), connected: [...c] });
  }

  async dapp(origin: string, method: string, params: any[] = []): Promise<unknown> {
    await this.restore();
    const m = this.manager;
    const connected = await this.connectedSet();
    if (method === "isEnabled") return connected.has(origin);
    if (method === "enable") {
      const ok = await this.ask({ origin, kind: "enable" });
      if (!ok) throw new WalletError("LOCKED", "Người dùng từ chối kết nối");
      connected.add(origin);
      await this.setConnected(connected);
      return true;
    }
    if (!connected.has(origin)) throw new WalletError("LOCKED", "dApp chưa được cấp quyền");
    if (!m.isUnlocked()) throw new WalletError("LOCKED", "Ví đang khóa");
    await this.touch();
    const api = await m.cip30();
    switch (method) {
      case "getNetworkId":
        return api.getNetworkId();
      case "getUtxos":
        return api.getUtxos();
      case "getBalance":
        return api.getBalance();
      case "getUsedAddresses":
        return api.getUsedAddresses();
      case "getUnusedAddresses":
        return api.getUnusedAddresses();
      case "getChangeAddress":
        return api.getChangeAddress();
      case "getRewardAddresses":
        return api.getRewardAddresses();
      case "getCollateral":
        return api.getCollateral();
      case "getExtensions":
        return [];
      case "signTx": {
        if (!(await this.ask({ origin, kind: "signTx", detail: summarizeTx(params[0]) }))) throw new WalletError("LOCKED", "Người dùng từ chối ký");
        return api.signTx(params[0], !!params[1]);
      }
      case "signData": {
        if (!(await this.ask({ origin, kind: "signData", detail: readable(params[1]) }))) throw new WalletError("LOCKED", "Người dùng từ chối ký");
        return api.signData(params[0], params[1]);
      }
      case "submitTx":
        return api.submitTx(params[0]);
      default:
        throw new WalletError("NOT_FOUND", `Không hỗ trợ ${method}`);
    }
  }

  /** Ngắt kết nối tất cả dApp (khi khóa / đổi ví) */
  async disconnectAll() {
    await this.setConnected(new Set());
  }
}

/** Non-negative integer string -> bigint (rejects decimals and other characters). */
function toBigInt(v: string): bigint {
  if (!/^\d{1,40}$/.test(v)) throw new WalletError("INVALID_AMOUNT", "Số lượng không hợp lệ");
  return BigInt(v);
}
