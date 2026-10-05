import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, RestError, type ContainerClient } from "@azure/storage-blob";
import type { ObjectStorage, StoredObject } from "./types";

export interface AzureBlobStorageConfig {
  container: string;
  /** Production: https://<account>.blob.core.windows.net with managed identity. */
  accountUrl?: string;
  /** Development/tests (Azurite): a connection string; the container is created on first use. */
  connectionString?: string;
}

const isStatus = (e: unknown, status: number) => e instanceof RestError && e.statusCode === status;

/**
 * Azure Blob Storage adapter (production on Azure, ADR 0024). In Azure the
 * App Service's managed identity authenticates (no keys in configuration);
 * locally and in CI it runs against Azurite with a connection string.
 */
export class AzureBlobObjectStorage implements ObjectStorage {
  private readonly container: ContainerClient;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: AzureBlobStorageConfig) {
    let service: BlobServiceClient;
    if (config.connectionString) service = BlobServiceClient.fromConnectionString(config.connectionString);
    else if (config.accountUrl) service = new BlobServiceClient(config.accountUrl, new DefaultAzureCredential());
    else throw new Error("Azure Blob storage needs AZURE_STORAGE_ACCOUNT_URL or AZURE_STORAGE_CONNECTION_STRING");
    this.container = service.getContainerClient(config.container);
  }

  /** In production the container is provisioned by infrastructure; Azurite starts empty. */
  private ensureContainer(): Promise<void> {
    if (!this.config.connectionString) return Promise.resolve();
    this.ready ??= this.container
      .createIfNotExists()
      .then(() => undefined)
      .catch((e) => {
        this.ready = null;
        throw e;
      });
    return this.ready;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.ensureContainer();
    // Never overwrite an existing object (document versions are immutable).
    await this.container.getBlockBlobClient(key).uploadData(body, {
      blobHTTPHeaders: { blobContentType: contentType },
      conditions: { ifNoneMatch: "*" },
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    await this.ensureContainer();
    try {
      const blob = this.container.getBlockBlobClient(key);
      const props = await blob.getProperties();
      const body = new Uint8Array(await blob.downloadToBuffer());
      return { body, contentType: props.contentType ?? "application/octet-stream", size: body.byteLength };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureContainer();
    return this.container.getBlockBlobClient(key).exists();
  }
}
