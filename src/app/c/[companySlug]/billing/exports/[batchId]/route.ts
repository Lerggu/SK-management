import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { invoiceService } from "@/modules/commercial/invoice.service";
import { requireCompanyContext } from "@/app/_lib/context";

/** Download of a stored invoicing export, byte for byte (SHA-256 in a header). */
export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; batchId: string }> }) {
  const { companySlug, batchId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await invoiceService.download(ctx, batchId);
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-SHA256": file.sha256,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
