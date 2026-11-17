#!/usr/bin/env node
// Project lint (AI-2): blocks anything that can point at mainnet and secrets committed to the repo.
// No dependencies: runs over the files git tracks.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

process.chdir(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !/(^|\/)(package-lock\.json|node_modules\/|dist\/)/.test(f))
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|md|html|sh|ya?ml|env)$/.test(f) || f.endsWith(".env.example"))
  .filter((f) => f !== "scripts/check-preprod.mjs");

const RULES = [
  { re: /cardano-mainnet\.blockfrost\.io/, why: "upstream Blockfrost mainnet" },
  { re: /(^|[^.\w-])api\.koios\.rest/, why: "Koios mainnet" },
  { re: /(^|[^.\w-])cardanoscan\.io/, why: "explorer mainnet" },
  { re: /networkId\s*[:=]\s*1\b/, why: "network id mainnet" },
  { re: /\b(addr1|stake1)[02-9ac-hj-np-z]{40,}/, why: "địa chỉ bech32 mainnet" },
  { re: /\bBLOCKFROST_MAINNET\b/, why: "biến khóa Blockfrost mainnet" },
  { re: /\b(mainnet|preprod|preview)[A-Za-z0-9]{28,}\b/, why: "giống project id Blockfrost (secret)" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: "private key" },
  { re: /\b(xprv|ed25519e?_sk)1[02-9ac-hj-np-z]{40,}/, why: "khóa bí mật Cardano" },
];

const problems = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) problems.push(`${f}:${i + 1}: ${r.why}\n    ${line.trim().slice(0, 160)}`);
  });
}

if (problems.length) {
  console.error(`check-preprod: ${problems.length} vấn đề\n` + problems.join("\n"));
  process.exit(1);
}
console.log(`check-preprod: OK (${files.length} file)`);
