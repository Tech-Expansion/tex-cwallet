# Security policy

TEX Wallet holds keys that control real funds. Please report security problems privately, not in public issues.

## Status

- The wallet has **not** had an external security audit. The code is open so that anyone can review it.
- Changes to keys, signing and transaction building are reviewed by a second maintainer before a release.
- Use it at your own risk. Keep a written backup of your mnemonic, and try new features on preprod first.

## How to report

Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this repository. Include:

- what an attacker can do (for example sign a transaction the user did not intend, read a mnemonic, spend from a
  multisig wallet without enough signatures);
- steps to reproduce, the version (`manifest.json`) and the browser;
- a proof of concept if you have one. Never use someone else's funds or keys to show a problem.

We aim to acknowledge a report within 3 working days and to give a first assessment within 10 working days. The
team works on this part time, so a fix may take longer; we will keep you updated and credit you in the release
notes unless you ask us not to.

## In scope

- The extension in `packages/extension` and the wallet logic in `packages/core`.
- Key derivation, mnemonic storage and encryption, transaction building, the checks before signing, multisig
  sign requests, and the CIP-30 interface offered to web pages.

## Out of scope

- Bugs in third-party services the wallet reads from (Koios, IPFS gateways) or in Cardano itself.
- Attacks that need malware already running on the user's computer or a compromised browser profile.
- Social engineering of users or maintainers.

## Supported versions

Only the latest release on the Chrome Web Store and on GitHub Releases gets security fixes.
