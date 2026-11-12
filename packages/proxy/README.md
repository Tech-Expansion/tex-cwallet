# @wallet/proxy — proxy Blockfrost có cache

Giữ khóa API Blockfrost phía server (không nhúng vào extension), cache dùng chung, giới hạn tốc độ, đếm request.

```
BLOCKFROST_PREPROD=preprodXXXX ADMIN_TOKEN=bi-mat \
  TRUST_PROXY=1 PORT=8787 npm start -w @wallet/proxy
```

Chỉ phục vụ preprod (`CARDANO_NETWORK` khác preprod thì không khởi động). Chưa đặt khóa thì `/preprod/api/v0` trả 503; đường Koios `/koios/preprod/api/v1` không cần khóa.

| Biến | Ý nghĩa |
|---|---|
| `BLOCKFROST_PREPROD` | project id Blockfrost preprod |
| `ADMIN_TOKEN` | bật `GET /_stats` (header `Authorization: Bearer …`); không đặt = tắt |
| `PER_MINUTE` | giới hạn request/phút/IP (mặc định 120) |
| `TRUST_PROXY=1` | chỉ bật khi chạy sau reverse proxy đáng tin (đọc `X-Forwarded-For`) |
| `ALLOW_ORIGIN` | thêm header CORS |

Đường dẫn: `/preprod/api/v0/...` và `/koios/preprod/api/v1/...`. Chỉ cho phép các endpoint ví cần
(`addresses`, `txs`, `epochs/latest`, `blocks/latest`, `accounts`, `assets`, `scripts`, `POST tx/submit`).

Cache: tx đã xác nhận 1 giờ, tham số giao thức 10 phút, địa chỉ/UTxO 10–15 giây. Không cache lỗi.
Request trùng đang bay được gộp thành một.

`/_stats` trả số request upstream (thứ thực sự bị tính tiền) so với số request của client, theo mạng và route —
dùng nó để đo mức tiêu thụ thật trước khi chọn gói Blockfrost.

Trong extension: Cài đặt → Nâng cao → nhập URL proxy (ví dụ `https://proxy.example.com`).
