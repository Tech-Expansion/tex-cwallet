import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "vi" | "en";
export type ThemePref = "system" | "light" | "dark";

const vi = {
  "common.back": "Quay lại", "common.cancel": "Hủy", "common.close": "Đóng", "common.loading": "Đang tải…", "common.copy": "Sao chép", "common.copied": "Đã sao chép",
  "common.explorer": "Xem trên explorer", "common.save": "Lưu", "common.continue": "Tiếp tục", "common.password": "Mật khẩu", "common.wallet": "Ví",
  "nav.wallet": "Ví", "nav.activity": "Hoạt động", "nav.settings": "Cài đặt", "nav.multisig": "Multisig",
  "ms2.title": "Multisig", "ms2.discover": "Khám phá", "ms2.create": "Tạo ví", "ms2.import": "Nhập ví", "ms2.empty": "Chưa có ví multisig. Khám phá ví đã đăng ký, tạo ví mới hoặc nhập ví từ Eternl/Mesh.",
  "ms2.found": "Tìm thấy {n} ví", "ms2.none": "Không tìm thấy ví đăng ký nào cho khóa của bạn", "ms2.mykey": "Khóa multisig của bạn (CIP-1854)", "ms2.mykeyHint": "Gửi mã này cho người tạo ví để họ thêm bạn làm cosigner. Ví tự chọn khóa chưa dùng cho mỗi ví multisig mới, bạn không cần chọn gì.", "ms2.fundHint": "Ví multisig có địa chỉ riêng. Muốn dùng, hãy gửi ADA vào địa chỉ này (từ bất kỳ ví nào hoặc faucet). Chi tiền ra cần đủ số chữ ký.", "ms2.stale": "Yêu cầu này không còn dùng được: số dư (UTxO) của nó đã bị giao dịch khác tiêu. Hãy bỏ nó và tạo đề xuất mới.", "ms2.expired": "Đề xuất đã quá hạn hiệu lực: không ký/gửi được nữa, hãy tạo đề xuất mới.",
  "ms2.name": "Tên ví", "ms2.required": "Số chữ ký tối thiểu", "ms2.cosigners": "Cosigner khác", "ms2.cosignerHint": "Mỗi cosigner một dòng: tên (tuỳ chọn) và key hash, public key CIP-1854 hoặc địa chỉ của họ. Dán nhiều dòng một lúc cũng được.", "ms2.myName": "Tên của bạn", "ms2.created": "Đã tạo ví", "ms2.stepName": "Tên", "ms2.cosignerName": "Tên", "ms2.cosignerKey": "Key cosigner", "ms2.cosignerKeyPlaceholder": "Key hash, public key hoặc địa chỉ", "ms2.addCosigner": "Thêm cosigner", "ms2.removeCosigner": "Xóa cosigner", "ms2.previewTitle": "Địa chỉ ví sẽ tạo", "ms2.previewHint": "Địa chỉ này cố định theo bộ key và số chữ ký. Bấm để copy và gửi cho cosigner đối chiếu.", "ms2.previewWaiting": "Nhập key hợp lệ của mọi cosigner để xem trước địa chỉ.", "ms2.previewExists": "Ví này đã có trên thiết bị.", "ms2.createdHint": "Gửi dữ liệu ví cho các cosigner, hoặc đăng ký on-chain để họ tự tìm thấy ví.", "ms2.of": "{m} trong {n} chữ ký",
  "ms2.paste": "Dán native script (CBOR), giao dịch đăng ký hoặc JSON xuất từ ví này", "ms2.imported": "Đã nhập ví",
  "ms2.address": "Địa chỉ ví", "ms2.balance": "Số dư", "ms2.signers": "Cosigner", "ms2.you": "Bạn", "ms2.register": "Đăng ký on-chain", "ms2.registerHint": "Để cosigner tự khám phá ví. Tốn một khoản phí nhỏ, khóa chỉ đăng ký được một lần.", "ms2.registered": "Đã đăng ký on-chain", "share.download": "Tải file", "share.qrTooLong": "Dữ liệu quá dài để hiện QR. Hãy copy hoặc tải file rồi gửi cho cosigner.", "ms2.shareKey": "Chia sẻ key", "ms2.shareWallet": "Chia sẻ ví", "ms2.shareRequest": "Chia sẻ", "ms2.copyCbor": "Copy CBOR giao dịch (cho ví khác)",
  "ms2.propose": "Đề xuất chi tiền", "ms2.to": "Địa chỉ nhận", "ms2.amount": "Số ADA", "ms2.memo": "Ghi chú (tùy chọn)", "ms2.pending": "Yêu cầu chờ ký", "ms2.noPending": "Không có yêu cầu nào đang chờ", "ms2.sigs": "{n}/{m} chữ ký", "ms2.sign": "Ký", "ms2.signed": "Bạn đã ký", "ms2.submit": "Gửi lên mạng", "ms2.dismiss": "Bỏ", "ms2.submitted": "Đã gửi giao dịch",
  "ms2.pasteTitle": "Dán hoặc kéo-thả", "ms2.pasteAny": "Key cosigner, dữ liệu ví hoặc yêu cầu ký (JSON / CBOR). Có thể kéo-thả file vào đây.", "ms2.open": "Mở", "ms2.unknownInput": "Không nhận ra nội dung này. Hãy dán key cosigner, dữ liệu ví hoặc yêu cầu ký.", "ms2.requestAdded": "Đã thêm yêu cầu ký ({n}/{m} chữ ký)", "ms2.requestMerged": "Đã gộp chữ ký ({n}/{m})", "ms2.reviewTitle": "Yêu cầu ký", "ms2.fee": "Phí", "ms2.change": "(tiền thừa về ví)", "ms2.remove": "Xóa ví này khỏi thiết bị", "ms2.removeConfirm": "Xóa \"{name}\" khỏi thiết bị? Tiền vẫn nằm trên chuỗi.", "ms2.noKey": "Khóa của bạn không nằm trong ví này nên không thể ký.", "ms2.mesh": "Dùng Mesh Multisig", "ms2.walletWatch": "Cần ví có cụm từ khôi phục để dùng multisig.", "ms2.balanceLoading": "…",
  "ms.title": "Multisig (Mesh)", "ms.intro": "Ví nhiều chữ ký dùng Mesh Multisig. Ví này đóng vai trò signer: kết nối ví ở trang Mesh Multisig để tạo ví, đề xuất và ký giao dịch.", "ms.open": "Mở Mesh Multisig", "ms.features": "Giao dịch m-of-n, staking, DRep & bỏ phiếu governance, nhập/xuất CSV.", "ms.signer": "Thông tin signer của bạn", "ms.signerHint": "Đưa địa chỉ này cho người tạo ví multisig để thêm bạn làm signer.", "ms.rewards": "Địa chỉ reward (dùng để đăng nhập)", "ms.steps": "Cách dùng", "ms.s1": "Mở Mesh Multisig bằng Chrome đã cài extension này.", "ms.s2": "Bấm Connect wallet → chọn \"Cardano Multi Wallet\" → chấp nhận kết nối.", "ms.s3": "Chọn đúng mạng (cùng mạng với ví đang dùng ở đây).", "ms.s4": "Ký giao dịch: cửa sổ phê duyệt của ví sẽ hiện nội dung để bạn kiểm tra.", "ms.webNote": "Bản web không thể cung cấp ví cho trang khác — hãy dùng extension để ký trên Mesh Multisig.", "ms.network": "Mạng hiện tại",
  "welcome.title": "Cardano Multi Wallet", "welcome.sub": "Ví đa ví cho Cardano. Hiện chạy trên Preprod và Preview (testnet).",
  "welcome.create": "Tạo ví mới", "welcome.import": "Nhập ví có sẵn",
  "setup.title": "Đặt mật khẩu", "setup.hint": "Mật khẩu bảo vệ ví trên thiết bị này (tối thiểu 8 ký tự). Không thể khôi phục nếu quên — hãy giữ cụm từ khôi phục.",
  "setup.pw": "Mật khẩu", "setup.pw2": "Nhập lại mật khẩu", "setup.mismatch": "Mật khẩu nhập lại không khớp",
  "create.title": "Tạo ví mới", "create.name": "Tên ví", "create.warn": "Ghi lại 24 từ này theo đúng thứ tự và cất nơi an toàn. Ai có chúng đều lấy được tiền; mất chúng là mất ví.",
  "create.confirm": "Tôi đã sao lưu cụm từ khôi phục", "create.submit": "Tạo ví",
  "import.title": "Nhập ví", "import.words": "Cụm từ khôi phục (12/15/24 từ)", "import.watch": "Chỉ xem (địa chỉ)", "import.watchAddr": "Địa chỉ addr_test1…",
  "import.mode.seed": "Cụm từ", "import.mode.watch": "Chỉ xem",
  "unlock.title": "Mở khóa ví", "unlock.submit": "Mở khóa", "unlock.hint": "Nhập mật khẩu để tiếp tục.",
  "dash.balance": "Số dư", "dash.send": "Gửi", "dash.receive": "Nhận", "dash.refresh": "Làm mới", "dash.assets": "Tài sản", "dash.recent": "Gần đây",
  "dash.noTx": "Chưa có giao dịch", "dash.tokens": "Native token", "dash.faucet": "Lấy tADA từ faucet", "dash.chooseWallet": "Chọn ví", "dash.watchOnly": "Chỉ xem",
  "send.title": "Gửi ADA", "send.to": "Địa chỉ nhận", "send.amount": "Số ADA", "send.max": "Tối thiểu 1 ADA", "send.review": "Xem lại",
  "send.badAddr": "Địa chỉ {net} phải bắt đầu bằng {prefix}",
  "settings.advanced": "Nâng cao", "settings.proxy": "Proxy dữ liệu (Blockfrost)", "settings.proxyHint": "Tuỳ chọn: proxy Blockfrost preprod của bạn (giữ khóa API). Ví dụ https://proxy.example.com", "settings.proxyTestnet": "Dùng Blockfrost qua proxy thay cho Koios", "settings.proxySave": "Lưu proxy", "settings.proxyDenied": "Bạn chưa cấp quyền truy cập tới proxy này.", "settings.saved": "Đã lưu", "send.badAmt": "Số ADA không hợp lệ (tối đa 6 chữ số thập phân)", "send.minAmt": "Tối thiểu 1 ADA",
  "send.sheetTitle": "Xác nhận & ký", "send.amountLine": "Số tiền", "send.toLine": "Tới", "send.feeNote": "Phí mạng được tính khi dựng giao dịch.", "send.sign": "Ký & gửi", "send.signing": "Đang ký…",
  "send.done": "Đã gửi giao dịch", "send.watchOnly": "Ví chỉ xem không thể gửi.", "send.tokens": "Token gửi kèm (tuỳ chọn)", "send.tokenQty": "Số lượng", "send.adaOptional": "Bỏ trống để gửi đúng lượng ADA tối thiểu đi kèm token", "send.fee": "Phí mạng", "send.total": "Tổng ADA rời ví", "send.minAda": "ADA tối thiểu bắt buộc đi kèm token (min-UTxO)", "send.change": "Tiền thối về ví", "send.badQty": "Số lượng token phải là số nguyên dương",
  "sign.password": "Mật khẩu ví", "sign.note": "Khóa riêng không rời thiết bị. Giao dịch được ký cục bộ.",
  "receive.title": "Nhận ADA", "receive.note": "Chỉ gửi tADA/token testnet tới địa chỉ này.",
  "activity.title": "Hoạt động", "activity.empty": "Chưa có hoạt động nào",
  "wallets.title": "Ví của bạn", "wallets.add": "Thêm ví", "wallets.account": "Tài khoản", "wallets.addAccount": "Thêm tài khoản", "wallets.active": "Đang dùng",
  "settings.title": "Cài đặt", "settings.network": "Mạng", "settings.theme": "Giao diện", "settings.language": "Ngôn ngữ", "settings.theme.system": "Hệ thống", "settings.theme.light": "Sáng", "settings.theme.dark": "Tối",
  "settings.backup": "Cụm từ khôi phục", "settings.backupHint": "Nhập mật khẩu để hiện 24 từ.", "settings.show": "Hiện", "settings.hide": "Ẩn",
  "settings.lock": "Khóa ví", "settings.remove": "Xóa ví này", "settings.removeConfirm": "Xóa ví \"{name}\"? Hãy chắc chắn đã sao lưu cụm từ khôi phục.",
  "settings.autolock": "Tự khóa sau 15 phút không dùng.",
  "approve.enable": "Kết nối dApp", "approve.signTx": "Ký giao dịch", "approve.signData": "Ký dữ liệu", "approve.from": "Từ", "approve.accept": "Chấp nhận", "approve.reject": "Từ chối",
  "approve.warn": "Chỉ chấp nhận nếu bạn tin tưởng trang này.", "approve.gone": "Yêu cầu không còn hiệu lực.",
};
export type MessageKey = keyof typeof vi;

const en: Record<MessageKey, string> = {
  "common.back": "Back", "common.cancel": "Cancel", "common.close": "Close", "common.loading": "Loading…", "common.copy": "Copy", "common.copied": "Copied",
  "common.explorer": "View on explorer", "common.save": "Save", "common.continue": "Continue", "common.password": "Password", "common.wallet": "Wallet",
  "nav.wallet": "Wallet", "nav.activity": "Activity", "nav.settings": "Settings", "nav.multisig": "Multisig",
  "ms2.title": "Multisig", "ms2.discover": "Discover", "ms2.create": "Create", "ms2.import": "Import", "ms2.empty": "No multisig wallets yet. Discover registered wallets, create one, or import from Eternl/Mesh.",
  "ms2.found": "Found {n} wallet(s)", "ms2.none": "No registered wallets found for your key", "ms2.mykey": "Your multisig key (CIP-1854)", "ms2.mykeyHint": "Send this to whoever creates the wallet so they can add you as a cosigner. The wallet picks an unused key for each new multisig wallet, so you do not have to choose anything.", "ms2.fundHint": "A multisig wallet has its own address. To use it, send ADA to this address (from any wallet or the faucet). Spending needs enough signatures.", "ms2.stale": "This request can no longer be used: its funds (UTxOs) were spent by another transaction. Dismiss it and create a new proposal.", "ms2.expired": "This proposal has expired: it can no longer be signed or submitted. Create a new one.",
  "ms2.name": "Wallet name", "ms2.required": "Signatures required", "ms2.cosigners": "Other cosigners", "ms2.cosignerHint": "One row per cosigner: an optional name and their key hash, CIP-1854 public key or address. Pasting several lines at once also works.", "ms2.myName": "Your name", "ms2.created": "Wallet created", "ms2.stepName": "Name", "ms2.cosignerName": "Name", "ms2.cosignerKey": "Cosigner key", "ms2.cosignerKeyPlaceholder": "Key hash, public key or address", "ms2.addCosigner": "Add cosigner", "ms2.removeCosigner": "Remove cosigner", "ms2.previewTitle": "Address of the new wallet", "ms2.previewHint": "This address is fixed by the keys and the required signatures. Click to copy and send it to your cosigners to compare.", "ms2.previewWaiting": "Enter a valid key for every cosigner to preview the address.", "ms2.previewExists": "This wallet is already on this device.", "ms2.createdHint": "Send the wallet data to your cosigners, or register it on-chain so they find it on their own.", "ms2.of": "{m} of {n} signatures",
  "ms2.paste": "Paste a native script (CBOR), a registration transaction, or JSON exported from this wallet", "ms2.imported": "Wallet imported",
  "ms2.address": "Wallet address", "ms2.balance": "Balance", "ms2.signers": "Cosigners", "ms2.you": "You", "ms2.register": "Register on-chain", "ms2.registerHint": "Lets cosigners discover the wallet. Costs a small fee; a key can only be registered once.", "ms2.registered": "Registered on-chain", "share.download": "Download file", "share.qrTooLong": "Too long for a QR code. Copy it or download the file and send it to your cosigners.", "ms2.shareKey": "Share key", "ms2.shareWallet": "Share wallet", "ms2.shareRequest": "Share", "ms2.copyCbor": "Copy transaction CBOR (for other wallets)",
  "ms2.propose": "Propose a spend", "ms2.to": "Recipient address", "ms2.amount": "Amount (ADA)", "ms2.memo": "Memo (optional)", "ms2.pending": "Pending requests", "ms2.noPending": "No requests waiting", "ms2.sigs": "{n}/{m} signatures", "ms2.sign": "Sign", "ms2.signed": "You signed", "ms2.submit": "Submit", "ms2.dismiss": "Dismiss", "ms2.submitted": "Transaction submitted",
  "ms2.pasteTitle": "Paste or drop", "ms2.pasteAny": "A cosigner key, wallet data or a sign request (JSON / CBOR). You can also drop a file here.", "ms2.open": "Open", "ms2.unknownInput": "Not recognized. Paste a cosigner key, wallet data or a sign request.", "ms2.requestAdded": "Sign request added ({n}/{m} signatures)", "ms2.requestMerged": "Signatures merged ({n}/{m})", "ms2.reviewTitle": "Sign request", "ms2.fee": "Fee", "ms2.change": "(change back to wallet)", "ms2.remove": "Remove this wallet from device", "ms2.removeConfirm": "Remove \"{name}\" from this device? Funds stay on-chain.", "ms2.noKey": "Your key is not in this wallet, so you cannot sign.", "ms2.mesh": "Use Mesh Multisig", "ms2.walletWatch": "A wallet with a recovery phrase is required for multisig.", "ms2.balanceLoading": "…",
  "ms.title": "Multisig (Mesh)", "ms.intro": "Multi-signature wallets powered by Mesh Multisig. This wallet acts as a signer: connect it on the Mesh Multisig site to create wallets, propose and sign transactions.", "ms.open": "Open Mesh Multisig", "ms.features": "m-of-n transactions, staking, DRep & governance voting, CSV import/export.", "ms.signer": "Your signer details", "ms.signerHint": "Give this address to whoever creates the multisig wallet so they can add you as a signer.", "ms.rewards": "Reward address (used to sign in)", "ms.steps": "How to use", "ms.s1": "Open Mesh Multisig in Chrome with this extension installed.", "ms.s2": "Click Connect wallet → pick \"Cardano Multi Wallet\" → approve the connection.", "ms.s3": "Pick the matching network (same as the one active here).", "ms.s4": "Signing: the wallet's approval window shows what you are signing.", "ms.webNote": "The web version cannot provide a wallet to other sites — use the extension to sign on Mesh Multisig.", "ms.network": "Current network",
  "welcome.title": "Cardano Multi Wallet", "welcome.sub": "A multi-wallet for Cardano. Currently on Preprod and Preview (testnets).",
  "welcome.create": "Create new wallet", "welcome.import": "Import existing wallet",
  "setup.title": "Set a password", "setup.hint": "The password protects your wallet on this device (min. 8 characters). It cannot be recovered — keep your recovery phrase safe.",
  "setup.pw": "Password", "setup.pw2": "Repeat password", "setup.mismatch": "Passwords do not match",
  "create.title": "Create wallet", "create.name": "Wallet name", "create.warn": "Write down these 24 words in order and store them safely. Anyone with them can take your funds; losing them means losing the wallet.",
  "create.confirm": "I have backed up my recovery phrase", "create.submit": "Create wallet",
  "import.title": "Import wallet", "import.words": "Recovery phrase (12/15/24 words)", "import.watch": "Watch-only (address)", "import.watchAddr": "Address addr_test1…",
  "import.mode.seed": "Phrase", "import.mode.watch": "Watch-only",
  "unlock.title": "Unlock wallet", "unlock.submit": "Unlock", "unlock.hint": "Enter your password to continue.",
  "dash.balance": "Balance", "dash.send": "Send", "dash.receive": "Receive", "dash.refresh": "Refresh", "dash.assets": "Assets", "dash.recent": "Recent",
  "dash.noTx": "No transactions yet", "dash.tokens": "Native tokens", "dash.faucet": "Get tADA from the faucet", "dash.chooseWallet": "Choose wallet", "dash.watchOnly": "Watch-only",
  "send.title": "Send ADA", "send.to": "Recipient address", "send.amount": "Amount (ADA)", "send.max": "Minimum 1 ADA", "send.review": "Review",
  "send.badAddr": "A {net} address must start with {prefix}",
  "settings.advanced": "Advanced", "settings.proxy": "Data proxy (Blockfrost)", "settings.proxyHint": "Optional: your own Blockfrost preprod proxy (it keeps the API key). e.g. https://proxy.example.com", "settings.proxyTestnet": "Use Blockfrost via the proxy instead of Koios", "settings.proxySave": "Save proxy", "settings.proxyDenied": "Access to this proxy was not granted.", "settings.saved": "Saved", "send.badAmt": "Invalid amount (max 6 decimals)", "send.minAmt": "Minimum 1 ADA",
  "send.sheetTitle": "Confirm & sign", "send.amountLine": "Amount", "send.toLine": "To", "send.feeNote": "Network fee is computed when the transaction is built.", "send.sign": "Sign & send", "send.signing": "Signing…",
  "send.done": "Transaction submitted", "send.watchOnly": "Watch-only wallets cannot send.", "send.tokens": "Tokens to include (optional)", "send.tokenQty": "Quantity", "send.adaOptional": "Leave empty to send exactly the minimum ADA required with the tokens", "send.fee": "Network fee", "send.total": "Total ADA leaving the wallet", "send.minAda": "Minimum ADA that must travel with the tokens (min-UTxO)", "send.change": "Change back to wallet", "send.badQty": "Token quantity must be a positive whole number",
  "sign.password": "Wallet password", "sign.note": "Your keys never leave this device. The transaction is signed locally.",
  "receive.title": "Receive ADA", "receive.note": "Only send testnet tADA/tokens to this address.",
  "activity.title": "Activity", "activity.empty": "No activity yet",
  "wallets.title": "Your wallets", "wallets.add": "Add wallet", "wallets.account": "Account", "wallets.addAccount": "Add account", "wallets.active": "Active",
  "settings.title": "Settings", "settings.network": "Network", "settings.theme": "Appearance", "settings.language": "Language", "settings.theme.system": "System", "settings.theme.light": "Light", "settings.theme.dark": "Dark",
  "settings.backup": "Recovery phrase", "settings.backupHint": "Enter your password to reveal the 24 words.", "settings.show": "Show", "settings.hide": "Hide",
  "settings.lock": "Lock wallet", "settings.remove": "Remove this wallet", "settings.removeConfirm": "Remove wallet \"{name}\"? Make sure you backed up the recovery phrase.",
  "settings.autolock": "Auto-locks after 15 minutes of inactivity.",
  "approve.enable": "Connect dApp", "approve.signTx": "Sign transaction", "approve.signData": "Sign data", "approve.from": "From", "approve.accept": "Accept", "approve.reject": "Reject",
  "approve.warn": "Only accept if you trust this site.", "approve.gone": "This request is no longer valid.",
};

const DICT = { vi, en };
type Prefs = { lang: Lang; theme: ThemePref };
const read = (): Prefs => {
  try {
    const p = JSON.parse(localStorage.getItem("prefs") ?? "{}");
    return { lang: p.lang === "en" ? "en" : "vi", theme: ["light", "dark", "system"].includes(p.theme) ? p.theme : "system" };
  } catch {
    return { lang: "vi", theme: "system" };
  }
};

const Ctx = createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void }>({ prefs: { lang: "vi", theme: "system" }, setPrefs: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState(read);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setState((cur) => {
      const next = { ...cur, ...p };
      try { localStorage.setItem("prefs", JSON.stringify(next)); } catch { /* storage bị chặn: bỏ qua */ }
      return next;
    });
  }, []);
  // data-theme trên <html>; "system" theo hệ điều hành
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = prefs.theme === "system" ? (media?.matches ? "light" : "dark") : prefs.theme; };
    apply();
    media?.addEventListener?.("change", apply);
    return () => media?.removeEventListener?.("change", apply);
  }, [prefs.theme]);
  useEffect(() => { document.documentElement.lang = prefs.lang; }, [prefs.lang]);
  return <Ctx.Provider value={{ prefs, setPrefs }}>{children}</Ctx.Provider>;
}

export const usePrefs = () => useContext(Ctx);
export function useT() {
  const { prefs } = useContext(Ctx);
  return (key: MessageKey, vars?: Record<string, string>) => {
    let s: string = DICT[prefs.lang][key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, v);
    return s;
  };
}
