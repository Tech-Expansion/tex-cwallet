import { describe, it, expect } from "vitest";
import {
  parseNft, resolveImage, datumToJson, cip68FromDatum, cip25Entry, splitUnit, nftUnits, loadNfts, NftCache, MemoryStore, KoiosClient, BlockfrostClient,
  WalletManager, IPFS_GATEWAYS, IMAGE_HOSTS, CIP68_NFT_LABEL, CIP68_REF_LABEL, NFT_CACHE_TTL_MS, type NftMetadataSource, type ProviderFactory,
} from "./index";

const P = "a1".repeat(28);
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CIDV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;

describe("AI-24: đọc metadata", () => {
  it("CIP-25 v1 (tên dạng chữ) và v2 (tên hex), chuỗi dài bị chia mảng được nối lại", () => {
    const md = { [P]: { Bunny1: { name: "Bunny #1", image: ["ipfs://", CID], mediaType: "image/png", description: "Thỏ", Color: "Blue", traits: ["a", "b"] } } };
    const e = cip25Entry(md, P, hex("Bunny1"))!;
    const n = parseNft(P + hex("Bunny1"), { cip25: e });
    expect(n).toMatchObject({ standard: "cip25", name: "Bunny #1", image: `ipfs://${CID}`, mediaType: "image/png", description: "Thỏ", assetName: "Bunny1" });
    expect(n.attributes).toEqual([{ key: "Color", value: "Blue" }, { key: "traits", value: "ab" }]);
    expect(cip25Entry({ [P]: { [hex("X")]: { name: "v2" } } }, P, hex("X"))).toEqual({ name: "v2" });
    expect(cip25Entry({}, P, hex("X"))).toBeUndefined();
  });
  it("CIP-68: datum Constr 0 [map, version] -> map; bytes đọc thành chữ", () => {
    const datum = { constructor: 0, fields: [{ map: [
      { k: { bytes: hex("name") }, v: { bytes: hex("Rồng") } },
      { k: { bytes: hex("image") }, v: { bytes: hex(`ipfs://${CIDV1}`) } },
      { k: { bytes: hex("level") }, v: { int: 7 } },
      { k: { bytes: hex("tags") }, v: { list: [{ bytes: hex("x") }] } },
    ] }, { int: 1 }] };
    expect(cip68FromDatum(datum)).toEqual({ name: "Rồng", image: `ipfs://${CIDV1}`, level: "7", tags: ["x"] });
    expect(datumToJson({ bytes: "ff00" })).toBe("ff00");
    const n = parseNft(P + CIP68_NFT_LABEL + hex("dragon"), { cip68: cip68FromDatum(datum), cip25: { name: "cũ" } });
    expect(n).toMatchObject({ standard: "cip68", name: "Rồng", assetName: "dragon" });
  });
  it("không có metadata: dùng tên tài sản", () => {
    expect(parseNft(P + hex("Plain"), undefined)).toMatchObject({ standard: "none", name: "Plain", files: [], attributes: [] });
    expect(splitUnit(P + CIP68_REF_LABEL + "ab")).toEqual({ policyId: P, label: CIP68_REF_LABEL, nameHex: "ab" });
  });
  it("chỉ lấy token số lượng 1 hoặc user token CIP-68", () => {
    expect(nftUnits([{ unit: "lovelace", quantity: 1n }, { unit: P + "01", quantity: 1n }, { unit: P + "02", quantity: 5n }, { unit: P + CIP68_NFT_LABEL + "03", quantity: "2" }]))
      .toEqual([P + "01", P + CIP68_NFT_LABEL + "03"]);
  });
});

describe("AI-24 AC-002: ảnh an toàn", () => {
  const gw = "https://dweb.link";
  it("ipfs:// và CID trần đi qua gateway đã chọn; gateway lạ của https chuyển về gateway mình", () => {
    expect(resolveImage(`ipfs://${CID}`, gw)).toBe(`${gw}/ipfs/${CID}`);
    expect(resolveImage(`ipfs://ipfs/${CIDV1}/1.png`, gw)).toBe(`${gw}/ipfs/${CIDV1}/1.png`);
    expect(resolveImage(CID, gw)).toBe(`${gw}/ipfs/${CID}`);
    expect(resolveImage(`https://evil.example/ipfs/${CID}`, gw)).toBe(`${gw}/ipfs/${CID}`);
    expect(resolveImage(`ipfs://${CID}`, "https://evil.example")).toBe(`https://ipfs.io/ipfs/${CID}`);
  });
  it("ar://, data:image (cả SVG, chỉ hiện bằng <img>) được; HTML, javascript:, http, host lạ bị chặn", () => {
    expect(resolveImage("ar://" + "a".repeat(43))).toBe("https://arweave.net/" + "a".repeat(43));
    expect(resolveImage("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
    expect(resolveImage("data:image/svg+xml;utf8,<svg/>")).toBe("data:image/svg+xml;utf8,<svg/>");
    for (const bad of ["data:text/html,<script>alert(1)</script>", "javascript:alert(1)", "http://ipfs.io/x.png", "https://evil.example/x.png", "ipfs://not-a-cid", "", undefined])
      expect(resolveImage(bad as never, gw)).toBeUndefined();
  });
  it("CSP của extension (img-src) khớp đúng danh sách host ảnh; bản web cũng vậy", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const candidates = [path.resolve(process.cwd(), "../extension/public/manifest.json"), path.resolve(process.env.REPO_ROOT ?? ".", "packages/extension/public/manifest.json")];
    const ext = candidates.find((f) => fs.existsSync(f));
    expect(ext, "manifest.json not found").toBeTruthy();
    const csp: string = JSON.parse(fs.readFileSync(ext!, "utf8")).content_security_policy.extension_pages;
    const img = /img-src ([^;]+)/.exec(csp)![1]!.trim().split(/\s+/);
    expect(img.sort()).toEqual(["'self'", "data:", ...IMAGE_HOSTS].sort());
    const web = fs.readFileSync(path.join(path.dirname(ext!), "../web.html"), "utf8");
    expect(/img-src ([^;"]+)/.exec(web)![1]!.trim().split(/\s+/).sort()).toEqual(img.sort());
    expect(IPFS_GATEWAYS.length).toBeGreaterThan(1);
  });
});

describe("AI-24 AC-001: nguồn dữ liệu + cache", () => {
  it("Koios asset_info: CIP-25 từ minting_tx_metadata; CIP-68 hỏi kèm token tham chiếu (100)", async () => {
    const user = P + CIP68_NFT_LABEL + hex("d");
    const ref = P + CIP68_REF_LABEL + hex("d");
    const old = P + hex("Bunny1");
    let body: any;
    const f = (async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return j([
        { policy_id: P, asset_name: hex("Bunny1"), minting_tx_metadata: { "721": { [P]: { Bunny1: { name: "B" } } } } },
        { policy_id: P, asset_name: CIP68_NFT_LABEL + hex("d"), minting_tx_metadata: null, cip68_metadata: null },
        { policy_id: P, asset_name: CIP68_REF_LABEL + hex("d"), cip68_metadata: { "100": { fields: [{ map: [{ k: { bytes: hex("name") }, v: { bytes: hex("D") } }] }, { int: 1 }] } } },
      ]);
    }) as never;
    const r = await new KoiosClient("preprod", f, "https://k/api/v1").getNftMetadata([old, user]);
    expect(body._asset_list).toEqual([[P, hex("Bunny1")], [P, CIP68_NFT_LABEL + hex("d")], [P, ref.slice(56)]]);
    expect(r).toEqual({ [old]: { cip25: { name: "B" } }, [user]: { cip68: { name: "D" } } });
  });
  it("Blockfrost /assets/{unit}: onchain_metadata theo chuẩn", async () => {
    const f = (async (u: string) => (u.endsWith("01") ? j({ onchain_metadata: { name: "A" }, onchain_metadata_standard: "CIP25v1" }) : u.endsWith("02") ? j({ onchain_metadata: { name: "B" }, onchain_metadata_standard: "CIP68v1" }) : j({}, 404))) as never;
    const r = await new BlockfrostClient("https://p/api/v0", async () => ({}) as never, f).getNftMetadata([P + "01", P + "02", P + "03"]);
    expect(r).toEqual({ [P + "01"]: { cip25: { name: "A" } }, [P + "02"]: { cip68: { name: "B" } } });
  });
  it("cache: lần 2 không gọi mạng; hết hạn hoặc refresh thì tải lại", async () => {
    let calls = 0;
    const src: NftMetadataSource = { getNftMetadata: async (us) => (calls++, Object.fromEntries(us.map((u) => [u, { cip25: { name: u.slice(-2) } }]))) };
    let now = 1_000;
    const store = new MemoryStore();
    const cache = new NftCache(store, () => now);
    expect((await loadNfts(src, cache, [P + "01", P + "02"])).map((n) => n.name)).toEqual(["01", "02"]);
    await loadNfts(src, new NftCache(store, () => now), [P + "01", P + "02"]); // persisted
    expect(calls).toBe(1);
    await loadNfts(src, cache, [P + "01"], true);
    expect(calls).toBe(2);
    now += NFT_CACHE_TTL_MS + 1;
    await loadNfts(src, cache, [P + "02"]);
    expect(calls).toBe(3);
  });
  it("WalletManager.listNfts + gateway chỉ nhận trong danh sách", async () => {
    const providers: ProviderFactory = () => ({ fetcher: {} as never, submitter: {} as never, chain: {
      getBalance: async () => [{ unit: "lovelace", quantity: "5000000" }, { unit: P + hex("Art"), quantity: "1" }, { unit: P + "ff", quantity: "100" }],
      getNftMetadata: async () => ({ [P + hex("Art")]: { cip25: { name: "Art", image: `ipfs://${CID}` } } }),
    } as never });
    const m = new WalletManager(new MemoryStore(), providers);
    await m.setupPassword("correct-horse");
    await m.addWallet("A", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    expect((await m.listNfts()).map((n) => [n.name, n.image])).toEqual([["Art", `ipfs://${CID}`]]);
    expect(m.ipfsGateway).toBe("https://ipfs.io");
    await m.setIpfsGateway("https://dweb.link");
    expect(m.ipfsGateway).toBe("https://dweb.link");
    await expect(m.setIpfsGateway("https://evil.example")).rejects.toThrow(/không nằm trong danh sách/);
  });
});
