import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { isAppError } from "@/platform/errors";
import { env } from "@/platform/config/env";
import { materialLabelService } from "@/modules/lifting/material.service";
import { requireCompanyContext } from "@/app/_lib/context";

/** QR label sheet (A4 PDF) for drums, material batches or lifting accessories. */
export async function GET(req: Request, { params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const ctx = await requireCompanyContext(companySlug);
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const t = await getTranslations("materials");
  const origin = env().AUTH_URL?.replace(/\/$/, "") || url.origin;
  try {
    const pdf = await materialLabelService.pdf(
      ctx,
      { kind: kind as "drum", siteId: url.searchParams.get("siteId"), ids: url.searchParams.get("ids") ?? "" },
      origin,
      { title: t(`labelTitles.${["drum", "batch", "accessory"].includes(kind) ? kind : "drum"}`), footer: t("labelFooter", { company: ctx.company.name }) },
    );
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="qr-${kind}-labels.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    if (isAppError(e) && e.status === 422) return new NextResponse(t("noLabels"), { status: 400 });
    throw e;
  }
}
