import { env } from "@/platform/config/env";
import { S3ObjectStorage } from "./s3";
import { AzureBlobObjectStorage } from "./azure-blob";
import type { ObjectStorage } from "./types";

export type { ObjectStorage, StoredObject } from "./types";
export { MemoryObjectStorage } from "./memory";
export { AzureBlobObjectStorage } from "./azure-blob";

let instance: ObjectStorage | undefined;

/** Storage used by the application: S3/MinIO or Azure Blob (STORAGE_PROVIDER). Tests may override it. */
export function getStorage(): ObjectStorage {
  if (!instance) {
    const e = env();
    if (e.STORAGE_PROVIDER === "azure") {
      instance = new AzureBlobObjectStorage({
        container: e.AZURE_STORAGE_CONTAINER,
        accountUrl: e.AZURE_STORAGE_ACCOUNT_URL,
        connectionString: e.AZURE_STORAGE_CONNECTION_STRING,
      });
      return instance;
    }
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
