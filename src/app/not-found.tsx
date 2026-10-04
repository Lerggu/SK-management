import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("notFound")}</p>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">
        {t("backHome")}
      </Link>
    </main>
  );
}
