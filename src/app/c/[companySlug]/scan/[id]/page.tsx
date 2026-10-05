import { notFound, redirect } from "next/navigation";
import { isAppError } from "@/platform/errors";
import { scanService } from "@/modules/lifting/material.service";
import { requireCompanyContext } from "@/app/_lib/context";

const HREF = { drum: "materials/drums", batch: "materials/batches", accessory: "lifting/accessories" } as const;

/**
 * Target of the QR code: an opaque id only. Signing in and company
 * membership are required like for any page; unknown or invisible ids are 404.
 */
export default async function ScanTarget({ params }: { params: Promise<{ companySlug: string; id: string }> }) {
  const { companySlug, id } = await params;
  const ctx = await requireCompanyContext(companySlug);
  let hit: Awaited<ReturnType<typeof scanService.resolve>>;
  try {
    hit = await scanService.resolve(ctx, { code: id });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403 || e.status === 422)) notFound();
    throw e;
  }
  redirect(`/c/${companySlug}/${HREF[hit.kind]}/${hit.id}`);
}
