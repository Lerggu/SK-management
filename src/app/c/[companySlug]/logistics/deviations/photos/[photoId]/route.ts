import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { deviationService } from "@/modules/production/deviation.service";
import { requireCompanyContext } from "@/app/_lib/context";

/** Authorized deviation photo; images only (checked on upload), shown inline and sandboxed. */
export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; photoId: string }> }) {
  const { companySlug, photoId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await deviationService.photo(ctx, photoId);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
