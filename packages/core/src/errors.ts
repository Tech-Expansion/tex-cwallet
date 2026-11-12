export class WalletError extends Error {
  constructor(
    public code: "LOCKED" | "BAD_PASSWORD" | "INVALID_MNEMONIC" | "NOT_FOUND" | "INVALID_ADDRESS" | "INVALID_AMOUNT" | "INSUFFICIENT_FUNDS" | "WEAK_PASSWORD" | "NO_VAULT" | "UNSUPPORTED_NETWORK" | "INSUFFICIENT_TOKENS" | "NO_PARAMS" | "INVALID_TX",
    message: string,
  ) {
    super(message);
  }
}
