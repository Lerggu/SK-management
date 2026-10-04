import type { ObjectStorage, StoredObject } from "./types";

/** In-process storage for unit/integration tests. */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (this.objects.has(key)) throw new Error(`Object key already exists: ${key}`);
    this.objects.set(key, { body: new Uint8Array(body), contentType, size: body.byteLength });
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
