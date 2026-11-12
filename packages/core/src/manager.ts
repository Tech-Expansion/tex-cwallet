import { MeshWallet, deserializeAddress } from "@meshsdk/core";
import { toValue, Address, resolveTxHash, Serialization } from "@meshsdk/core-cst";
import { NETWORKS, DEFAULT_NETWORK, assertNetwork, UnsupportedNetworkError, type NetworkName } from "./networks";
import { encrypt, decrypt, type EncryptedBlob } from "./vault";
import { generateMnemonic, normalizeMnemonic, checkMnemonic, describeMnemonicProblem } from "./mnemonic";
import { deriveAccount, type DerivedAccount } from "./wallet";
import type { AssetBalance, TxSummary } from "./koios";
import { defaultProviders, type ProviderFactory, type ProviderSettings } from "./chain";
import type { KeyValueStore } from "./storage";
import { WalletError } from "./errors";
import {
  sharedKeyHash, signWithSharedKey, buildPaymentScript, makeSharedWallet, buildSharedSend, inspectSharedTx, attachWitnesses, readWitnesses,
  scriptFromCbor, scriptHashOf, toKeyHash, keysOf, SharedError, type SharedWallet, type Signer, type TxPreview, type NativeScriptJson,
} from "./shared";
import { explainSubmitError } from "./koiosProvider";
import { summarizeBalance, type WalletBalance } from "./balance";
import { prepareSend, verifySendTx, minFeeFor, assertPreprodAddress, type SendRequest, type SendPreview, type PreparedSend } from "./send";
import { buildRegistrationTx, parseRegistration, fromParts, registrationMetadata } from "./registration";

export interface WalletMeta {
  id: string;
  name: string;
  kind: "mnemonic" | "watch";
  accounts: { index: number; name: string }[];
  /** chỉ cho watch-only */
  address?: string;
  vault?: EncryptedBlob;
}

interface State {
  wallets: WalletMeta[];
  activeWalletId?: string;
  activeAccount: number;
  network: NetworkName;
  shared?: SharedEntry[];
  requests?: Record<string, SignRequest[]>;
  providerSettings?: ProviderSettings;
  /** Xác minh mật khẩu */
  check?: EncryptedBlob;
}

/** Ví multisig kèm thông tin: ví nào của mình ký và dùng chỉ số khóa y nào. */
export interface SharedEntry extends SharedWallet { ownerWalletId: string }

/** Yêu cầu ký (chia sẻ qua copy/paste hoặc file): giao dịch đã ký một phần + ghi chú. */
export interface SignRequest {
  v: 1;
  kind: "cardano-multisig-sign-request";
  walletId: string;
  network: NetworkName;
  tx: string;
  memo?: string;
  createdAt: number;
}

const DISCOVER_GAP = 20; // CIP-1854: luôn xét 20 khóa liên tiếp chưa dùng
const KEY = "wallet-state-v1";
const MIN_PW = 8;
const PENDING_TTL_MS = 10 * 60_000; // a previewed transaction expires after 10 minutes
const MIN_SEND = 1_000_000n; // multisig: at least 1 ADA

export class WalletManager {
  private state: State = { wallets: [], activeAccount: 0, network: DEFAULT_NETWORK };
  private loaded = false;
  /** Mnemonic đã giải mã, chỉ nằm trong RAM khi mở khóa */
  private session = new Map<string, string[]>();
  private unlocked = false;

  constructor(
    private store: KeyValueStore,
    private providers: ProviderFactory = defaultProviders,
    /** Cấu hình nguồn dữ liệu mặc định (ví dụ URL proxy của bản triển khai) khi người dùng chưa tự đặt */
    private defaults: ProviderSettings = {},
  ) {}

  // ---------- trạng thái ----------
  async load() {
    if (this.loaded) return;
    const s = await this.store.get<State>(KEY);
    if (s) {
      // Old multi-network state may hold wallets or sign requests of other networks: refuse to load it.
      assertStoredNetwork(s.network);
      this.state = s;
    }
    this.loaded = true;
  }
  private async save() {
    await this.store.set(KEY, this.state);
  }
  hasVault() {
    return !!this.state.check;
  }
  isUnlocked() {
    return this.unlocked;
  }
  get network() {
    return this.state.network;
  }
  listWallets() {
    return this.state.wallets.map(({ vault, ...w }) => w);
  }
  get active() {
    return { walletId: this.state.activeWalletId, account: this.state.activeAccount };
  }

  // ---------- khóa / mở khóa ----------
  async setupPassword(password: string) {
    await this.load();
    if (password.length < MIN_PW) throw new WalletError("WEAK_PASSWORD", `Mật khẩu tối thiểu ${MIN_PW} ký tự`);
    if (this.state.check) throw new WalletError("NO_VAULT", "Đã có mật khẩu");
    this.state.check = await encrypt("ok", password);
    this.unlocked = true;
    this.password = password;
    await this.save();
  }
  private password?: string;

  async unlock(password: string) {
    await this.load();
    if (!this.state.check) throw new WalletError("NO_VAULT", "Chưa thiết lập mật khẩu");
    try {
      await decrypt(this.state.check, password);
    } catch {
      throw new WalletError("BAD_PASSWORD", "Sai mật khẩu");
    }
    for (const w of this.state.wallets)
      if (w.vault) this.session.set(w.id, JSON.parse(await decrypt(w.vault, password)));
    this.password = password;
    this.unlocked = true;
  }
  /** Xác minh mật khẩu (dùng trước thao tác ký) mà không đổi trạng thái khóa. */
  async verifyPassword(password: string) {
    if (!this.state.check) throw new WalletError("NO_VAULT", "Chưa thiết lập mật khẩu");
    try {
      await decrypt(this.state.check, password);
    } catch {
      throw new WalletError("BAD_PASSWORD", "Sai mật khẩu");
    }
  }
  lock() {
    this.session.clear();
    this.password = undefined;
    this.unlocked = false;
  }
  private requireUnlocked() {
    if (!this.unlocked || !this.password) throw new WalletError("LOCKED", "Ví đang khóa");
    return this.password;
  }

  // ---------- quản lý ví ----------
  /** New mnemonic: always 24 words (AI-3). */
  newMnemonic() {
    return generateMnemonic();
  }

  async addWallet(name: string, mnemonic: string[] | string): Promise<WalletMeta> {
    const pw = this.requireUnlocked();
    const words = typeof mnemonic === "string" ? normalizeMnemonic(mnemonic) : mnemonic;
    const problem = checkMnemonic(words);
    if (problem) throw new WalletError("INVALID_MNEMONIC", describeMnemonicProblem(problem));
    const first = await deriveAccount(words, this.state.network, 0);
    if (this.state.wallets.some((w) => w.kind === "mnemonic" && this.session.get(w.id)?.join(" ") === words.join(" ")))
      throw new WalletError("INVALID_MNEMONIC", "Ví này đã được thêm");
    const id = crypto.randomUUID();
    const meta: WalletMeta = {
      id,
      name: name || `Ví ${this.state.wallets.length + 1}`,
      kind: "mnemonic",
      accounts: [{ index: 0, name: "Tài khoản 1" }],
      vault: await encrypt(JSON.stringify(words), pw),
    };
    void first;
    this.session.set(id, words);
    this.state.wallets.push(meta);
    this.state.activeWalletId ??= id;
    await this.save();
    return meta;
  }

  async addWatchWallet(name: string, address: string): Promise<WalletMeta> {
    this.requireUnlocked();
    this.assertAddress(address);
    const meta: WalletMeta = { id: crypto.randomUUID(), name, kind: "watch", accounts: [{ index: 0, name: "Watch" }], address };
    this.state.wallets.push(meta);
    this.state.activeWalletId ??= meta.id;
    await this.save();
    return meta;
  }

  async removeWallet(id: string) {
    this.requireUnlocked();
    this.getMeta(id);
    this.state.wallets = this.state.wallets.filter((w) => w.id !== id);
    this.session.delete(id);
    if (this.state.activeWalletId === id) {
      this.state.activeWalletId = this.state.wallets[0]?.id;
      this.state.activeAccount = 0;
    }
    await this.save();
  }

  async renameWallet(id: string, name: string) {
    this.getMeta(id).name = name;
    await this.save();
  }

  async addAccount(walletId: string, name?: string) {
    this.requireUnlocked();
    const w = this.getMeta(walletId);
    if (w.kind !== "mnemonic") throw new WalletError("NOT_FOUND", "Ví watch-only không có account");
    const index = Math.max(...w.accounts.map((a) => a.index)) + 1;
    w.accounts.push({ index, name: name ?? `Tài khoản ${index + 1}` });
    await this.save();
    return index;
  }

  async setActive(walletId: string, account = 0) {
    const w = this.getMeta(walletId);
    if (!w.accounts.some((a) => a.index === account)) throw new WalletError("NOT_FOUND", "Account không tồn tại");
    this.state.activeWalletId = walletId;
    this.state.activeAccount = account;
    await this.save();
  }

  /** Preprod only. Kept so old RPC callers get a clear error instead of silence. */
  async setNetwork(n: unknown) {
    try {
      this.state.network = assertNetwork(n);
    } catch (e) {
      throw new WalletError("UNSUPPORTED_NETWORK", (e as Error).message);
    }
    await this.save();
  }
  get providerSettings(): ProviderSettings {
    return { koiosViaProxy: this.defaults.koiosViaProxy, ...(this.state.providerSettings ?? this.defaults) };
  }
  async setProviderSettings(s: ProviderSettings) {
    this.requireUnlocked();
    if (s.proxyUrl && !/^https?:\/\/[^\s/]+/.test(s.proxyUrl)) throw new WalletError("NOT_FOUND", "URL proxy không hợp lệ");
    this.state.providerSettings = s;
    await this.save();
  }
  private p() {
    return this.providers(this.state.network, this.providerSettings);
  }

  async exportMnemonic(walletId: string, password: string): Promise<string[]> {
    const w = this.getMeta(walletId);
    if (!w.vault) throw new WalletError("NOT_FOUND", "Ví không có mnemonic");
    try {
      return JSON.parse(await decrypt(w.vault, password));
    } catch {
      throw new WalletError("BAD_PASSWORD", "Sai mật khẩu");
    }
  }

  // ---------- đọc dữ liệu chuỗi ----------
  async getAccount(walletId = this.state.activeWalletId, account = this.state.activeAccount): Promise<DerivedAccount> {
    const w = this.getMeta(walletId);
    if (w.kind === "watch") return { index: 0, baseAddress: w.address!, rewardAddress: "" };
    const words = this.words(w.id);
    return deriveAccount(words, this.state.network, account);
  }

  async getBalance(): Promise<AssetBalance[]> {
    const a = await this.getAccount();
    return this.p().chain.getBalance([a.baseAddress]);
  }

  /**
   * ADA balance (lovelace + 6 decimals) and each native asset (AI-4). The data source sums the address
   * UTxO set (Koios utxo_set / Blockfrost /addresses); use balanceFromUtxos() when the UTxOs are at hand.
   */
  async getWalletBalance(): Promise<WalletBalance> {
    return summarizeBalance(await this.getBalance());
  }

  /** Preprod chain tip (AI-2 AC-002) */
  getTip() {
    return this.p().chain.getTip();
  }

  async getHistory(limit = 20): Promise<TxSummary[]> {
    const a = await this.getAccount();
    return this.p().chain.getHistory(a.baseAddress, limit);
  }

  // ---------- send ADA / native tokens (AI-5, AI-6) ----------
  /** Built transactions waiting for the user to confirm the preview. Only these can be signed. */
  private pending = new Map<string, PreparedSend & { walletId?: string; account: number; network: NetworkName; expires: number }>();

  /**
   * Step 1: build an unsigned transaction from the live protocol parameters and return a preview
   * (amount, tokens, ADA carried, fee, change). Does not touch private keys.
   */
  async prepareSend(req: SendRequest): Promise<SendPreview> {
    this.requireUnlocked();
    const acc = await this.getAccount();
    const w = this.getMeta(this.state.activeWalletId);
    if (w.kind === "watch") throw new WalletError("NOT_FOUND", "Ví watch-only không thể gửi");
    const { fetcher, chain } = this.p();
    const params = await chain.getProtocolParams().catch(() => undefined);
    const utxos = await fetcher.fetchAddressUTxOs(acc.baseAddress);
    const prepared = await prepareSend({ req, utxos, changeAddress: acc.baseAddress, params, network: this.state.network });
    this.pending.clear(); // keep only the latest preview
    this.pending.set(prepared.preview.txHash, { ...prepared, walletId: this.state.activeWalletId, account: this.state.activeAccount, network: this.state.network, expires: Date.now() + PENDING_TTL_MS });
    return prepared.preview;
  }

  /** Step 2: the user saw the preview and entered the password → sign exactly that transaction (by hash) and submit. */
  async confirmSend(txHash: string, password: string): Promise<string> {
    await this.verifyPassword(password);
    const signedTx = await this.signPending(txHash);
    const wallet = await this.meshWallet();
    try {
      const h = await wallet.submitTx(signedTx);
      this.pending.delete(txHash);
      return h;
    } catch (e) {
      throw new WalletError("NOT_FOUND", this.submitErrorText(e));
    }
  }

  /** Sign a pending transaction (no submit). Used by confirmSend and tests. */
  async signPending(txHash: string): Promise<string> {
    const p = this.pending.get(txHash);
    if (!p || p.expires < Date.now()) throw new WalletError("INVALID_TX", "Giao dịch xem trước không còn hiệu lực, hãy tạo lại");
    if (p.walletId !== this.state.activeWalletId || p.account !== this.state.activeAccount || p.network !== this.state.network)
      throw new WalletError("INVALID_TX", "Ví hoặc tài khoản đã đổi sau khi xem trước, hãy tạo lại");
    const params = await this.p().chain.getProtocolParams();
    // Re-check right before signing: balance, min-UTxO, the recipient and amounts that were previewed.
    verifySendTx(p.unsignedTx, p.utxos, params, { to: p.preview.to, lovelace: p.preview.lovelace, assets: p.preview.assets, changeAddress: p.preview.change.address });
    const wallet = await this.meshWallet();
    const signed = await wallet.signTx(p.unsignedTx);
    if (resolveTxHash(signed) !== txHash) throw new WalletError("INVALID_TX", "Nội dung giao dịch thay đổi khi ký");
    if (BigInt(p.preview.fee) < minFeeFor(signed, params)) throw new WalletError("INVALID_TX", "Phí thấp hơn mức tối thiểu sau khi ký");
    return signed;
  }

  /** Helper: build + sign an ADA payment (not submitted). */
  async buildSendAda(to: string, lovelace: bigint) {
    const preview = await this.prepareSend({ to, lovelace });
    return { signedTx: await this.signPending(preview.txHash), preview };
  }

  /** Lỗi gửi giao dịch (Koios trả Error, Blockfrost có thể trả object) → thông báo dễ hiểu. */
  private submitErrorText(e: unknown): string {
    const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return /^(Giao dịch|Phí|Một khoản|Gửi giao dịch)/.test(raw) ? raw : explainSubmitError(raw);
  }

  // ---------- Ví multisig (CIP-1854 / CIP-0146, kiểu Eternl) ----------

  private sharedList(): SharedEntry[] {
    return (this.state.shared ??= []);
  }
  listShared(): SharedEntry[] {
    return this.sharedList().filter((w) => w.network === this.state.network);
  }
  private sharedById(id: string): SharedEntry {
    const w = this.sharedList().find((x) => x.id === id);
    if (!w) throw new WalletError("NOT_FOUND", "Không tìm thấy ví multisig");
    return w;
  }
  private ownerWords(w: SharedEntry) {
    return this.words(w.ownerWalletId);
  }
  private activeMnemonicId() {
    const w = this.getMeta(this.state.activeWalletId);
    if (w.kind !== "mnemonic") throw new WalletError("NOT_FOUND", "Cần ví có cụm từ khôi phục để dùng multisig");
    return w.id;
  }

  /**
   * Chỉ số khóa chưa dùng nhỏ nhất của ví đang dùng (CIP-0146: mỗi ví multisig đăng ký công khai dùng một khóa mới).
   * "Đã dùng" = có trong ví multisig đã biết trên thiết bị này (kể cả ví khám phá/nhập từ mạng khác).
   */
  async sharedNextIndex(): Promise<{ y: number; keyHash: string }> {
    const owner = this.activeMnemonicId();
    const used = new Set(this.sharedList().filter((w) => w.ownerWalletId === owner && w.myIndex !== undefined).map((w) => w.myIndex!));
    let y = 0;
    while (used.has(y) && y < DISCOVER_GAP - 1) y++;
    return this.sharedKeyInfo(y);
  }

  /** Khóa multisig (role 0) của ví đang dùng ở chỉ số y — đưa cho các cosigner để họ thêm bạn vào script. */
  async sharedKeyInfo(y: number): Promise<{ y: number; keyHash: string }> {
    return { y, keyHash: await sharedKeyHash(this.words(this.activeMnemonicId()), y) };
  }

  private async persistShared(entry: SharedEntry) {
    const list = this.sharedList();
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) list[i] = { ...list[i]!, ...entry, signers: entry.signers.map((s) => ({ ...s, name: list[i]!.signers.find((o) => o.keyHash === s.keyHash && !/^Cosigner \d+$/.test(o.name))?.name ?? s.name })) };
    else list.push(entry);
    await this.save();
  }

  /** Tìm chỉ số y của mình trong script (nếu có). */
  private async myIndexIn(words: string[], script: NativeScriptJson): Promise<number | undefined> {
    const keys = new Set(keysOf(script));
    for (let y = 0; y < DISCOVER_GAP; y++) if (keys.has(await sharedKeyHash(words, y))) return y;
    return undefined;
  }

  /** Khám phá ví multisig đã đăng ký on-chain (CIP-0146) có chứa khóa của ví đang dùng. */
  async discoverShared(): Promise<SharedEntry[]> {
    this.requireUnlocked();
    const owner = this.activeMnemonicId();
    const words = this.words(owner);
    const creds = await Promise.all(Array.from({ length: DISCOVER_GAP }, (_, y) => sharedKeyHash(words, y)));
    const regs = await this.p().chain.findRegistrations(creds);
    const out: SharedEntry[] = [];
    for (const r of regs) {
      const names: Signer[] = Object.entries(r.metadata.participants ?? {}).map(([keyHash, v]) => ({ keyHash, name: String((v as { name?: string }).name ?? "") })).filter((s) => s.name);
      const w = makeSharedWallet({ name: r.metadata.name || "Ví multisig", network: this.state.network, paymentScript: r.payment, stakeScript: r.stake, signers: names, myIndex: await this.myIndexIn(words, r.payment), registeredTx: r.txHash });
      const entry = { ...w, ownerWalletId: owner };
      await this.persistShared(entry);
      out.push(entry);
    }
    return out;
  }

  /**
   * Tạo ví multisig mới. `cosigners` là khóa của những người khác (key hash hoặc địa chỉ). Khóa của mình
   * (chỉ số `myIndex`) được thêm tự động. Script giống nhau ở mọi cosigner nên cần chia sẻ qua đăng ký on-chain hoặc file.
   */
  async createShared(p: { name: string; required: number; cosigners: Signer[]; myIndex?: number; myName?: string }): Promise<SharedEntry> {
    this.requireUnlocked();
    const owner = this.activeMnemonicId();
    const y = p.myIndex ?? (await this.sharedNextIndex()).y;
    const mine = await sharedKeyHash(this.words(owner), y);
    const others = p.cosigners.map((c) => ({ name: c.name, keyHash: toKeyHash(c.keyHash) }));
    if (others.some((c) => c.keyHash === mine)) throw new SharedError("INVALID_CONFIG", "Khóa của bạn được thêm tự động, đừng nhập lại");
    const signers = [{ name: p.myName || "Tôi", keyHash: mine }, ...others];
    const script = buildPaymentScript(p.required, signers.map((s) => s.keyHash));
    const w = makeSharedWallet({ name: p.name.trim() || "Ví multisig", network: this.state.network, paymentScript: script, signers, myIndex: y });
    if (this.sharedList().some((x) => x.id === w.id)) throw new SharedError("INVALID_CONFIG", "Ví này đã tồn tại");
    const entry = { ...w, ownerWalletId: owner };
    await this.persistShared(entry);
    return entry;
  }

  /**
   * Import ví từ: JSON xuất của ví này, file đăng ký off-chain CIP-0146 ({metadata, native_scripts} hex),
   * giao dịch đăng ký (CBOR), hoặc native script CBOR (xuất từ Eternl/Mesh).
   */
  async importShared(input: string, name?: string): Promise<SharedEntry> {
    this.requireUnlocked();
    const owner = this.activeMnemonicId();
    const words = this.words(owner);
    const text = input.trim();
    let payment: NativeScriptJson | undefined, stake: NativeScriptJson | undefined, label = name, signers: Signer[] = [];
    try {
      if (text.startsWith("{")) {
        const j = JSON.parse(text);
        if (j.paymentScript) {
          payment = j.paymentScript; stake = j.stakeScript; label ??= j.name; signers = j.signers ?? [];
        } else if (j.metadata && j.native_scripts) {
          // File đăng ký off-chain CIP-0146: chưa hỗ trợ (định dạng hex chưa được kiểm chứng với ví khác)
          throw new SharedError("INVALID_CONFIG", "File đăng ký off-chain chưa được hỗ trợ: hãy dán native script CBOR hoặc giao dịch đăng ký");
        } else throw new SharedError("INVALID_CONFIG", "JSON không nhận ra");
      } else if (/^[0-9a-f]+$/i.test(text)) {
        const reg = parseRegistration(text);
        if (reg) {
          payment = reg.payment; stake = reg.stake; label ??= reg.metadata.name;
          signers = Object.entries(reg.metadata.participants ?? {}).map(([keyHash, v]) => ({ keyHash, name: (v as { name?: string }).name ?? "" }));
        } else payment = scriptFromCbor(text);
      }
    } catch (e) {
      if (e instanceof SharedError) throw e;
      throw new SharedError("NO_SCRIPT", "Không đọc được dữ liệu ví multisig");
    }
    if (!payment) throw new SharedError("NO_SCRIPT", "Không tìm thấy native script");
    const w = makeSharedWallet({ name: label || "Ví multisig", network: this.state.network, paymentScript: payment, stakeScript: stake, signers, myIndex: await this.myIndexIn(words, payment) });
    const entry = { ...w, ownerWalletId: owner };
    await this.persistShared(entry);
    return entry;
  }

  /** Xuất ví để gửi cho cosigner (họ dùng "Nhập ví"). */
  exportShared(id: string): string {
    const w = this.sharedById(id);
    return JSON.stringify({ v: 1, name: w.name, network: w.network, paymentScript: w.paymentScript, stakeScript: w.stakeScript, signers: w.signers.map(({ name, keyHash }) => ({ name, keyHash })) });
  }

  async removeShared(id: string) {
    this.sharedById(id);
    this.state.shared = this.sharedList().filter((x) => x.id !== id);
    delete (this.state.requests ??= {})[id];
    await this.save();
  }

  async sharedBalance(id: string): Promise<AssetBalance[]> {
    return this.p().chain.getBalance([this.sharedById(id).address]);
  }

  /** Đăng ký ví on-chain (CIP-0146) để cosigner tự khám phá. Phí do ví thường của bạn trả; khóa multisig phải chưa từng đăng ký. */
  async registerShared(id: string): Promise<string> {
    const w = this.sharedById(id);
    if (w.myIndex === undefined) throw new SharedError("NOT_SIGNER", "Khóa của bạn không nằm trong ví này");
    const wallet = await this.meshWallet();
    const params = await this.p().chain.getProtocolParams().catch(() => undefined);
    const change = await wallet.getChangeAddress();
    const tx = await buildRegistrationTx(w, await wallet.getUtxos(), change, params);
    const signed = await wallet.signTx(tx);
    const hash = await wallet.submitTx(signed);
    w.registeredTx = hash;
    await this.save();
    return hash;
  }

  // ---- Yêu cầu ký ----

  private encodeRequest(r: SignRequest) {
    return JSON.stringify(r);
  }
  private decodeRequest(text: string): SignRequest {
    let r: SignRequest;
    try {
      r = JSON.parse(text.trim());
    } catch {
      throw new SharedError("INVALID_TX", "Yêu cầu ký không hợp lệ");
    }
    if (r?.kind !== "cardano-multisig-sign-request" || r.v !== 1 || typeof r.tx !== "string" || typeof r.walletId !== "string") throw new SharedError("INVALID_TX", "Yêu cầu ký không hợp lệ");
    return r;
  }
  private txKey(tx: string) {
    return resolveTxHash(tx); // hash thân giao dịch: không đổi khi thêm chữ ký
  }
  private async storeRequest(r: SignRequest) {
    const list = ((this.state.requests ??= {})[r.walletId] ??= []);
    const i = list.findIndex((x) => this.txKey(x.tx) === this.txKey(r.tx));
    if (i >= 0) list[i] = { ...r, memo: r.memo ?? list[i]!.memo, createdAt: list[i]!.createdAt };
    else list.push(r);
    await this.save();
  }

  /**
   * Các yêu cầu ký đang theo dõi (kèm trạng thái chữ ký). Tự dọn: yêu cầu đã được gửi lên chuỗi thì bỏ đi;
   * yêu cầu có UTxO đã bị tiêu bởi giao dịch khác thì đánh dấu `stale` (không thể ký/gửi nữa).
   */
  async listRequests(id: string): Promise<{ request: string; memo?: string; createdAt: number; preview: TxPreview; iSigned: boolean; stale: boolean }[]> {
    const w = this.sharedById(id);
    const mine = await this.myKeyHashes(w);
    const stored = (this.state.requests?.[id] ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
    let unspent: Set<string> | undefined;
    try {
      unspent = new Set((await this.p().fetcher.fetchAddressUTxOs(w.address)).map((u) => `${u.input.txHash}#${u.input.outputIndex}`));
    } catch { /* không đọc được UTxO: bỏ qua phát hiện lỗi thời */ }
    const out = [];
    let changed = false;
    for (const r of stored) {
      const preview = await inspectSharedTx(w, r.tx);
      const inputs = Serialization.Transaction.fromCbor(r.tx as never).body().inputs().values().map((i) => `${i.transactionId()}#${i.index()}`);
      const stale = !!unspent && inputs.some((i) => !unspent!.has(i));
      if (stale && (await this.p().chain.txExists(preview.txHash).catch(() => false))) {
        this.state.requests![id] = this.state.requests![id]!.filter((x) => this.txKey(x.tx) !== preview.txHash); // đã gửi rồi
        changed = true;
        continue;
      }
      out.push({ request: this.encodeRequest(r), memo: r.memo, createdAt: r.createdAt, preview, iSigned: preview.signedBy.some((k) => mine.includes(k)), stale });
    }
    if (changed) await this.save();
    return out;
  }

  private async myKeyHashes(w: SharedEntry) {
    return w.myIndex === undefined ? [] : [await sharedKeyHash(this.ownerWords(w), w.myIndex)];
  }

  /** Tạo đề xuất chi ADA từ ví multisig và ký luôn bằng khóa của mình. Trả về chuỗi yêu cầu ký để chia sẻ. */
  async proposeShared(id: string, to: string, lovelace: bigint, memo?: string): Promise<string> {
    const w = this.sharedById(id);
    this.assertAddress(to);
    if (lovelace < MIN_SEND) throw new WalletError("INVALID_AMOUNT", "Tối thiểu 1 ADA");
    if (w.myIndex === undefined) throw new SharedError("NOT_SIGNER", "Khóa của bạn không nằm trong ví này");
    const { fetcher } = this.p();
    const utxos = await fetcher.fetchAddressUTxOs(w.address);
    const params = await this.p().chain.getProtocolParams().catch(() => undefined);
    const unsigned = await buildSharedSend(w, utxos, to, lovelace, params);
    const signed = attachWitnesses(unsigned, [await signWithSharedKey(this.ownerWords(w), w.myIndex, unsigned)]);
    const req: SignRequest = { v: 1, kind: "cardano-multisig-sign-request", walletId: w.id, network: w.network, tx: signed, memo: memo?.slice(0, 200), createdAt: Date.now() };
    await this.storeRequest(req);
    return this.encodeRequest(req);
  }

  /** Kiểm tra yêu cầu ký nhận từ người khác (CIP-1854) trước khi hiển thị cho người dùng quyết định. */
  async inspectRequest(text: string): Promise<{ wallet: SharedEntry; preview: TxPreview; memo?: string; iSigned: boolean }> {
    const r = this.decodeRequest(text);
    const w = this.sharedById(r.walletId);
    if (r.network !== this.state.network || w.network !== this.state.network) throw new SharedError("INVALID_TX", `Yêu cầu thuộc mạng ${r.network}, bạn đang ở ${this.state.network}`);
    const mine = await this.myKeyHashes(w);
    const preview = await inspectSharedTx(w, r.tx, { requireOtherSigner: !(await this.hasMySignature(w, r.tx)), myKeyHashes: mine });
    return { wallet: w, preview, memo: r.memo, iSigned: preview.signedBy.some((k) => mine.includes(k)) };
  }
  private async hasMySignature(w: SharedEntry, tx: string) {
    const mine = await this.myKeyHashes(w);
    return (await inspectSharedTx(w, tx)).signedBy.some((k) => mine.includes(k));
  }

  /** Thêm chữ ký của mình vào yêu cầu; trả về yêu cầu mới (có thể gửi tiếp cho cosigner khác). */
  async signRequest(text: string, password: string): Promise<{ request: string; preview: TxPreview }> {
    await this.verifyPassword(password);
    const info = await this.inspectRequest(text);
    const w = info.wallet;
    if (w.myIndex === undefined) throw new SharedError("NOT_SIGNER", "Khóa của bạn không nằm trong ví này");
    const r = this.decodeRequest(text);
    let tx = r.tx;
    if (!info.iSigned) tx = attachWitnesses(tx, [await signWithSharedKey(this.ownerWords(w), w.myIndex, tx)]);
    const next: SignRequest = { ...r, tx };
    await this.storeRequest(next);
    return { request: this.encodeRequest(next), preview: await inspectSharedTx(w, tx) };
  }

  /** Gộp chữ ký từ một bản yêu cầu khác (cùng giao dịch) vào bản đang có. */
  async mergeRequests(a: string, b: string): Promise<{ request: string; preview: TxPreview }> {
    const ra = this.decodeRequest(a), rb = this.decodeRequest(b);
    if (ra.walletId !== rb.walletId || this.txKey(ra.tx) !== this.txKey(rb.tx)) throw new SharedError("INVALID_TX", "Hai yêu cầu không cùng giao dịch");
    const w = this.sharedById(ra.walletId);
    const sets = (await Promise.all([ra, rb].map(async (r) => Serialization.Transaction.fromCbor(r.tx as never).witnessSet().vkeys()?.values() ?? [])));
    const seen = new Set<string>();
    let base = Serialization.Transaction.fromCbor(ra.tx as never);
    const ws = base.witnessSet();
    const all = sets.flat().filter((v) => (seen.has(v.vkey()) ? false : (seen.add(v.vkey()), true)));
    ws.setVkeys(Serialization.CborSet.fromCore(all.map((v) => [v.vkey(), v.signature()] as [string, string]), Serialization.VkeyWitness.fromCore) as never);
    base.setWitnessSet(ws);
    const tx = base.toCbor();
    const preview = await inspectSharedTx(w, tx);
    const merged: SignRequest = { ...ra, tx, memo: ra.memo ?? rb.memo };
    await this.storeRequest(merged);
    return { request: this.encodeRequest(merged), preview };
  }

  /** Gửi giao dịch lên mạng khi đã đủ chữ ký. Nếu đã được gửi trước đó (ví dụ bởi cosigner khác) thì coi như thành công. */
  async submitRequest(text: string): Promise<string> {
    const r = this.decodeRequest(text);
    const w = this.sharedById(r.walletId);
    const preview = await inspectSharedTx(w, r.tx);
    if (!preview.enough) throw new SharedError("NOT_ENOUGH", `Mới có ${new Set(preview.signedBy).size}/${w.required} chữ ký`);
    const clear = async () => {
      this.state.requests ??= {};
      this.state.requests[w.id] = (this.state.requests[w.id] ?? []).filter((x) => this.txKey(x.tx) !== this.txKey(r.tx));
      await this.save();
    };
    try {
      const hash = await this.p().submitter.submitTx(r.tx);
      await clear();
      return hash;
    } catch (e) {
      const msg = this.submitErrorText(e);
      if (/đã được gửi trước đó|đã bị tiêu/.test(msg) && (await this.p().chain.txExists(preview.txHash).catch(() => false))) {
        await clear(); // giao dịch này đã nằm trên chuỗi: không phải lỗi
        return preview.txHash;
      }
      throw new SharedError("INVALID_TX", /đã bị tiêu/.test(msg) ? `${msg} Hãy bỏ yêu cầu này và tạo đề xuất mới.` : msg);
    }
  }

  async dismissRequest(id: string, text: string) {
    const r = this.decodeRequest(text);
    this.state.requests ??= {};
    this.state.requests[id] = (this.state.requests[id] ?? []).filter((x) => this.txKey(x.tx) !== this.txKey(r.tx));
    await this.save();
  }

  // ---------- CIP-30 (dùng cho dApp) ----------
  async cip30() {
    const w = await this.meshWallet();
    return {
      getNetworkId: () => w.getNetworkId(),
      getUtxos: () => w.getUtxosHex(),
      getBalance: async () => toValue(await w.getBalance()).toCbor() as string,
      getUsedAddresses: () => w.getUsedAddressesHex(),
      getUnusedAddresses: () => w.getUnusedAddressesHex(),
      getChangeAddress: () => w.getChangeAddressHex(),
      getRewardAddresses: () => w.getRewardAddressesHex(),
      getCollateral: () => w.getCollateralHex(),
      // CIP-30: signTx trả về WITNESS SET (CBOR), dApp tự ghép vào giao dịch. Trả cả giao dịch sẽ làm dApp hỏng.
      signTx: (tx: string, partial = false) => w.signTx(tx, partial, false),
      // CIP-30: địa chỉ và payload đều ở dạng hex. MeshWallet cần địa chỉ bech32; payload hex dùng nguyên.
      signData: (addr: string, payloadHex: string) => w.signData(payloadHex, /^[0-9a-f]+$/i.test(addr) ? Address.fromBytes(addr as never).toBech32() : addr),
      submitTx: (tx: string) => w.submitTx(tx),
    };
  }

  // ---------- nội bộ ----------
  private async meshWallet() {
    const w = this.getMeta(this.state.activeWalletId);
    if (w.kind === "watch") throw new WalletError("NOT_FOUND", "Ví watch-only không thể ký");
    const { fetcher, submitter } = this.p();
    const wallet = new MeshWallet({
      networkId: NETWORKS[this.state.network].networkId,
      fetcher,
      submitter,
      key: { type: "mnemonic", words: this.words(w.id) },
      accountIndex: this.state.activeAccount,
    });
    await wallet.init();
    return wallet;
  }

  private words(id: string) {
    this.requireUnlocked();
    const w = this.session.get(id);
    if (!w) throw new WalletError("LOCKED", "Ví đang khóa");
    return w;
  }

  private getMeta(id?: string) {
    const w = this.state.wallets.find((x) => x.id === id);
    if (!w) throw new WalletError("NOT_FOUND", "Không tìm thấy ví");
    return w;
  }

  /** Tiện ích: derive địa chỉ từ mnemonic (account 0) trên mạng hiện tại */
  deriveFor(mnemonic: string | string[]) {
    const w = typeof mnemonic === "string" ? normalizeMnemonic(mnemonic) : mnemonic;
    return deriveAccount(w, this.state.network, 0);
  }

  /** The address must be a valid preprod address (addr_test1…); mainnet addresses are rejected. */
  assertAddress(addr: string) {
    assertPreprodAddress(addr, this.state.network);
  }

}

/** State stored by the old multi-network build (preview/mainnet) is rejected at startup. */
function assertStoredNetwork(n: unknown) {
  try {
    assertNetwork(n);
  } catch (e) {
    if (e instanceof UnsupportedNetworkError) throw new WalletError("UNSUPPORTED_NETWORK", e.message);
    throw e;
  }
}
