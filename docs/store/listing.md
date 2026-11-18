# Chrome Web Store listing

Source of truth for the TEX Wallet listing. Copy these fields into the
[developer dashboard](https://chrome.google.com/webstore/devconsole) by hand;
the release workflow only uploads the package (see [release.md](../release.md)).

## Store listing

| Field | Value |
| --- | --- |
| Name | TEX Wallet (from `manifest.json`) |
| Summary | From `manifest.json` `description` (max 132 chars) |
| Category | Tools |
| Language | English |
| Icon | `packages/extension/public/icons/icon-128.png` |
| Screenshots | `screenshot-1.png` … `screenshot-4.png` (1280x800) |
| Small promo tile | `promo-small-440x280.png` |
| Homepage | https://github.com/Tech-Expansion/tex-cwallet |
| Support | https://github.com/Tech-Expansion/tex-cwallet/issues |

Regenerate the images from the built extension:

```bash
npm run build
CHROME_PATH="<Chrome for Testing binary>" node packages/extension/scripts/store-assets.mjs
```

### Description

```text
TEX Wallet is an open-source Cardano wallet for Chrome, made by TexLabs.

Multisig without fees or servers
• Create m-of-n shared wallets (CIP-1854), compatible with Eternl shared wallets.
• Discover shared wallets your cosigners registered on chain (CIP-0146).
• Propose a spend, pass the request to cosigners, collect signatures and submit.
• Every request is checked before you sign: only plain payments from the shared
  wallet, a capped fee, and a clear view of what leaves the wallet.

Everyday wallet
• ADA and native tokens, NFTs, staking delegation and rewards.
• Address book, ADA Handle lookup and transaction memos (CIP-20).
• CIP-30 dApp connector: websites get nothing until you approve them.
• Vietnamese and English, light and dark themes.

Your keys stay in your browser
Recovery phrases are encrypted with your password and never leave your device.
TexLabs runs no server for the wallet and collects no data. Chain data comes
from the public Koios API.

Current release: Cardano preprod testnet only. Mainnet comes after testing.

TEX Wallet has not had an external security audit. Use it at your own risk and
keep a written backup of your recovery phrase.

Source code (Apache-2.0): https://github.com/Tech-Expansion/tex-cwallet
```

## Privacy practices

| Field | Value |
| --- | --- |
| Single purpose | A Cardano wallet: hold keys locally, show balances, and sign and submit transactions, including m-of-n multisig. |
| `storage` | Keeps the encrypted recovery phrases, wallet list, multisig wallets, pending sign requests, contacts and settings on the device. |
| Host permission `https://preprod.koios.rest/*` | Reads Cardano chain data (balances, history, protocol parameters) and submits signed transactions through the public Koios API. |
| Content scripts on `https://*/*` | Injects the standard Cardano wallet API (CIP-30) so websites can request a connection. No page data is read; a site gets nothing until the user approves it. |
| Remote code | No. All code ships in the package; the CSP allows only `'self'` and `'wasm-unsafe-eval'` for the bundled Cardano serialization library. |
| Data collected | None. Tick no data categories. |
| Certifications | Tick all three (no selling, no unrelated use, no creditworthiness use). |
| Privacy policy URL | https://github.com/Tech-Expansion/tex-cwallet/blob/main/PRIVACY.md |

## Distribution

| Field | Value |
| --- | --- |
| Visibility | Unlisted while the build is preprod only. Public after mainnet is enabled (decision 2026-11-18). |
| Regions | All |
| Contact email | contact@texlabs.org |
