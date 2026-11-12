#!/usr/bin/env bash
# Build lại và cập nhật bản đã deploy (web + extension zip). Proxy: systemctl restart wallet-cardano-proxy.
# Key Blockfrost nằm trong packages/proxy/.env (git bỏ qua, quyền 600) — script này không đụng tới.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
HOST="${HOST:-cardano.75-119-138-128.sslip.io}"
WWW=/var/www/cardano-wallet
cd "$(dirname "$0")/packages/extension"
export VITE_PROXY_URL="https://$HOST/proxy"
npm run build && npm run build:web
mkdir -p "$WWW" && rm -rf "$WWW"/* && cp -r dist-web/* "$WWW"/ && rm -f "$WWW/web.html"
(cd dist && rm -f "$WWW/cardano-multi-wallet-extension.zip" && python3 - <<PY
import zipfile, os
z = zipfile.ZipFile("$WWW/cardano-multi-wallet-extension.zip", "w", zipfile.ZIP_DEFLATED)
for r, _, fs in os.walk("."):
    for f in fs:
        p = os.path.join(r, f); z.write(p, os.path.relpath(p, "."))
z.close()
PY
)
echo "OK: https://$HOST/"
