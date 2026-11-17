# TEX Wallet

An open-source Cardano wallet for Chrome, made by TexLabs. It sends and receives ADA and native tokens, shows
balances and assets, stakes, connects to dApps (CIP-30), and runs m-of-n multisig wallets (CIP-1854 keys,
CIP-0146 registration, compatible with Eternl shared wallets).

> **Not audited.** The wallet has not had an external security audit. Use it at your own risk, keep a written
> backup of your mnemonic, and report security problems privately as described in [SECURITY.md](SECURITY.md).
>
> **Preprod for now.** This build runs on the `preprod` testnet only: any other network value (stored state,
> `CARDANO_NETWORK`, RPC) is rejected at startup. Mainnet comes in a later release. Use test funds only.

## Install

- **Chrome Web Store:** link added with the first store release.
- **GitHub Releases:** download `tex-wallet-<version>.zip` from the
  [releases page](https://github.com/Tech-Expansion/tex-cwallet/releases), check its SHA-256 against the
  release notes, unzip it, then in `chrome://extensions` turn on **Developer mode** and **Load unpacked** the
  folder. A zip install does not update itself.
- **From source:** see [Quick start](#quick-start).

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [Commands](#commands)
- [Run the extension](#run-the-extension)
- [Data source and proxy](#data-source-and-proxy)
- [Using the wallet](#using-the-wallet)
- [Testing](#testing)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)

## Requirements

- Node.js 22 (the e2e scripts use `node --experimental-strip-types`, available from Node 22.6) and npm 10+
- Chrome or Chromium, to load the extension and to run the e2e tests
- Optional: a Blockfrost **preprod** project id, only if you run the proxy

## Quick start

```sh
git clone https://github.com/Tech-Expansion/tex-cwallet.git
cd tex-cwallet
npm install
npm run check      # typecheck + preprod lint + all unit tests
npm run build      # extension -> packages/extension/dist
```

Then load `packages/extension/dist` in Chrome (see [Run the extension](#run-the-extension)).

## Repository layout

npm workspaces, TypeScript.

| Path | What it is |
| --- | --- |
| `packages/core` (`@wallet/core`) | Wallet logic, no UI: keys and mnemonics, balances, building and checking transactions, multisig, chain data clients |
| `packages/extension` (`@wallet/extension`) | Chrome MV3 extension (popup, background service worker, CIP-30 provider) |
| `packages/proxy` (`@wallet/proxy`) | Small server that keeps the Blockfrost key off the client, with cache and rate limit. See [its README](packages/proxy/README.md) |
| `scripts/check-preprod.mjs` | Lint that blocks mainnet URLs, addresses and keys, and secret-looking strings in tracked files |
| `docs/adr/` | Architecture decisions. [ADR 0001](docs/adr/0001-cardano-library-and-chain-data-source.md): Mesh SDK and the chain data interface |

Main modules in `packages/core/src`:

| File | Responsibility |
| --- | --- |
| `networks.ts` | The preprod network config and `assertNetwork()` |
| `mnemonic.ts`, `wallet.ts` | 24-word BIP-39 mnemonics, CIP-1852 account derivation |
| `vault.ts`, `storage.ts` | Mnemonic encryption (PBKDF2 + AES-GCM) and the storage interface |
| `chain.ts`, `koios.ts`, `blockfrost.ts`, `koiosProvider.ts` | `ChainClient` interface and its Koios / Blockfrost implementations |
| `balance.ts` | Balances as bigint, ADA formatting, asset names |
| `send.ts` | Build an unsigned payment, check it (balance, min-UTxO, recipient) before signing |
| `shared.ts`, `registration.ts` | Multisig: CIP-1854 keys, native scripts, partial signing, CIP-0146 registration |
| `manager.ts` | `WalletManager`: the API the extension calls |

## Commands

Run from the repo root.

| Command | Does |
| --- | --- |
| `npm run check` | `lint` then `test`. Run this before every push |
| `npm run lint` | Typecheck all packages + `scripts/check-preprod.mjs` |
| `npm test` | Unit tests (vitest) for core, extension and proxy. No network needed |
| `npm run typecheck` | `tsc` for each package |
| `npm run build` | Build the extension into `packages/extension/dist` |
| `npm run dev -w @wallet/extension` | Rebuild the extension on change |
| `npm run e2e` | End-to-end test of the built extension in Chromium (see [Testing](#testing)) |
| `npm run proxy` | Start the Blockfrost proxy |
| `npm run flow:setup` / `flow:run` / `flow:status` | Real 2-of-2 multisig run on preprod (see [Testing](#testing)) |

Run one test file: `npm test -w @wallet/core -- send` (any part of the file name).

## Run the extension

1. `npm run build`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose
   `packages/extension/dist`.
3. Open the extension, set a password (at least 8 characters), then create or restore a wallet.

After a code change, run `npm run build` again (or keep `npm run dev -w @wallet/extension` running) and press
reload on the extension card.

The wallet locks itself after 15 minutes without activity. The mnemonic is stored encrypted with your password
and only lives in memory while the wallet is unlocked.

dApps reach the wallet through CIP-30 as `window.cardano.walletcardano` (shown as "TEX Wallet"). Every `signTx` and `signData` call
opens an approval window that shows what will be signed.

## Data source and proxy

By default the wallet reads the chain from **public Koios preprod** (`https://preprod.koios.rest/api/v1`), with
no API key.

Optionally it can use **Blockfrost preprod** through `packages/proxy`, so the Blockfrost key never reaches the
browser:

```sh
BLOCKFROST_PREPROD=<your preprod project id> ADMIN_TOKEN=<any secret> npm run proxy
```

| Variable | Meaning |
| --- | --- |
| `BLOCKFROST_PREPROD` | Blockfrost preprod project id. Without it only the Koios route works |
| `CARDANO_NETWORK` | Optional. Anything other than `preprod` stops the proxy at startup |
| `PORT`, `HOST` | Listen address, default `127.0.0.1:8787` |
| `ADMIN_TOKEN` | Turns on `GET /_stats` |
| `ALLOW_ORIGIN`, `TRUST_PROXY`, `PER_MINUTE` | CORS origin, trust `X-Forwarded-For`, requests per minute per IP |

Keep real values in `packages/proxy/.env` (ignored by git) or in your process manager, never in the repo.
Then in the extension: **Cài đặt → Nâng cao → Proxy dữ liệu (Blockfrost)**, enter the proxy URL and tick
"Dùng Blockfrost qua proxy thay cho Koios".

More detail (routes, cache, stats): [packages/proxy/README.md](packages/proxy/README.md).

## Using the wallet

The UI is in Vietnamese by default (switch to English in **Cài đặt**). Labels below are the Vietnamese ones.

### Create or restore a wallet

- **Create:** the wallet shows a new 24-word mnemonic. Write it down; it is the only backup.
- **Restore:** paste an existing mnemonic (12, 15 or 24 words). Errors say whether the word count is wrong, which
  word position is not in the BIP-39 list, or the checksum is wrong. The words themselves are never repeated
  in messages.
- The receive address (**Nhận**) is a preprod base address starting with `addr_test1`.
- Get test ADA from the [Cardano faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) (choose
  Preprod). The dashboard has a faucet shortcut.

### Balance and assets

The dashboard shows the ADA balance and, under **Tài sản**, each native token with its readable name (or hex
when the name is not printable text), policy id and exact quantity. Quantities are bigints, so large token
amounts are exact.

### Send ADA or tokens

1. **Gửi** → enter a preprod address (`addr_test1…`). Mainnet or malformed addresses are rejected.
2. Enter an ADA amount, and/or quantities for tokens under **Token gửi kèm**. When you send tokens you can leave
   ADA empty: the wallet adds exactly the minimum ADA (min-UTxO) that must travel with them.
3. **Xem lại** builds the transaction **without signing it** and shows: amount, tokens, required minimum ADA,
   recipient, network fee and total ADA leaving the wallet. If funds or tokens are short, you get an error and
   nothing is built.
4. Enter your password and **Ký & gửi**. The wallet signs only the transaction you just reviewed (checked again
   right before signing) and submits it. A preview expires after 10 minutes.

Fees and min-UTxO always come from the live preprod protocol parameters; if they cannot be fetched, the wallet
refuses to build the transaction.

More on **Gửi** (AI-23):

- **Thêm người nhận** adds up to 20 recipients in one transaction, each with its own ADA and tokens. Every output
  is checked against min-UTxO, and the preview lists each recipient, the fee and the total.
- **Gửi tối đa** (one recipient) spends every UTxO and sends all ADA left after the fee. Tokens you don't pick stay
  in the wallet in one output that holds exactly their minimum ADA; there is no other change.
- **Ghi chú** adds a CIP-20 message (metadata label 674), split into lines of at most 64 bytes without breaking a
  character (up to 16 lines). The message is public on chain; the form says so. Before signing, the wallet checks
  that the transaction carries exactly this message and no other metadata.

### Staking

**Stake** on the dashboard shows whether the stake key is registered, the pool it delegates to and the rewards
that can be withdrawn. Search pools by ticker or `pool1…` id and compare saturation, margin, fixed cost and
pledge (facts from the chain only; no reward forecasts). **Delegate** registers the stake key first when needed:
the preview shows the 2 ADA deposit. **Rút thưởng** withdraws all rewards; **Huỷ đăng ký** withdraws everything,
deregisters and shows the deposit refund. Before signing, `verifyStakeTx` checks that the transaction holds
exactly the certificates of the chosen action for this wallet's stake key (and the chosen pool), a withdrawal
only from this wallet's reward address of exactly the expected amount, wallet inputs only, all outputs back to
the wallet and a balanced value. The wallet signs with the payment key and the stake key
(`m/1852'/1815'/a'/2/0`). Watch-only wallets cannot stake. Staking rewards may be taxable; the screen says so.

### Watch-only from an account public key

**Nhập ví → Chỉ xem** accepts a preprod address or an account public key (`acct_xvk…`, `xpub…` or 128 hex, as
exported by Eternl/Yoroi/cardano-address). Private keys (`acct_xsk…`, `xprv…`, longer hex) are refused and never
echoed back. With an account key the wallet derives base addresses `m/1852'/1815'/a'/{0,1}/i` with the account's
stake key, finds the used ones from the stake address (Koios `account_addresses` / Blockfrost
`/accounts/{stake}/addresses`) and scans each role until 20 unused addresses in a row. Balance and history merge
all of them (change to internal addresses counts as yours); **Nhận** shows the first unused external address.
Watch-only wallets cannot send or sign, and dApps cannot connect to them.

### Signing data for dApps and checking signatures

When a dApp calls CIP-30 `signData`, the approval window shows the dApp origin, the signing address (bech32),
the message as text when it is readable UTF-8 (hex otherwise, with the hex always available), and a warning
when the payload parses as a Cardano transaction or transaction body. **Cài đặt → Xác minh chữ ký** checks a
CIP-8 signature locally: paste the message (text or hex), the COSE_Sign1 and the COSE_Key, and optionally the
address the key must belong to.

### Collateral for dApps

**Cài đặt → Collateral cho dApp** creates the collateral that smart-contract dApps need: a preview, then a
signed payment of exactly 5 ADA to your own address. Its output #0 is recorded per wallet account. CIP-30
`getCollateral` returns only that ADA-only UTxO (`null` when there is none or it is smaller than the amount
asked; amounts above 5 ADA are refused). While **Không dùng collateral khi gửi tiền thường** is on (default),
normal sends, including send max, never spend it. **Bỏ collateral** forgets the mark; the 5 ADA stays as
normal funds.

### NFTs

**NFT** on the dashboard opens a gallery of the account's NFTs (tokens with quantity 1 and CIP-68 user tokens).
Metadata comes from CIP-25 (label 721 of the mint) or the CIP-68 reference datum and is cached locally for 7
days (the refresh button reloads it). Tap an NFT for its description, policy, attributes and files, and
**Gửi NFT này** to open Gửi with it filled in. The wallet only shows and transfers NFTs: no prices, no trading.

Images are shown only with `<img>`; HTML from metadata is never rendered. `ipfs://` links and bare CIDs load
through the IPFS gateway chosen in **Cài đặt → Nâng cao** (ipfs.io, dweb.link, Pinata or nftstorage.link);
`ar://` through arweave.net; image `data:` URIs are allowed. Any other host is blocked by the extension CSP
(`img-src`), and a test keeps that CSP equal to the gateway list in `core/src/nft.ts`.

### Address book and ADA Handle

**Cài đặt → Sổ địa chỉ** keeps contacts (name, preprod address, optional note). They are stored only in this
browser's wallet state and never sent to a server; mainnet or malformed addresses are refused, and an address
can be saved once.

On **Gửi**, the book icon in the recipient field picks a contact. You can also type an ADA Handle such as
`$alice`: the wallet looks up which preprod address holds that handle token (both the CIP-68 user token
`000de140…` and the legacy name under policy `f0ff48bb…`) and shows the address for you to check before you
sign. Handles held by several addresses, mainnet addresses and sub-handles (`x@y`) are refused. Handles minted
under the newer decentralized-minting policy are not resolved yet. When the recipient is not in your book, the
wallet warns that this is a first send and offers to save it.

### Activity and CSV export

**Hoạt động** lists transactions newest first, 10 at a time (**Tải thêm** for more). Each row shows the date,
the direction (received, sent or self transfer), the net ADA change with the fee included, how many tokens
changed, the fee you paid and the first line of a CIP-20 message. Tap a row for the details: every input and
output (your address highlighted), token changes, the fee, the block, the metadata as JSON and a link to the
preprod explorer. When you hold multisig wallets, a selector at the top switches to the history of one of them.

The file icon exports a CSV for a date range: `date_utc, tx_hash, direction, net_ada, fee_paid_ada,
token_changes, memo`. Amounts are exact (ADA with 6 decimals, token quantities as integers; never floats), the
file is UTF-8 with a BOM so spreadsheets read Vietnamese text, and messages that start with `=`, `+`, `-` or `@`
get a leading `'` so a spreadsheet does not run them as formulas. An export is limited to 2,000 transactions.

Koios and Blockfrost give the same result. Koios needs one request per page; Blockfrost needs 2 per transaction
in the list and 3 per transaction for details and CSV (it has no batch endpoint).

### Multisig (m-of-n)

Open the **Multisig** tab. Each person uses their own wallet; nobody shares private keys. Anything a cosigner
sends you (a key, wallet data, a sign request as JSON or raw transaction CBOR, or a downloaded file) goes into
the one **Dán hoặc kéo-thả** box: the wallet recognizes it and opens the right screen. Pasting a private key is
rejected.

1. **Share your key.** **Chia sẻ key** shows *Khóa multisig của bạn (CIP-1854)* as a QR code, with copy and
   download. It is a key hash derived from your mnemonic at `m/1854'/1815'/0'/0/y`. A cosigner key can also be
   given as a CIP-1854 public key (64 hex) or an address.
2. **Create** (**Tạo ví**): name, then one row per cosigner (name + key, checked as you type; you can paste
   several "name key" lines at once), then the required signatures on a slider. Your key is added
   automatically. The address of the new wallet is shown before anything is saved, with a copy button; the
   same keys and m always give the same address, whatever the order.
3. **Let the others add it.** Right after creating, the wallet offers **Đăng ký on-chain** (a small fee from your
   normal wallet): the others' wallets then find it on their own after unlocking. Or use **Chia sẻ ví** and
   they drop the file or paste the data into their box.
4. **Fund** the multisig address (`addr_test1w…`) from any wallet or the faucet.
5. **Propose** (**Đề xuất chi tiền**): address, amount, optional memo. The proposal is signed by you and expires
   after 24 hours (it carries `invalid_hereafter` = current tip + 86400 slots).
6. **Share the request** (**Chia sẻ** on the request: QR when short enough, copy, file, or the raw CBOR for other
   wallets). The cosigner drops or pastes it into their box; it appears in the request list. A copy with more
   signatures is merged automatically into the stored one.
7. **Sign and submit.** Each request shows who has signed, who is waiting and the time left. When your
   signature is the last one needed, "Gửi lên mạng ngay khi đủ chữ ký" submits it right away; otherwise press
   **Gửi lên mạng** once m signatures are present. The Multisig tab shows a badge with the number of requests
   that need you.

The wallet rejects a signature from a key that is not in the script, a transaction changed after it was signed,
and an expired proposal (create a new one). A request whose UTxO was spent by another transaction is marked
stale.

## Testing

### Unit tests

```sh
npm test
```

Tests use fake chain clients and need no network. They cover the acceptance criteria of AI-2..AI-8, for example
`networks.test.ts` (preprod only), `mnemonic.test.ts`, `balance.test.ts`, `send.test.ts`, `multisig.test.ts`
and `sharedFlow.test.ts` (propose, co-sign, submit, expiry) in `packages/core/src`.

### End-to-end (Chromium)

```sh
npm run build
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e
```

`CHROME_PATH` must point to a Chrome or Chromium binary (the default path only exists on the Linux CI image).
The test loads the built extension, walks through onboarding, send validation, settings and multisig, and
checks the Blockfrost route against a fake upstream behind the real proxy.

### Real multisig run on preprod

```sh
npm run flow:setup    # creates two throwaway wallets A and B and a 2-of-2 multisig; prints the address to fund
# send at least 12 tADA from the faucet to the printed multisig address
npm run flow:run      # A proposes 5 tADA to B, B checks and signs, submits, waits for confirmation
npm run flow:status   # balances of the multisig, A and B
```

The throwaway wallets live in `.flow-preprod/` (ignored by git, file mode 600). Use them for testnet only.

## Conventions

The team rules live in the `tex-vault` and `ai-workflow-kit` repositories; in short:

- Branch: `<type>/<TICKET>-<description>`, for example `feat/AI-5-send-ada`.
- Commit subject: `[<TICKET>] <type>(<scope>): <description>`, Conventional Commits, at most 72 characters, for
  example `[AI-5] feat(core): send ADA with fee preview, sign only after review`.
- Commits, code comments, ADRs and this README are in English.
- Releases: `main` → `release/<version>-<date>` → pull request into `production`; see [docs/release.md](docs/release.md).
- Run `npm run check` before pushing. Anything touching keys, signing or transaction building needs owner review.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails with `ETIMEDOUT` / `errno -60` | Network to the registry is flaky. Retry with `NODE_OPTIONS=--dns-result-order=ipv4first npm install --maxsockets=4 --fetch-retries=5 --fetch-timeout=600000` |
| `tsc: command not found` | `npm install` did not finish; fix the install first |
| The wallet refuses to start with `UNSUPPORTED_NETWORK` | State saved by an old multi-network build (preview/mainnet). Remove the extension data (or reinstall the extension) and restore your wallet from its mnemonic |
| "Không lấy được protocol parameters…" | The data source is unreachable; check your connection or the proxy |
| e2e cannot launch the browser | Set `CHROME_PATH` to your Chrome/Chromium binary |

## License

[Apache License 2.0](LICENSE).
