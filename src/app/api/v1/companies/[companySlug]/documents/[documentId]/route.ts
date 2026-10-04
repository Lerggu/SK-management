import { documentService } from "@/modules/documents/service";
import { json, withCompany } from "../../../../_lib/handler";

type P = { companySlug: string; documentId: string };

export const GET = withCompany<P>(async (ctx, _r, p) => {
  const doc = await documentService.get(ctx, p.documentId);
  // Storage keys are internal; downloads go through the authorized route.
  return json({ data: { ...doc, versions: doc.versions.map(({ storageKey: _key, ...v }) => v) } });
});
