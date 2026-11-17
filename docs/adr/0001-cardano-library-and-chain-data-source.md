# ADR 0001: Cardano library and chain data source

- Status: Accepted
- Date: 2026-11-12
- Related: AI-2 (Epic AI-1)

## Context

The wallet derives keys (CIP-1852, CIP-1854), builds and signs transactions (ADA, native tokens, native-script
multisig), and reads UTxOs, balances and protocol parameters on preprod. The epic requires a widely used Cardano
library built on cardano-serialization-lib or equivalent, preprod only, a chain data source behind an interface,
and tests that run without network access.

Two candidates were proposed: **Mesh SDK** and **Lucid Evolution**.

## Decision

Use **Mesh SDK** (`@meshsdk/core`, `@meshsdk/core-cst`, `@meshsdk/common`) for keys, addresses, native scripts
and transaction building/signing, and `bip39` for mnemonics.

Chain data sits behind the `ChainClient` interface (`packages/core/src/chain.ts`): `getTip`, `getBalance`,
`getHistory`, `getProtocolParams`, `findRegistrations`, `txExists`. Implementation: `KoiosClient`, public Koios
preprod, no API key.

> **Update 2026-11-18 (AI-51):** the second implementation, `BlockfrostClient` behind our own proxy
> (`packages/proxy`), was removed together with the proxy and its setting. The release is a Chrome extension only,
> with nothing hosted by TexLabs, so Koios is the only data source. Bring it back from git history if Koios
> availability becomes a problem.

Tests use fakes of `ChainClient` / `fetch` and make no network calls.

The network is fixed to preprod: `NetworkName = "preprod"`. Every network value from outside (stored state,
`CARDANO_NETWORK`, RPC) goes through `assertNetwork()` and is rejected if it is not preprod.

## Rationale

- Mesh supports CIP-1854 (`m/1854'/1815'/0'/role/index`), `atLeast`/`all` native scripts and `MeshTxBuilder` for
  multisig, and runs both in the browser (MV3 extension) and in Node. The codebase already uses Mesh; moving to
  Lucid would cost effort without adding anything the epic needs.
- `@meshsdk/core-cst` (Cardano JS SDK serialization) reads and writes transaction and witness-set CBOR, which
  co-signing needs (AI-8).
- Mesh is actively maintained and widely used in the ecosystem (Mesh Multisig, many dApps).
- Lucid Evolution is also good at building transactions, but CIP-1854 and partial signing would need more custom
  code.

## Consequences

- We depend on Mesh coin selection and fee calculation; the wallet adds its own checks (inputs = outputs + fee,
  min-UTxO) before signing, and tests cover them.
- A major Mesh API change is contained in `wallet.ts`, `shared.ts` and `send.ts`.
- The lint step (`scripts/check-preprod.mjs`) blocks mainnet URLs, addresses and keys, and secret-looking strings.
