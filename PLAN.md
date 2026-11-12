# tex-cwallet — ví Cardano (chỉ preprod)

## Cách dùng
```
npm install
npm run check       # lint (typecheck + chặn cấu hình mainnet/secret) + toàn bộ unit test
npm test            # unit test (core, extension, proxy)
npm run build       # -> packages/extension/dist  (nạp ở chrome://extensions)
npm run e2e         # cần Node >= 20 + Chromium (CHROME_PATH); có cả Blockfrost preprod qua proxy thật
npm run proxy       # proxy Blockfrost (xem packages/proxy/README.md)
```

## Mạng: chỉ preprod (Epic AI-1)
- `core/src/networks.ts`: `NetworkName = "preprod"`. Không có preview/mainnet ở bất kỳ đâu.
- Mọi giá trị mạng từ ngoài vào (state đã lưu, biến `CARDANO_NETWORK`, RPC `setNetwork`) đi qua `assertNetwork()`; khác preprod thì từ chối khi khởi động.
- Nguồn dữ liệu sau interface `ChainClient`: Koios preprod công khai (mặc định) hoặc Blockfrost preprod qua `packages/proxy` (khóa API ở proxy, đọc từ `BLOCKFROST_PREPROD`). Xem `docs/adr/0001-*.md`.
- Địa chỉ nhận/gửi phải là `addr_test1…`; địa chỉ mainnet bị từ chối.
- State lưu từ bản đa mạng cũ (preview/mainnet) không nạp được: cần tạo lại ví.

## Multisig (kiểu Eternl: CIP-1854 + CIP-0146)
- Khóa multisig `m/1854'/1815'/0'/role/y` suy ra từ cùng cụm 24 từ (role 0 thanh toán, 2 stake); KHÔNG phải khóa 1852 thường.
- Ví = native script m-of-n. Tạo ví (nhập key hash cosigner), nhập ví (native script CBOR / giao dịch đăng ký / JSON xuất), khám phá ví đã đăng ký on-chain (nhãn 1854), đăng ký ví on-chain.
- Yêu cầu ký = giao dịch ký một phần, chia sẻ bằng sao chép/dán. Quy tắc CIP-1854: kiểm tra script đúng ví, chữ ký hợp lệ và thuộc cosigner, giao dịch nhận về phải có chữ ký cosigner khác.
- Đã kiểm thử với đăng ký thật trên preprod (Koios). Chưa hỗ trợ: metadata mã hóa (CIP-83), file đăng ký off-chain, ký bằng phần cứng, chuyển native token, staking từ ví multisig.
- Eternl còn có kênh chia sẻ "sign request" riêng chưa có tài liệu công khai nên chưa tương thích; trao đổi hiện qua sao chép/dán.
- Mesh Multisig vẫn dùng được qua extension (CIP-30): xem liên kết trong tab Multisig.

## Chưa làm
- Gửi native token/NFT, staking, DRep/governance, Ledger/Trezor, multi-sig
- Tự làm mới định kỳ + cache offline trong extension
- Kiểm toán bảo mật
- Triển khai proxy thật + đo `/_stats` để chọn gói Blockfrost

## Triển khai (đã deploy)
- Web: https://cardano.75-119-138-128.sslip.io/ — extension zip: /cardano-multi-wallet-extension.zip
- Proxy Blockfrost preprod: systemd `wallet-cardano-proxy` (127.0.0.1:8787), khóa `BLOCKFROST_PREPROD` trong `packages/proxy/.env`. Bản deploy hiện tại vẫn là bản đa mạng từ `master`; nhánh `preprod-only` chưa deploy.
- Caddy: khối `cardano.75-119-138-128.sslip.io` trong /etc/caddy/Caddyfile (có bản sao lưu cùng thư mục).
- Cập nhật: `./deploy.sh`; xem số request thật: `curl -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/_stats`.
- E2E trên bản deploy: `BASE_URL=https://cardano.75-119-138-128.sslip.io/ npm run e2e:web -w @wallet/extension`.
