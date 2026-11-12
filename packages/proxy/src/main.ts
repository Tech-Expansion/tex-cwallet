import { createServer } from "node:http";
import { createProxy } from "./proxy";

const env = process.env;
const proxy = createProxy({
  keys: { mainnet: env.BLOCKFROST_MAINNET, preprod: env.BLOCKFROST_PREPROD, preview: env.BLOCKFROST_PREVIEW },
  adminToken: env.ADMIN_TOKEN,
  allowOrigin: env.ALLOW_ORIGIN,
  trustProxy: env.TRUST_PROXY === "1",
  perMinute: env.PER_MINUTE ? Number(env.PER_MINUTE) : undefined,
});
const configured = Object.entries({ mainnet: env.BLOCKFROST_MAINNET, preprod: env.BLOCKFROST_PREPROD, preview: env.BLOCKFROST_PREVIEW }).filter(([, v]) => v).map(([k]) => k);
if (!configured.length) {
  console.error("Cần đặt ít nhất một biến BLOCKFROST_MAINNET / BLOCKFROST_PREPROD / BLOCKFROST_PREVIEW");
  process.exit(1);
}
const port = Number(env.PORT ?? 8787);
createServer((req, res) => void proxy.handle(req, res)).listen(port, env.HOST ?? "127.0.0.1", () => console.log(`proxy ${env.HOST ?? "127.0.0.1"}:${port} mạng: ${configured.join(", ")}`));
