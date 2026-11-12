import { MeshWallet } from "@meshsdk/core";
import { NETWORKS, type NetworkName } from "./networks";

export interface DerivedAccount {
  index: number;
  baseAddress: string;
  rewardAddress: string;
}

/** Derive account (CIP-1852: m/1852'/1815'/index') từ mnemonic. */
export async function deriveAccount(words: string[], network: NetworkName, accountIndex = 0): Promise<DerivedAccount> {
  const wallet = new MeshWallet({
    networkId: NETWORKS[network].networkId,
    key: { type: "mnemonic", words },
    accountIndex,
  });
  await wallet.init();
  const a = wallet.getAddresses();
  return { index: accountIndex, baseAddress: a.baseAddressBech32!, rewardAddress: a.rewardAddressBech32! };
}
