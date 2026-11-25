"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, CloudRain, HardHat, PackageX, ShieldAlert, TriangleAlert, Wrench } from "lucide-react";
import { cn } from "@/ui/lib/utils";

type State = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null;
const ICONS = { LATE_DELIVERY: PackageX, RESOURCE_MISSING: HardHat, EQUIPMENT_FAULT: Wrench, WEATHER: CloudRain, SAFETY: ShieldAlert, OTHER: TriangleAlert } as const;

/** Phone-first deviation form: big type buttons, camera, short comment. */
export function DeviationReportForm({ action }: { action: (s: State, fd: FormData) => Promise<NonNullable<State>> }) {
  const t = useTranslations("production.deviations");
  const tAll = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  const [type, setType] = useState<keyof typeof ICONS | null>(null);
  return (
    <form action={formAction} className="space-y-4" data-testid="deviation-form">
      {state && (
        <p role={state.ok ? "status" : "alert"} className={cn("rounded-lg px-3 py-2 text-sm", state.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
          {tAll(state.fieldErrors ? (Object.values(state.fieldErrors).flat()[0] ?? state.message ?? "errors.generic") : (state.message ?? "errors.generic"))}
        </p>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t("chooseType")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(ICONS) as (keyof typeof ICONS)[]).map((k) => {
            const Icon = ICONS[k];
            return (
              <label key={k} className={cn("flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center text-sm font-medium", type === k ? "border-red-600 bg-red-50 text-red-900" : "hover:bg-muted")}>
                <input type="radio" name="type" value={k} className="sr-only" checked={type === k} onChange={() => setType(k)} required />
                <Icon className="size-6" aria-hidden />
                {t(`types.${k}`)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="flex min-h-14 min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed px-3 py-2 text-sm">
        <Camera className="size-6 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">{t("photo")}</span>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" className="w-full min-w-0 basis-full text-xs" />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">{t("comment")}</span>
        <textarea name="comment" rows={2} maxLength={1000} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm" />
      </label>
      <button type="submit" disabled={pending || !type} className="h-14 w-full rounded-xl bg-red-600 text-base font-semibold text-white hover:bg-red-700 disabled:opacity-50">
        {t("send")}
      </button>
    </form>
  );
}
