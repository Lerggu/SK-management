import { describe, expect, it } from "vitest";
import { approvalTransitionPermission, nextVersionNumber, resolveContentType, sanitizeFileName, sha256Hex, storageKey } from "./versioning";

describe("document versioning rules", () => {
  it("numbers versions sequentially", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ versionNumber: 1 }, { versionNumber: 3 }, { versionNumber: 2 }])).toBe(4);
  });

  it("APPROVED is final", () => {
    for (const to of ["DRAFT", "PENDING_APPROVAL", "REJECTED"] as const) {
      expect(approvalTransitionPermission("APPROVED", to)).toBeNull();
    }
  });

  it("approval needs documents.approve, submission needs documents.manage", () => {
    expect(approvalTransitionPermission("DRAFT", "PENDING_APPROVAL")).toBe("documents.manage");
    expect(approvalTransitionPermission("PENDING_APPROVAL", "APPROVED")).toBe("documents.approve");
    expect(approvalTransitionPermission("PENDING_APPROVAL", "REJECTED")).toBe("documents.approve");
    expect(approvalTransitionPermission("REJECTED", "APPROVED")).toBeNull();
    expect(approvalTransitionPermission("DRAFT", "DRAFT")).toBeNull();
  });

  it("computes SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("refuses active content and unknown types", () => {
    expect(resolveContentType("plan.PDF")).toBe("application/pdf");
    expect(resolveContentType("drawing.dwg")).toBe("application/acad");
    expect(resolveContentType("evil.html")).toBeNull();
    expect(resolveContentType("image.svg")).toBeNull();
    expect(resolveContentType("noext")).toBeNull();
  });

  it("sanitizes file names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('C:\\temp\\a"b<c>.pdf')).toBe("a_b_c_.pdf");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("builds company-scoped storage keys", () => {
    expect(storageKey("c1", "d1", "v1")).toBe("companies/c1/documents/d1/versions/v1");
  });
});
