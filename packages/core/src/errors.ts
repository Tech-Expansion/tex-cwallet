export class WalletError extends Error {
  constructor(
    public code: "LOCKED" | "BAD_PASSWORD" | "INVALID_MNEMONIC" | "NOT_FOUND" | "INVALID_ADDRESS" | "INVALID_AMOUNT" | "INSUFFICIENT_FUNDS" | "WEAK_PASSWORD" | "NO_VAULT" | "MAINNET_DISABLED",
    message: string,
  ) {
    super(message);
  }
}
