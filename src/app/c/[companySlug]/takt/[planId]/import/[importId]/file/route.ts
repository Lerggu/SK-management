import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { scheduleImportService } from "@/modules/takt/import.service";
import { requireCompanyContext } from "@/app/_lib/context";

/** Authorized download of the original schedule file (always as an attachment). */
export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; importId: string }> }) {
  const { companySlug, importId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await scheduleImportService.download(ctx, importId);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
