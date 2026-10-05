import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/ui/components/button";
import { confirmEmailLinkAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("confirmTitle"), referrer: "no-referrer" };
}

/**
 * Landing page of the e-mail link. The token is consumed only by the POST
 * below, so link scanners that prefetch the URL cannot use it up.
 */
export default async function EmailLinkPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">{t("confirmTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("confirmHint")}</p>
        <form action={confirmEmailLinkAction} className="mt-6">
          <input type="hidden" name="token" value={token ?? ""} />
          <Button type="submit" size="lg" className="w-full" data-testid="confirm-sign-in">
            {t("confirmButton")}
          </Button>
        </form>
      </div>
    </main>
  );
}
