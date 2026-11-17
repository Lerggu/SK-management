import { NextResponse } from "next/server";
import { isAppError, ValidationError } from "@/platform/errors";
import { MAX_WAV_BYTES } from "@/platform/speech";
import { assistantService } from "@/modules/assistant/service";
import { requireCompanyContext } from "@/app/_lib/context";

/**
 * Microphone recording → text (ADR 0031). A raw WAV body (16 kHz mono PCM,
 * ≤ 60 s); same-origin only. The service checks access and the format.
 */
export async function POST(req: Request, { params }: { params: Promise<{ companySlug: string }> }) {
  const { companySlug } = await params;
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "errors.generic" }, { status: 403 });
  const ctx = await requireCompanyContext(companySlug);
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_WAV_BYTES) return NextResponse.json({ error: "assistant.audioFormat" }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  try {
    return NextResponse.json(await assistantService.transcribe(ctx, { bytes }));
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: Object.values(e.fieldErrors).flat()[0] ?? "errors.generic" }, { status: 422 });
    if (isAppError(e) && (e.status === 403 || e.status === 404)) return NextResponse.json({ error: "errors.generic" }, { status: 404 });
    throw e;
  }
}
