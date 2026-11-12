import { createServer } from "node:http";
import { createProxy } from "./proxy";

const env = process.env;
// Preprod only. Any other CARDANO_NETWORK value stops startup.
if (env.CARDANO_NETWORK && env.CARDANO_NETWORK.trim().toLowerCase() !== "preprod") {
  console.error(`CARDANO_NETWORK=${env.CARDANO_NETWORK} không được hỗ trợ: proxy chỉ chạy preprod`);
  process.exit(1);
}
const proxy = createProxy({
  keys: { preprod: env.BLOCKFROST_PREPROD },
  adminToken: env.ADMIN_TOKEN,
  allowOrigin: env.ALLOW_ORIGIN,
  trustProxy: env.TRUST_PROXY === "1",
  perMinute: env.PER_MINUTE ? Number(env.PER_MINUTE) : undefined,
});
if (!env.BLOCKFROST_PREPROD) console.warn("Chưa đặt BLOCKFROST_PREPROD: chỉ có đường /koios/preprod hoạt động");
const port = Number(env.PORT ?? 8787);
createServer((req, res) => void proxy.handle(req, res)).listen(port, env.HOST ?? "127.0.0.1", () => console.log(`proxy ${env.HOST ?? "127.0.0.1"}:${port} mạng: preprod`));
