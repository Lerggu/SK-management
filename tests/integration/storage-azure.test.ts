/**
 * Azure Blob storage adapter (production on Azure, ADR 0024) against Azurite,
 * the official local emulator (docker-compose service `azurite`, also in CI).
 */
import { describe, expect, it } from "vitest";
import { AzureBlobObjectStorage } from "@/platform/storage";
import { uniq } from "../helpers/fixtures";

const connectionString = process.env.AZURE_STORAGE_TEST_CONNECTION_STRING ?? "UseDevelopmentStorage=true";

describe("Azure Blob storage adapter", () => {
  const storage = new AzureBlobObjectStorage({ container: "sk-test", connectionString });

  it("stores, reads and checks objects, creating the container on first use", async () => {
    const key = `documents/${uniq("k")}/a.pdf`;
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
    const body = new TextEncoder().encode("PDF content");
    await storage.put(key, body, "application/pdf");
    expect(await storage.exists(key)).toBe(true);
    const got = await storage.get(key);
    expect(got).toMatchObject({ contentType: "application/pdf", size: body.byteLength });
    expect(new TextDecoder().decode(got!.body)).toBe("PDF content");
  });

  it("never overwrites an existing object", async () => {
    const key = `documents/${uniq("k")}/b.txt`;
    await storage.put(key, new TextEncoder().encode("first"), "text/plain");
    await expect(storage.put(key, new TextEncoder().encode("second"), "text/plain")).rejects.toThrow();
    expect(new TextDecoder().decode((await storage.get(key))!.body)).toBe("first");
  });

  it("requires a URL or a connection string", () => {
    expect(() => new AzureBlobObjectStorage({ container: "x" })).toThrow(/AZURE_STORAGE/);
  });
});
