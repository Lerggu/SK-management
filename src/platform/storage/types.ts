/**
 * Object storage port. Domain modules depend on this interface only; the S3
 * adapter (MinIO locally) and the in-memory adapter (unit tests) implement it.
 * A SharePoint/OneDrive adapter can be added later behind the same interface.
 */
export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface ObjectStorage {
  /** Writes an object. Keys are never reused for different content. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
}
