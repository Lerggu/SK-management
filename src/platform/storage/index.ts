import { env } from "@/platform/config/env";
import { S3ObjectStorage } from "./s3";
import type { ObjectStorage } from "./types";

export type { ObjectStorage, StoredObject } from "./types";
export { MemoryObjectStorage } from "./memory";

let instance: ObjectStorage | undefined;

/** Storage used by the application (S3/MinIO). Tests may override it. */
export function getStorage(): ObjectStorage {
  if (!instance) {
    const e = env();
    instance = new S3ObjectStorage({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    });
  }
  return instance;
}

export function setStorageForTests(storage: ObjectStorage): void {
  instance = storage;
}
