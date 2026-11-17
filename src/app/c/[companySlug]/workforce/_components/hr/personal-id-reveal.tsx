"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";

/** Shows the masked code; the full code is fetched on request (audited) and hidden again. */
export function PersonalIdReveal({ masked, reveal }: { masked: string | null; reveal: () => Promise<{ ok: boolean; personalId?: string; message?: string }> }) {
  const t = useTranslations("workforce.pid");
  const tAll = useTranslations();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-base tracking-wider" data-testid="pid-value">
        {value ?? masked ?? t("unreadable")}
      </span>
      {value ? (
        <button type="button" onClick={() => setValue(null)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm md:min-h-9">
          <EyeOff className="size-4" aria-hidden /> {t("hide")}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reveal();
              if (r.ok && r.personalId) {
                setValue(r.personalId);
                setError(null);
              } else setError(tAll(r.message ?? "errors.generic"));
            })
          }
          className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm md:min-h-9"
        >
          <Eye className="size-4" aria-hidden /> {t("show")}
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
