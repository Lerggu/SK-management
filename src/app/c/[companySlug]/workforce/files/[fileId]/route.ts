import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { employeeFileService } from "@/modules/hr/files.service";
import { requireCompanyContext } from "@/app/_lib/context";

/**
 * Authorized personnel-card file (ADR 0025): images and PDF only, content
 * checked on upload (magic bytes), served with nosniff. Preview inline (sandboxed) or download with ?download=1. Files the
 * caller may not see are 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ companySlug: string; fileId: string }> }) {
  const { companySlug, fileId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await employeeFileService.download(ctx, fileId);
    const download = new URL(req.url).searchParams.get("download") === "1";
    const ext = file.fileName.includes(".") ? `.${file.fileName.split(".").pop()}` : "";
    const name = file.displayName.toLowerCase().endsWith(ext.toLowerCase()) ? file.displayName : `${file.displayName}${ext}`;
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        // Images are sandboxed; the browser's PDF viewer does not run in a sandboxed document.
        ...(file.contentType === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
