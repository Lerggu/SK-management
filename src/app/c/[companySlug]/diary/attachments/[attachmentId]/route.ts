import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { diaryService } from "@/modules/diary/service";
import { requireCompanyContext } from "@/app/_lib/context";

/** Authorized diary photo download; images may be shown inline, never HTML. */
export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; attachmentId: string }> }) {
  const { companySlug, attachmentId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await diaryService.downloadAttachment(ctx, attachmentId);
    const inline = file.contentType.startsWith("image/");
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
