# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TEX Wallet: an open-source Cardano wallet as a Chrome MV3 extension (send/receive ADA and tokens, staking, NFTs,
CIP-30 dApp connector, m-of-n multisig with CIP-1854 keys and CIP-0146 registration). **Preprod testnet only.**
Not audited. README.md is the full user-facing feature reference.

## Commands

Run from the repo root (npm workspaces; Node 22, npm 10+).

| Command | Does |
| --- | --- |
| `npm run check` | `lint` + `test` — what CI runs; run before pushing |
| `npm run lint` | Typecheck both packages + `scripts/check-preprod.mjs` |
| `npm test` | Vitest unit tests for `@wallet/core` and `@wallet/extension` (no network) |
| `npm test -w @wallet/core -- send` | One test file (any part of the file name); same with `-w @wallet/extension` |
| `npm run build` | Extension into `packages/extension/dist` (load unpacked in `chrome://extensions`) |
| `npm run dev -w @wallet/extension` | `vite build --watch` (main target only; see build notes below) |
| `npm run e2e` | Playwright-core e2e of the built extension; needs `npm run build` first and `CHROME_PATH` set to a Chrome/Chromium binary. Hits real Koios preprod |
| `npm run flow:setup` / `flow:run` / `flow:status` | Real 2-of-2 multisig run on preprod with throwaway wallets in `.flow-preprod/` |

## Architecture

Two packages:

- **`packages/core` (`@wallet/core`)** — all wallet logic, no UI. Consumed as TypeScript source (`main: src/index.ts`,
  no build step); everything is re-exported from `src/index.ts`. `WalletManager` (`manager.ts`) is the single
  façade the extension calls; it owns persisted state (one `State` object in a `KeyValueStore`), the unlocked
  mnemonic in memory, and pending previews.
- **`packages/extension` (`@wallet/extension`)** — Chrome MV3 extension built with Vite + React + Tailwind.

### Request flow in the extension

```
dApp page ── window.cardano.walletcardano (src/inject/provider.ts, MAIN world)
   │ window.postMessage {target:"wallet-cardano-bg"}
content script (src/inject/content.ts, isolated world)
   │ chrome.runtime.sendMessage {kind:"dapp"}
service worker (src/background/index.ts) ──► WalletApi (src/background/api.ts) ──► WalletManager (core)
   ▲ chrome.runtime.sendMessage {kind:"wallet", req}
popup (src/popup/*, via rpc() in popup/rpc.ts)
```

- `WalletApi.handle(req)` is a big `switch` over a `Req` union (`type` field) for popup calls; `WalletApi.dapp()`
  handles CIP-30 methods. Adding a popup feature usually means: core function → `WalletManager` method → new
  `Req` case in `api.ts` → popup screen calling `rpc({ type: ... })`. Popup-side types in `popup/rpc.ts` mirror
  core types by hand.
- The dApp origin is taken from `sender.origin` (browser-provided), never from page data. `kind:"wallet"` messages
  are accepted only from the extension itself.
- `signTx`/`signData`/`enable` from dApps create an `Approval`; the service worker opens `popup.html#/approve/<id>`
  in a new window and waits for `resolveApproval`.
- Storage: `chrome.storage.local` behind core's `KeyValueStore` (tests use `MemoryStore`); session/auto-lock
  state in `chrome.storage.session`. Auto-lock after 15 min (`AUTO_LOCK_MS`). Mnemonics are encrypted with
  PBKDF2 + AES-GCM (`vault.ts`).

### Build

`vite.config.ts` switches on `TARGET`: the default `main` target builds popup + background as ES modules;
`scripts/postbuild.mjs` then rebuilds with `TARGET=content` and `TARGET=provider` as standalone IIFEs (content
scripts cannot be modules). `npm run dev` only watches the main target. Node polyfills (Buffer/global/process)
are required by Mesh. `public/manifest.json` is copied as-is.

### Security-critical invariants

- **Preview, then sign exactly what was previewed.** Sends, staking and collateral are built unsigned first
  (`prepareSend`, `prepareStake`, …), shown to the user, then re-verified right before signing (`verifySendTx`,
  `verifyStakeTx`: inputs, outputs, balance, certificates, metadata). Previews expire after 10 min
  (`PENDING_TTL_MS`). Don't add a signing path that skips the verify step.
- **Preprod only.** `NetworkName = "preprod"`; every network value from outside goes through `assertNetwork()`.
  `scripts/check-preprod.mjs` fails the lint on mainnet Koios or explorer URLs, a mainnet network id,
  mainnet bech32 (`addr1…`/`stake1…`), and secret-looking strings in any tracked file — including tests and docs.
- Fees and min-UTxO always come from live protocol parameters; if unavailable, refuse to build.
- Amounts are `bigint` lovelace / token quantities end to end; never floats.
- NFT image hosts: the manifest CSP `img-src` must equal the IPFS gateway list in `core/src/nft.ts` (a test
  enforces this). Metadata HTML is never rendered.
- Errors meant for the UI are `WalletError` with a code from `errors.ts`.

### Chain data and libraries

See `docs/adr/0001-…`. Mesh SDK (`@meshsdk/core`, `core-cst`, `common`) for keys, addresses, native scripts and
tx building/CBOR; `bip39` for mnemonics. Chain data goes through the `ChainClient` interface (`chain.ts`) with one
implementation, `KoiosClient` against public Koios preprod (no API key, no backend of ours). Unit tests use fake
`ChainClient`s / `fetch` and must not hit the network. Mesh API changes should stay contained in `wallet.ts`,
`shared.ts`, `send.ts`.

### Popup UI

- React SPA with hash routing in `App.tsx`; screens are one file each in `src/popup/`.
- i18n in `popup/i18n.tsx`: English is the default UI language; the `vi` dictionary is the source of `MessageKey` and `en` is
  typed `Record<MessageKey, string>`, so every new key must be added to both.
- Visual style follows the CKBolt design system: ink on paper, pills for actions, square hairline cards and tags,
  JetBrains Mono for machine-made text (addresses, hashes, amounts, eyebrow labels), and color only for state
  (`ok` settled, `warn` pending/action needed, `bad` failed). Don't add gradients, glows, shadows or decorative
  color; outgoing amounts are ink, not red.
- Tokens are CSS variables in `popup/style.css` (light on `:root`, dark on `[data-theme="dark"]`); the Tailwind names
  `night-*` (surfaces), `moon-*` (text), `ink`, `accent`, `border-hair` map to them. Fonts are bundled via
  `@fontsource` (no network). Instrument Sans has no Vietnamese glyphs, so `:root[lang="vi"]` switches `--font-sans`
  to Inter.
- Shared UI primitives in `popup/ui/ui.tsx` (`Button`, `Card`, `SectionLabel`, `StatusPill`, `Sheet`, …); keep
  screens on these rather than restyling inline.

## Conventions

- Branch: `<type>/<TICKET>-<description>` (e.g. `feat/AI-5-send-ada`).
- Commit subject: `[<TICKET>] <type>(<scope>): <description>`, Conventional Commits, ≤ 72 chars.
- Commits, code comments, ADRs and README are in English (older code still has Vietnamese comments; UI strings are
  English by default; e2e and store-asset scripts switch to Vietnamese first because they click Vietnamese labels).
- Releases: `main` → `release/<version>-<date>` → PR into `production`, which triggers `release.yml` (GitHub Release
  + Chrome Web Store). Bump the version in both `packages/extension/package.json` and `public/manifest.json`
  (must match). Details in `docs/release.md`.
- Changes touching keys, signing or transaction building need owner review.
