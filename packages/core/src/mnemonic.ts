import * as bip39 from "bip39";

/** New wallets always use 24 words (256-bit entropy, BIP-39). */
export const MNEMONIC_WORDS = 24;
/** Lengths accepted on restore (the BIP-39 lengths Cardano wallets use). */
export const RESTORE_LENGTHS: readonly number[] = [12, 15, 24];

const ENGLISH = new Set(bip39.wordlists.english);

export const generateMnemonic = (): string[] => bip39.generateMnemonic(256).split(" ");

export const normalizeMnemonic = (input: string): string[] =>
  input.normalize("NFKD").trim().toLowerCase().split(/\s+/).filter(Boolean);

export type MnemonicProblem =
  | { reason: "WORD_COUNT"; count: number }
  | { reason: "UNKNOWN_WORD"; position: number }
  | { reason: "CHECKSUM" };

/**
 * Check a mnemonic and return the specific problem. Messages only give the position of a bad word
 * and never echo the mnemonic.
 */
export function checkMnemonic(words: string[]): MnemonicProblem | null {
  if (!RESTORE_LENGTHS.includes(words.length)) return { reason: "WORD_COUNT", count: words.length };
  const bad = words.findIndex((w) => !ENGLISH.has(w));
  if (bad >= 0) return { reason: "UNKNOWN_WORD", position: bad + 1 };
  if (!bip39.validateMnemonic(words.join(" "))) return { reason: "CHECKSUM" };
  return null;
}

export function describeMnemonicProblem(p: MnemonicProblem): string {
  switch (p.reason) {
    case "WORD_COUNT":
      return `Mnemonic phải có ${RESTORE_LENGTHS.join(", ")} từ (đang có ${p.count} từ)`;
    case "UNKNOWN_WORD":
      return `Từ thứ ${p.position} không có trong danh sách từ BIP-39 tiếng Anh`;
    case "CHECKSUM":
      return "Mnemonic sai checksum: kiểm tra lại chính tả và thứ tự các từ";
  }
}

export const validateMnemonic = (words: string[]): boolean => checkMnemonic(words) === null;
