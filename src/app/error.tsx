"use client";

import { useTranslations } from "next-intl";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted-foreground">{t("generic")}</p>
      <button onClick={reset} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">
        {t("retry")}
      </button>
    </main>
  );
}
