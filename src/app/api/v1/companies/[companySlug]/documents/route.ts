import { documentService } from "@/modules/documents/service";
import { json, withCompany } from "../../../_lib/handler";

/** Document creation (multipart upload) is done through the UI in V1. */
export const GET = withCompany(async (ctx, request) => {
  const url = new URL(request.url);
  return json({ data: await documentService.list(ctx, { q: url.searchParams.get("q"), projectId: url.searchParams.get("projectId"), category: url.searchParams.get("category") ?? undefined }) });
});
