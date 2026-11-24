import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { siteMapService } from "@/modules/production/sitemap.service";
import { requireCompanyContext } from "@/app/_lib/context";

/** The site map image (authorized, private; the map id changes when a new image is uploaded). */
export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; mapId: string }> }) {
  const { companySlug, mapId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const file = await siteMapService.image(ctx, mapId);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        // Each upload is a new id, so the image can be cached privately.
        "Cache-Control": "private, max-age=86400, immutable",
        ETag: `"${file.sha256}"`,
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
