import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { documentService } from "@/modules/documents/service";
import { requireCompanyContext } from "@/app/_lib/context";

/**
 * Authorized file download. Always served as an attachment with nosniff so
 * uploaded content is never rendered inline in the application origin.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ companySlug: string; versionId: string }> }) {
  const { companySlug, versionId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await documentService.downloadVersion(ctx, versionId);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Digest": `sha-256=${Buffer.from(file.sha256, "hex").toString("base64")}`,
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
