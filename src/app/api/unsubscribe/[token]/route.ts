import { unsubscribeByToken } from "@/modules/marketing/agents";

/**
 * RFC 8058 one-click unsubscribe (List-Unsubscribe-Post): mail clients POST
 * here. A GET only shows the page, so link scanners never unsubscribe anyone.
 */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await unsubscribeByToken(token);
  return new Response(null, { status: r.ok ? 200 : 404 });
}
