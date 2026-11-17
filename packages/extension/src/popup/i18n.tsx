import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "vi" | "en";
export type ThemePref = "system" | "light" | "dark";

const vi = {
  "common.back": "Quay lại", "common.cancel": "Hủy", "common.close": "Đóng", "common.loading": "Đang tải…", "common.copy": "Sao chép", "common.copied": "Đã sao chép",
  "common.explorer": "Xem trên explorer", "common.save": "Lưu", "common.continue": "Tiếp tục", "common.password": "Mật khẩu", "common.wallet": "Ví",
  "nav.wallet": "Ví", "nav.activity": "Hoạt động", "nav.settings": "Cài đặt", "nav.multisig": "Multisig",
  "ms2.title": "Multisig", "ms2.discover": "Khám phá", "ms2.create": "Tạo ví", "ms2.import": "Nhập ví", "ms2.empty": "Chưa có ví multisig. Khám phá ví đã đăng ký, tạo ví mới hoặc nhập ví từ Eternl/Mesh.",
  "ms2.found": "Tìm thấy {n} ví", "ms2.none": "Không tìm thấy ví đăng ký nào cho khóa của bạn", "ms2.mykey": "Khóa multisig của bạn (CIP-1854)", "ms2.mykeyHint": "Gửi mã này cho người tạo ví để họ thêm bạn làm cosigner. Ví tự chọn khóa chưa dùng cho mỗi ví multisig mới, bạn không cần chọn gì.", "ms2.fundHint": "Ví multisig có địa chỉ riêng. Muốn dùng, hãy gửi ADA vào địa chỉ này (từ bất kỳ ví nào hoặc faucet). Chi tiền ra cần đủ số chữ ký.", "ms2.stale": "Yêu cầu này không còn dùng được: số dư (UTxO) của nó đã bị giao dịch khác tiêu. Hãy bỏ nó và tạo đề xuất mới.", "ms2.expired": "Đề xuất đã quá hạn hiệu lực: không ký/gửi được nữa, hãy tạo đề xuất mới.",
  "ms2.name": "Tên ví", "ms2.required": "Số chữ ký tối thiểu", "ms2.cosigners": "Cosigner khác", "ms2.cosignerHint": "Mỗi cosigner một dòng: tên (tuỳ chọn) và key hash, public key CIP-1854 hoặc địa chỉ của họ. Dán nhiều dòng một lúc cũng được.", "ms2.myName": "Tên của bạn", "ms2.created": "Đã tạo ví", "ms2.stepName": "Tên", "ms2.cosignerName": "Tên", "ms2.cosignerKey": "Key cosigner", "ms2.cosignerKeyPlaceholder": "Key hash, public key hoặc địa chỉ", "ms2.addCosigner": "Thêm cosigner", "ms2.removeCosigner": "Xóa cosigner", "ms2.previewTitle": "Địa chỉ ví sẽ tạo", "ms2.previewHint": "Địa chỉ này cố định theo bộ key và số chữ ký. Bấm để copy và gửi cho cosigner đối chiếu.", "ms2.previewWaiting": "Nhập key hợp lệ của mọi cosigner để xem trước địa chỉ.", "ms2.createdHint": "Gửi dữ liệu ví cho các cosigner, hoặc đăng ký on-chain để họ tự tìm thấy ví.", "ms2.of": "{m} trong {n} chữ ký",
  "ms2.paste": "Dán native script (CBOR), giao dịch đăng ký hoặc JSON xuất từ ví này", "ms2.imported": "Đã nhập ví",
  "ms2.address": "Địa chỉ ví", "ms2.balance": "Số dư", "ms2.signers": "Cosigner", "ms2.you": "Bạn", "ms2.register": "Đăng ký on-chain", "ms2.registerHint": "Để cosigner tự khám phá ví. Tốn một khoản phí nhỏ, khóa chỉ đăng ký được một lần.", "ms2.registered": "Đã đăng ký on-chain", "share.download": "Tải file", "share.qrTooLong": "Dữ liệu quá dài để hiện QR. Hãy copy hoặc tải file rồi gửi cho cosigner.", "ms2.shareKey": "Chia sẻ key", "ms2.shareWallet": "Chia sẻ ví", "ms2.shareRequest": "Chia sẻ", "ms2.copyCbor": "Copy CBOR giao dịch (cho ví khác)",
  "ms2.propose": "Đề xuất chi tiền", "ms2.to": "Địa chỉ nhận", "ms2.amount": "Số ADA", "ms2.memo": "Ghi chú (tùy chọn)", "ms2.pending": "Yêu cầu chờ ký", "ms2.noPending": "Không có yêu cầu nào đang chờ", "ms2.sigs": "{n}/{m} chữ ký", "ms2.sign": "Ký", "ms2.signed": "Bạn đã ký", "ms2.submit": "Gửi lên mạng", "ms2.dismiss": "Bỏ", "ms2.submitted": "Đã gửi giao dịch", "ms2.pendingBadge": "{n} yêu cầu multisig cần xử lý", "ms2.signedShort": "đã ký", "ms2.waiting": "chờ ký", "ms2.timeLeft": "Còn {t} trước khi hết hạn", "ms2.autoSubmit": "Gửi lên mạng ngay khi đủ chữ ký",
  "ms2.pasteTitle": "Dán hoặc kéo-thả", "ms2.pasteAny": "Key cosigner, dữ liệu ví hoặc yêu cầu ký (JSON / CBOR). Có thể kéo-thả file vào đây.", "ms2.open": "Mở", "ms2.unknownInput": "Không nhận ra nội dung này. Hãy dán key cosigner, dữ liệu ví hoặc yêu cầu ký.", "ms2.requestAdded": "Đã thêm yêu cầu ký ({n}/{m} chữ ký)", "ms2.requestMerged": "Đã gộp chữ ký ({n}/{m})", "ms2.reviewTitle": "Yêu cầu ký", "ms2.fee": "Phí", "ms2.change": "(tiền thừa về ví)", "ms2.remove": "Xóa ví này khỏi thiết bị", "ms2.removeConfirm": "Xóa \"{name}\" khỏi thiết bị? Tiền vẫn nằm trên chuỗi.", "ms2.noKey": "Khóa của bạn không nằm trong ví này nên không thể ký.", "ms2.mesh": "Dùng Mesh Multisig", "ms2.walletWatch": "Cần ví có cụm từ khôi phục để dùng multisig.", "ms2.balanceLoading": "…",
  "ms.title": "Multisig (Mesh)", "ms.intro": "Ví nhiều chữ ký dùng Mesh Multisig. Ví này đóng vai trò signer: kết nối ví ở trang Mesh Multisig để tạo ví, đề xuất và ký giao dịch.", "ms.open": "Mở Mesh Multisig", "ms.features": "Giao dịch m-of-n, staking, DRep & bỏ phiếu governance, nhập/xuất CSV.", "ms.signer": "Thông tin signer của bạn", "ms.signerHint": "Đưa địa chỉ này cho người tạo ví multisig để thêm bạn làm signer.", "ms.rewards": "Địa chỉ reward (dùng để đăng nhập)", "ms.steps": "Cách dùng", "ms.s1": "Mở Mesh Multisig bằng Chrome đã cài extension này.", "ms.s2": "Bấm Connect wallet → chọn \"TEX Wallet\" → chấp nhận kết nối.", "ms.s3": "Chọn đúng mạng (cùng mạng với ví đang dùng ở đây).", "ms.s4": "Ký giao dịch: cửa sổ phê duyệt của ví sẽ hiện nội dung để bạn kiểm tra.", "ms.network": "Mạng hiện tại",
  "welcome.title": "TEX Wallet", "welcome.sub": "Ví Cardano mã nguồn mở, có multisig. Hiện chạy trên Preprod (testnet).",
  "welcome.create": "Tạo ví mới", "welcome.import": "Nhập ví có sẵn",
  "setup.title": "Đặt mật khẩu", "setup.hint": "Mật khẩu bảo vệ ví trên thiết bị này (tối thiểu 8 ký tự). Không thể khôi phục nếu quên — hãy giữ cụm từ khôi phục.",
  "setup.pw": "Mật khẩu", "setup.pw2": "Nhập lại mật khẩu", "setup.mismatch": "Mật khẩu nhập lại không khớp",
  "create.title": "Tạo ví mới", "create.name": "Tên ví", "create.warn": "Ghi lại 24 từ này theo đúng thứ tự và cất nơi an toàn. Ai có chúng đều lấy được tiền; mất chúng là mất ví.",
  "create.confirm": "Tôi đã sao lưu cụm từ khôi phục", "create.submit": "Tạo ví",
  "import.title": "Nhập ví", "import.words": "Cụm từ khôi phục (12/15/24 từ)", "import.watch": "Chỉ xem (địa chỉ / xpub)", "import.watchAddr": "Địa chỉ preprod hoặc khoá công khai account (acct_xvk… / xpub…)",
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
  "send.addRecipient": "Thêm người nhận", "send.removeRecipient": "Bỏ người nhận này", "send.recipientN": "Người nhận #{n}", "send.sendMax": "Gửi tối đa (toàn bộ ADA còn lại sau phí)", "send.maxHint": "Toàn bộ ADA còn lại sau phí sẽ được gửi. Token không chọn vẫn ở lại ví (kèm đúng lượng ADA tối thiểu).", "send.maxPreview": "Gửi tối đa: không còn tiền thối ngoài phần ADA tối thiểu giữ token ở lại.", "send.tokensMax": "Token gửi theo (tuỳ chọn)", "send.all": "Tất cả",
  "send.memo": "Ghi chú (CIP-20, tuỳ chọn)", "send.memoPlaceholder": "Ví dụ: tiền học tháng 11", "send.memoHint": "{n}/{max} dòng 64 byte", "send.memoPublic": "Ghi chú được ghi công khai lên chuỗi: ai cũng đọc được và không xoá được. Đừng ghi thông tin cá nhân.", "send.memoTooLong": "Ghi chú quá dài",
  "stake.title": "Staking", "stake.notRegistered": "Stake key chưa đăng ký, chưa delegate.", "stake.registeredNoPool": "Stake key đã đăng ký, chưa delegate pool nào.", "stake.delegatedTo": "Đang delegate cho {ticker}", "stake.rewards": "Phần thưởng có thể rút", "stake.withdraw": "Rút thưởng", "stake.deregister": "Huỷ đăng ký",
  "stake.findPool": "Tìm pool", "stake.searchPlaceholder": "Ticker hoặc pool1…", "stake.noPools": "Không tìm thấy pool", "stake.delegate": "Delegate cho pool này", "stake.current": "Đang delegate", "stake.retiring": "sắp nghỉ", "stake.pool": "Pool",
  "stake.saturation": "Bão hoà", "stake.margin": "Margin", "stake.fixedCost": "Phí cố định", "stake.pledge": "Pledge",
  "stake.facts": "Số liệu pool lấy từ chuỗi preprod, chỉ để so sánh; ví không dự báo phần thưởng. ADA vẫn nằm trong ví của bạn khi delegate. Phần thưởng staking có thể phải chịu thuế theo quy định hiện hành; hãy tự tìm hiểu hoặc hỏi chuyên gia.",
  "stake.sheet.delegate": "Delegate", "stake.sheet.withdraw": "Rút thưởng", "stake.sheet.deregister": "Huỷ đăng ký stake key", "stake.deposit": "Cọc đăng ký stake key", "stake.refund": "Hoàn cọc", "stake.withdrawal": "Rút thưởng", "stake.depositNote": "Cọc được hoàn lại khi bạn huỷ đăng ký stake key.", "stake.deregNote": "Huỷ đăng ký rút hết phần thưởng, hoàn cọc và ngừng delegate.", "stake.sent": "Đã gửi giao dịch staking",
  "approve.signAddress": "Ký bằng địa chỉ", "approve.payloadText": "Nội dung sẽ ký", "approve.payloadHex": "Nội dung (hex)", "approve.looksLikeTx": "Cảnh báo: nội dung này trông giống một giao dịch Cardano. Ký dữ liệu như vậy có thể bị dùng để chi tiền của bạn. Chỉ ký nếu bạn hiểu rõ.",
  "verify.title": "Xác minh chữ ký", "verify.hint": "Dán nội dung đã ký, chữ ký COSE_Sign1 và COSE_Key (hex) từ CIP-30 signData. Kiểm tra chạy ngay trên máy, không gửi đi đâu.", "verify.payload": "Nội dung đã ký", "verify.payloadIsHex": "Nội dung ở dạng hex", "verify.address": "Địa chỉ ký (tuỳ chọn, kiểm tra key thuộc địa chỉ này)", "verify.check": "Kiểm tra", "verify.valid": "Chữ ký hợp lệ", "verify.invalid": "Chữ ký KHÔNG hợp lệ",
  "import.watchHint": "Chỉ dán khoá CÔNG KHAI. Ví từ chối khoá bí mật (acct_xsk…, xprv…). Với khoá account, ví tự dò địa chỉ (gap 20) và gộp số dư, lịch sử.",
  "collateral.title": "Collateral cho dApp", "collateral.hint": "dApp dùng smart contract cần một UTxO chỉ chứa ADA làm tài sản đảm bảo. Ví tạo 5 ADA gửi cho chính bạn; chỉ mất phí mạng.", "collateral.none": "Chưa có collateral.", "collateral.pending": "Đang chờ giao dịch collateral lên chuỗi (hoặc UTxO đã bị tiêu).", "collateral.ready": "Đã có collateral: {ada} {unit}.",
  "collateral.create": "Tạo collateral 5 ADA", "collateral.remove": "Bỏ collateral", "collateral.removeConfirm": "Bỏ đánh dấu collateral? 5 ADA vẫn ở trong ví như tiền thường.", "collateral.protect": "Không dùng collateral khi gửi tiền thường", "collateral.sheet": "Tạo collateral", "collateral.sheetBody": "Gửi 5 {unit} cho chính ví này để làm collateral.", "collateral.created": "Đã gửi giao dịch tạo collateral",
  "nft.title": "NFT", "nft.empty": "Ví chưa có NFT nào", "nft.noImage": "Không có ảnh", "nft.blocked": "Ảnh từ nguồn chưa được phép hiển thị", "nft.policy": "Policy", "nft.assetName": "Tên tài sản", "nft.standard": "Chuẩn", "nft.attributes": "Thuộc tính", "nft.files": "Tệp", "nft.send": "Gửi NFT này",
  "nft.noTrade": "Ví chỉ hiển thị và chuyển NFT; không mua bán, không định giá.", "nft.gatewayNote": "Ảnh IPFS tải qua {gw} (đổi trong Cài đặt → Nâng cao).",
  "settings.ipfsGateway": "Gateway ảnh IPFS", "settings.ipfsGatewayHint": "Ảnh NFT chỉ được tải từ gateway này và Arweave.",
  "contacts.title": "Sổ địa chỉ", "contacts.add": "Thêm liên hệ", "contacts.edit": "Sửa", "contacts.remove": "Xóa", "contacts.removeConfirm": "Xóa liên hệ \"{name}\"?", "contacts.empty": "Chưa có liên hệ nào",
  "contacts.name": "Tên", "contacts.address": "Địa chỉ preprod", "contacts.note": "Ghi chú (tuỳ chọn)", "contacts.search": "Tìm theo tên, địa chỉ, ghi chú", "contacts.pick": "Chọn từ sổ địa chỉ",
  "contacts.localOnly": "Sổ địa chỉ chỉ lưu trong trình duyệt này, không gửi lên máy chủ nào.", "contacts.firstSend": "Địa chỉ này chưa có trong sổ địa chỉ. Nếu đây là lần đầu gửi, hãy đối chiếu từng ký tự với người nhận.", "contacts.firstSendShort": "Lần đầu gửi tới địa chỉ này.", "contacts.saveThis": "Lưu vào sổ địa chỉ",
  "send.toPlaceholder": "{prefix}… hoặc $handle", "handle.resolving": "Đang tìm handle…", "handle.resolved": "{handle} trỏ tới", "handle.check": "Kiểm tra địa chỉ này trước khi ký: handle có thể đã đổi chủ.", "handle.notResolved": "Chưa tìm được địa chỉ cho handle này",
  "activity.title": "Hoạt động", "activity.empty": "Chưa có hoạt động nào",
  "activity.dir.in": "Nhận", "activity.dir.out": "Gửi", "activity.dir.self": "Tự chuyển", "activity.tokens": "{n} token", "activity.more": "Tải thêm",
  "activity.scope": "Xem lịch sử của", "activity.thisWallet": "Tài khoản đang dùng", "activity.multisig": "Multisig",
  "activity.detail": "Chi tiết giao dịch", "activity.memo": "Ghi chú (CIP-20)", "activity.inputs": "Đầu vào ({n})", "activity.outputs": "Đầu ra ({n})", "activity.metadata": "Metadata", "activity.feeOther": "người khác trả",
  "activity.export": "Xuất CSV", "activity.exportHint": "Tệp CSV gồm ngày giờ (UTC), mã giao dịch, hướng, số ADA thay đổi, phí bạn trả, token thay đổi và ghi chú. Số lượng giữ nguyên chính xác. Dùng để tự đối chiếu, kê khai thuế.", "activity.from": "Từ ngày", "activity.to": "Đến ngày", "activity.download": "Tải tệp CSV", "activity.badRange": "Khoảng ngày không hợp lệ",
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
  "ms2.name": "Wallet name", "ms2.required": "Signatures required", "ms2.cosigners": "Other cosigners", "ms2.cosignerHint": "One row per cosigner: an optional name and their key hash, CIP-1854 public key or address. Pasting several lines at once also works.", "ms2.myName": "Your name", "ms2.created": "Wallet created", "ms2.stepName": "Name", "ms2.cosignerName": "Name", "ms2.cosignerKey": "Cosigner key", "ms2.cosignerKeyPlaceholder": "Key hash, public key or address", "ms2.addCosigner": "Add cosigner", "ms2.removeCosigner": "Remove cosigner", "ms2.previewTitle": "Address of the new wallet", "ms2.previewHint": "This address is fixed by the keys and the required signatures. Click to copy and send it to your cosigners to compare.", "ms2.previewWaiting": "Enter a valid key for every cosigner to preview the address.", "ms2.createdHint": "Send the wallet data to your cosigners, or register it on-chain so they find it on their own.", "ms2.of": "{m} of {n} signatures",
  "ms2.paste": "Paste a native script (CBOR), a registration transaction, or JSON exported from this wallet", "ms2.imported": "Wallet imported",
  "ms2.address": "Wallet address", "ms2.balance": "Balance", "ms2.signers": "Cosigners", "ms2.you": "You", "ms2.register": "Register on-chain", "ms2.registerHint": "Lets cosigners discover the wallet. Costs a small fee; a key can only be registered once.", "ms2.registered": "Registered on-chain", "share.download": "Download file", "share.qrTooLong": "Too long for a QR code. Copy it or download the file and send it to your cosigners.", "ms2.shareKey": "Share key", "ms2.shareWallet": "Share wallet", "ms2.shareRequest": "Share", "ms2.copyCbor": "Copy transaction CBOR (for other wallets)",
  "ms2.propose": "Propose a spend", "ms2.to": "Recipient address", "ms2.amount": "Amount (ADA)", "ms2.memo": "Memo (optional)", "ms2.pending": "Pending requests", "ms2.noPending": "No requests waiting", "ms2.sigs": "{n}/{m} signatures", "ms2.sign": "Sign", "ms2.signed": "You signed", "ms2.submit": "Submit", "ms2.dismiss": "Dismiss", "ms2.submitted": "Transaction submitted", "ms2.pendingBadge": "{n} multisig requests need you", "ms2.signedShort": "signed", "ms2.waiting": "waiting", "ms2.timeLeft": "{t} left before it expires", "ms2.autoSubmit": "Submit as soon as there are enough signatures",
  "ms2.pasteTitle": "Paste or drop", "ms2.pasteAny": "A cosigner key, wallet data or a sign request (JSON / CBOR). You can also drop a file here.", "ms2.open": "Open", "ms2.unknownInput": "Not recognized. Paste a cosigner key, wallet data or a sign request.", "ms2.requestAdded": "Sign request added ({n}/{m} signatures)", "ms2.requestMerged": "Signatures merged ({n}/{m})", "ms2.reviewTitle": "Sign request", "ms2.fee": "Fee", "ms2.change": "(change back to wallet)", "ms2.remove": "Remove this wallet from device", "ms2.removeConfirm": "Remove \"{name}\" from this device? Funds stay on-chain.", "ms2.noKey": "Your key is not in this wallet, so you cannot sign.", "ms2.mesh": "Use Mesh Multisig", "ms2.walletWatch": "A wallet with a recovery phrase is required for multisig.", "ms2.balanceLoading": "…",
  "ms.title": "Multisig (Mesh)", "ms.intro": "Multi-signature wallets powered by Mesh Multisig. This wallet acts as a signer: connect it on the Mesh Multisig site to create wallets, propose and sign transactions.", "ms.open": "Open Mesh Multisig", "ms.features": "m-of-n transactions, staking, DRep & governance voting, CSV import/export.", "ms.signer": "Your signer details", "ms.signerHint": "Give this address to whoever creates the multisig wallet so they can add you as a signer.", "ms.rewards": "Reward address (used to sign in)", "ms.steps": "How to use", "ms.s1": "Open Mesh Multisig in Chrome with this extension installed.", "ms.s2": "Click Connect wallet → pick \"TEX Wallet\" → approve the connection.", "ms.s3": "Pick the matching network (same as the one active here).", "ms.s4": "Signing: the wallet's approval window shows what you are signing.", "ms.network": "Current network",
  "welcome.title": "TEX Wallet", "welcome.sub": "An open-source Cardano wallet with multisig. Currently on Preprod (testnet).",
  "welcome.create": "Create new wallet", "welcome.import": "Import existing wallet",
  "setup.title": "Set a password", "setup.hint": "The password protects your wallet on this device (min. 8 characters). It cannot be recovered — keep your recovery phrase safe.",
  "setup.pw": "Password", "setup.pw2": "Repeat password", "setup.mismatch": "Passwords do not match",
  "create.title": "Create wallet", "create.name": "Wallet name", "create.warn": "Write down these 24 words in order and store them safely. Anyone with them can take your funds; losing them means losing the wallet.",
  "create.confirm": "I have backed up my recovery phrase", "create.submit": "Create wallet",
  "import.title": "Import wallet", "import.words": "Recovery phrase (12/15/24 words)", "import.watch": "Watch-only (address / xpub)", "import.watchAddr": "Preprod address or account public key (acct_xvk… / xpub…)",
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
  "send.addRecipient": "Add recipient", "send.removeRecipient": "Remove this recipient", "send.recipientN": "Recipient #{n}", "send.sendMax": "Send max (all ADA left after the fee)", "send.maxHint": "All ADA left after the fee is sent. Tokens you don't pick stay in the wallet (with exactly their minimum ADA).", "send.maxPreview": "Send max: no change besides the minimum ADA that keeps the remaining tokens.", "send.tokensMax": "Tokens to include (optional)", "send.all": "All",
  "send.memo": "Message (CIP-20, optional)", "send.memoPlaceholder": "e.g. November tuition", "send.memoHint": "{n}/{max} lines of 64 bytes", "send.memoPublic": "The message is written publicly on chain: anyone can read it and it cannot be deleted. Do not include personal information.", "send.memoTooLong": "The message is too long",
  "stake.title": "Staking", "stake.notRegistered": "Stake key not registered, not delegated.", "stake.registeredNoPool": "Stake key registered, not delegated to a pool.", "stake.delegatedTo": "Delegated to {ticker}", "stake.rewards": "Withdrawable rewards", "stake.withdraw": "Withdraw rewards", "stake.deregister": "Deregister",
  "stake.findPool": "Find a pool", "stake.searchPlaceholder": "Ticker or pool1…", "stake.noPools": "No pool found", "stake.delegate": "Delegate to this pool", "stake.current": "Current pool", "stake.retiring": "retiring", "stake.pool": "Pool",
  "stake.saturation": "Saturation", "stake.margin": "Margin", "stake.fixedCost": "Fixed cost", "stake.pledge": "Pledge",
  "stake.facts": "Pool figures come from the preprod chain, for comparison only; the wallet does not forecast rewards. Your ADA stays in your wallet when delegated. Staking rewards may be taxable under current rules; check for yourself or ask a professional.",
  "stake.sheet.delegate": "Delegate", "stake.sheet.withdraw": "Withdraw rewards", "stake.sheet.deregister": "Deregister stake key", "stake.deposit": "Stake key deposit", "stake.refund": "Deposit refund", "stake.withdrawal": "Rewards withdrawn", "stake.depositNote": "The deposit is returned when you deregister the stake key.", "stake.deregNote": "Deregistering withdraws all rewards, returns the deposit and stops delegation.", "stake.sent": "Staking transaction sent",
  "approve.signAddress": "Signing address", "approve.payloadText": "Message to sign", "approve.payloadHex": "Payload (hex)", "approve.looksLikeTx": "Warning: this looks like a Cardano transaction. Signing it as data could be used to spend your funds. Only sign if you understand it.",
  "verify.title": "Verify signature", "verify.hint": "Paste the signed message, the COSE_Sign1 signature and the COSE_Key (hex) from CIP-30 signData. The check runs locally; nothing is sent.", "verify.payload": "Signed message", "verify.payloadIsHex": "Message is hex", "verify.address": "Signing address (optional: the key must belong to it)", "verify.check": "Verify", "verify.valid": "Signature is valid", "verify.invalid": "Signature is NOT valid",
  "import.watchHint": "Paste a PUBLIC key only. Private keys (acct_xsk…, xprv…) are refused. With an account key the wallet scans addresses (gap 20) and merges balance and history.",
  "collateral.title": "Collateral for dApps", "collateral.hint": "dApps with smart contracts need an ADA-only UTxO as collateral. The wallet sends 5 ADA to yourself; you only pay the network fee.", "collateral.none": "No collateral yet.", "collateral.pending": "Waiting for the collateral transaction on chain (or the UTxO was spent).", "collateral.ready": "Collateral set: {ada} {unit}.",
  "collateral.create": "Create 5 ADA collateral", "collateral.remove": "Remove collateral", "collateral.removeConfirm": "Stop using this UTxO as collateral? The 5 ADA stays in the wallet as normal funds.", "collateral.protect": "Keep collateral out of normal sends", "collateral.sheet": "Create collateral", "collateral.sheetBody": "Send 5 {unit} to this wallet as collateral.", "collateral.created": "Collateral transaction sent",
  "nft.title": "NFTs", "nft.empty": "No NFTs in this wallet", "nft.noImage": "No image", "nft.blocked": "Image source is not allowed", "nft.policy": "Policy", "nft.assetName": "Asset name", "nft.standard": "Standard", "nft.attributes": "Attributes", "nft.files": "Files", "nft.send": "Send this NFT",
  "nft.noTrade": "The wallet only shows and transfers NFTs; no trading, no prices.", "nft.gatewayNote": "IPFS images load through {gw} (change it in Settings → Advanced).",
  "settings.ipfsGateway": "IPFS image gateway", "settings.ipfsGatewayHint": "NFT images load only from this gateway and Arweave.",
  "contacts.title": "Address book", "contacts.add": "Add contact", "contacts.edit": "Edit", "contacts.remove": "Delete", "contacts.removeConfirm": "Delete contact \"{name}\"?", "contacts.empty": "No contacts yet",
  "contacts.name": "Name", "contacts.address": "Preprod address", "contacts.note": "Note (optional)", "contacts.search": "Search name, address, note", "contacts.pick": "Pick from address book",
  "contacts.localOnly": "The address book is stored only in this browser and never sent to any server.", "contacts.firstSend": "This address is not in your address book. If this is your first send, check every character with the recipient.", "contacts.firstSendShort": "First send to this address.", "contacts.saveThis": "Save to address book",
  "send.toPlaceholder": "{prefix}… or $handle", "handle.resolving": "Looking up handle…", "handle.resolved": "{handle} points to", "handle.check": "Check this address before signing: a handle can change owner.", "handle.notResolved": "No address found for this handle yet",
  "activity.title": "Activity", "activity.empty": "No activity yet",
  "activity.dir.in": "Received", "activity.dir.out": "Sent", "activity.dir.self": "Self transfer", "activity.tokens": "{n} tokens", "activity.more": "Load more",
  "activity.scope": "Show history of", "activity.thisWallet": "Current account", "activity.multisig": "Multisig",
  "activity.detail": "Transaction details", "activity.memo": "Message (CIP-20)", "activity.inputs": "Inputs ({n})", "activity.outputs": "Outputs ({n})", "activity.metadata": "Metadata", "activity.feeOther": "paid by sender",
  "activity.export": "Export CSV", "activity.exportHint": "The CSV has the date (UTC), transaction id, direction, ADA change, fee you paid, token changes and message. Amounts are exact. Use it for your own records and tax filing.", "activity.from": "From", "activity.to": "To", "activity.download": "Download CSV", "activity.badRange": "Invalid date range",
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
