import type { Metadata } from "next";
import Image from "next/image";
import { unsubscribeInfo } from "@/modules/marketing/agents";
import { ActionButton } from "@/ui/components/form";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/** Recipients are not users: the page speaks the letter's language (ADR 0032). */
const TEXT = {
  fi: { title: "Peru yhteydenotot", body: (c: string) => `Haluatko, ettei ${c} ota sinuun enää yhteyttä markkinointitarkoituksessa?`, button: "Peru yhteydenotot", done: (c: string) => `Valmis. ${c} ei ota sinuun enää yhteyttä.`, invalid: "Linkki ei ole voimassa." },
  sv: { title: "Avregistrera", body: (c: string) => `Vill du att ${c} inte kontaktar dig igen i marknadsföringssyfte?`, button: "Avregistrera", done: (c: string) => `Klart. ${c} kontaktar dig inte igen.`, invalid: "Länken är inte giltig." },
  en: { title: "Unsubscribe", body: (c: string) => `Do you want ${c} to stop contacting you for marketing?`, button: "Unsubscribe", done: (c: string) => `Done. ${c} will not contact you again.`, invalid: "This link is not valid." },
} as const;

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await unsubscribeInfo(token);
  const t = TEXT[(info.language in TEXT ? info.language : "en") as keyof typeof TEXT];
  const company = info.companyName ?? "";
  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm" data-testid="unsubscribe">
        <Image src="/brand/sk-infra-logo-dark.svg" alt="SK Infra" width={207} height={48} priority unoptimized className="h-10 w-auto" />
        <h1 className="mt-4 text-2xl font-semibold">{t.title}</h1>
        {!info.ok ? (
          <p className="mt-2 text-sm">{t.invalid}</p>
        ) : info.done ? (
          <p className="mt-2 text-sm" role="status">
            {t.done(company)}
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm">{t.body(company)}</p>
            <div className="mt-4">
              <ActionButton action={unsubscribeAction.bind(null, token)} variant="default">
                {t.button}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
