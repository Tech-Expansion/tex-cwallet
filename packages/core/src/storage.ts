/** Trừu tượng hóa lưu trữ: chrome.storage.local trong extension, Map trong test. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string) {
    const v = this.m.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set<T>(key: string, value: T) {
    this.m.set(key, structuredClone(value));
  }
  async remove(key: string) {
    this.m.delete(key);
  }
}
