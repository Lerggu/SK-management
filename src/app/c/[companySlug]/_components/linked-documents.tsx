import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { RequestContext } from "@/platform/authz";
import { documentService } from "@/modules/documents/service";
import { EmptyState, Section } from "@/ui/components/page";

/** Documents linked to an employee or equipment (visible ones only). */
export async function LinkedDocuments({ ctx, entityType, entityId, title }: { ctx: RequestContext; entityType: "EMPLOYEE" | "EQUIPMENT"; entityId: string; title: string }) {
  const [docs, td] = await Promise.all([documentService.listLinkedTo(ctx, { entityType, entityId }), getTranslations("documents")]);
  return (
    <Section title={title}>
      {docs.length === 0 ? (
        <EmptyState>{td("noDocuments")}</EmptyState>
      ) : (
        <ul className="divide-y">
          {docs.map((d) => (
            <li key={d.linkId}>
              <Link href={`/c/${ctx.company.slug}/documents/${d.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2 text-sm hover:underline">
                <span className="font-medium">{d.title}</span>
                <span className="text-muted-foreground">{td(`categories.${d.category}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
