# TEX Wallet – Privacy policy

Effective 18 November 2026. TEX Wallet is a Chrome extension made by TexLabs
([texlabs.org](https://texlabs.org)). Source code:
[github.com/Tech-Expansion/tex-cwallet](https://github.com/Tech-Expansion/tex-cwallet).

## In short

- TexLabs does not collect, store or sell any data about you. The wallet has no
  account, no analytics and no tracking, and TexLabs runs no server that the
  wallet talks to.
- Your recovery phrase (mnemonic) and keys never leave your browser. They are
  stored encrypted with your password.
- To show balances and send transactions, the wallet asks public Cardano data
  services about your addresses, as every light wallet does. Those services are
  listed below.

## What is stored on your device

| Data | Where and how |
| --- | --- |
| Recovery phrases | Extension storage (`chrome.storage.local`), encrypted with a key derived from your password (PBKDF2-SHA256, AES-GCM). Without your password it cannot be read. |
| Wallet list, addresses, multisig wallets, pending sign requests, contacts, settings | Extension storage on your device only. |
| Unlock session and the list of websites you allowed to connect | The browser's session storage, erased when you lock the wallet, when the session times out, or when the browser closes. |
| NFT metadata cache | Extension storage, kept for up to 7 days. |

Removing the extension deletes all of this. Your password is never sent anywhere
and cannot be recovered by TexLabs.

## What is sent to other services

| Service | What it receives | Why |
| --- | --- | --- |
| Koios (`koios.rest`), a public Cardano API | Your public addresses, stake address, transaction hashes, signed transactions you choose to submit, and lookups of ADA Handles you type | Balances, history, staking, multisig discovery, fees and submitting transactions |
| The IPFS gateway you choose in Settings (ipfs.io, dweb.link, Pinata or nftstorage.link) and arweave.net | Requests for the image files of NFTs you hold | Showing NFT images |
| Websites (dApps) you connect | Only what you approve: your addresses and balance after you allow the connection, and signatures for requests you approve one by one | The CIP-30 dApp connector |

These services see your IP address like any website you visit, and data on the
Cardano blockchain is public. Their own privacy policies apply. TexLabs has no
access to what they log.

## Permissions the extension asks for

- **storage**: to keep your encrypted wallet and settings on your device.
- **Access to Koios**: to read Cardano data and submit your transactions.
- **Content script on websites**: to offer the standard Cardano wallet interface
  (CIP-30) to websites. A website gets nothing until you approve its connection.

## Children

TEX Wallet is not directed to children under 13.

## Security

TEX Wallet has not had an external security audit. Keep a written backup of
your recovery phrase. Report security problems privately as described in
[SECURITY.md](SECURITY.md).

## Changes and contact

We publish any change to this policy in this file with a new effective date;
its history is the git log of this file. Questions:
[contact@texlabs.org](mailto:contact@texlabs.org).
