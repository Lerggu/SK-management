import { checkHealth } from "@/modules/system/health";

export const dynamic = "force-dynamic";

/** GET /api/health — used by the App Service health check. No data, no auth. */
export async function GET() {
  const h = await checkHealth();
  return Response.json({ status: h.ok ? "ok" : "unavailable", database: h.database }, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
