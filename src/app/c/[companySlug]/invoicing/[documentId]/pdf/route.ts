import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { salesDocumentService } from "@/modules/sales/service";
import { requireCompanyContext } from "@/app/_lib/context";

/**
 * The PDF of an order confirmation or invoice: the stored bytes of an issued
 * document (SHA-256 in a header), or a watermarked preview of a draft.
 * `?download=1` saves it, otherwise it opens in the browser.
 */
export async function GET(req: Request, { params }: { params: Promise<{ companySlug: string; documentId: string }> }) {
  const { companySlug, documentId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await salesDocumentService.pdf(ctx, documentId);
    const disposition = new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        ...(file.sha256 ? { "X-Content-SHA256": file.sha256 } : {}),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    if (isAppError(e) && e.status === 422) return new NextResponse("Billing is not set up", { status: 409 });
    throw e;
  }
}
