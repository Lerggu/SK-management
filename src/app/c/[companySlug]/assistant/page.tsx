import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { assistantService } from "@/modules/assistant/service";
import { EmptyState, PageHeader } from "@/ui/components/page";
import { requireCompanyContext } from "@/app/_lib/context";
import { orForbidden } from "../workforce/_components/hr/access";
import { assistantConfirmAction, assistantConfirmAllAction, assistantRejectAction, assistantSendAction } from "./actions";
import { AssistantChat } from "./assistant-chat";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("assistant"))("title") };
}

/** Voice/text assistant (ADR 0031). */
export default async function AssistantPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<{ c?: string; new?: string }> }) {
  const { companySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCompanyContext(companySlug);
  const t = await getTranslations("assistant");
  const data = sp.new ? await orForbidden(assistantService.current(ctx, { conversationId: null })).then((d) => d && { ...d, conversationId: null, messages: [], actions: [] }) : await orForbidden(assistantService.current(ctx, { conversationId: sp.c ?? null }).catch(() => assistantService.current(ctx)));
  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState>{t("noAccess")}</EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          data.conversationId ? (
            <Link href={`/c/${companySlug}/assistant?new=1`} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm md:min-h-9">
              {t("newConversation")}
            </Link>
          ) : undefined
        }
      />
      <AssistantChat
        slug={companySlug}
        conversationId={data.conversationId}
        messages={data.messages}
        actions={data.actions}
        available={data.available}
        speech={data.speech}
        send={assistantSendAction.bind(null, companySlug)}
        confirm={assistantConfirmAction.bind(null, companySlug)}
        reject={assistantRejectAction.bind(null, companySlug)}
        confirmAll={assistantConfirmAllAction.bind(null, companySlug)}
      />
    </>
  );
}
