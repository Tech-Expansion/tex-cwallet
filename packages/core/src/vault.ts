// Mã hóa dữ liệu nhạy cảm (mnemonic) bằng mật khẩu: PBKDF2-SHA256 + AES-GCM (WebCrypto).
const ITERATIONS = 600_000;

export interface EncryptedBlob {
  v: 1;
  salt: string;
  iv: string;
  data: string;
  iterations: number;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plain: string, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plain)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct), iterations: ITERATIONS };
}

export async function decrypt(blob: EncryptedBlob, password: string): Promise<string> {
  const key = await deriveKey(password, unb64(blob.salt), blob.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.data) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Sai mật khẩu hoặc dữ liệu bị hỏng");
  }
}
