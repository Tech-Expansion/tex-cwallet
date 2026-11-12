import * as bip39 from "bip39";

export const generateMnemonic = (words: 12 | 15 | 24 = 24): string[] =>
  bip39.generateMnemonic(words === 12 ? 128 : words === 15 ? 160 : 256).split(" ");

export const normalizeMnemonic = (input: string): string[] =>
  input.trim().toLowerCase().split(/\s+/);

export const validateMnemonic = (words: string[]): boolean =>
  [12, 15, 24].includes(words.length) && bip39.validateMnemonic(words.join(" "));
