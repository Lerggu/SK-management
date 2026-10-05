import { getFormatter, getTranslations } from "next-intl/server";
import { ActionButton, ActionForm, TextField } from "@/ui/components/form";
import { StatusBadge } from "@/ui/components/status-badge";
import { cancelBookingAction, decideBookingAction } from "../actions";

interface BookingView {
  id: string;
  status: string;
  resourceLabel: string;
  resourceDetail: string | null;
  startsAt: Date;
  endsAt: Date;
  note: string | null;
  decisionNote: string | null;
  conflictsAccepted: boolean;
  project: { code: string; name: string };
  activity: { name: string; taktArea: { code: string } } | null;
  company: { name: string };
  ownerCompany: { id: string; name: string };
  crossCompany: boolean;
  incoming: boolean;
  conflicts: { code: string }[];
  permissions: { decide: boolean; cancel: boolean };
}

/** One booking with its conflicts and the decide / cancel controls. */
export async function BookingRow({ slug, b }: { slug: string; b: BookingView }) {
  const [t, format] = await Promise.all([getTranslations("logistics"), getFormatter()]);
  const dt = (d: Date) => format.dateTime(d, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="rounded-lg border p-3 text-sm" data-booking={b.id} data-status={b.status}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={b.status === "REQUESTED" ? "PENDING_APPROVAL" : b.status} label={t(`bookingStatuses.${b.status}`)} />
        <span className="font-medium">{b.resourceLabel}</span>
        {b.resourceDetail && <span className="text-muted-foreground">{b.resourceDetail}</span>}
        <span className="ml-auto tabular-nums text-muted-foreground">
          {dt(b.startsAt)} – {dt(b.endsAt)}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {b.incoming ? `${t("bookedBy")}: ${b.company.name} · ` : ""}
        {b.project.code} · {b.project.name}
        {b.activity ? ` · ${b.activity.taktArea.code} ${b.activity.name}` : ""}
        {b.crossCompany && !b.incoming ? ` · ${t("owner")}: ${b.ownerCompany.name}` : ""}
      </p>
      {(b.note || b.decisionNote) && <p className="mt-1">{[b.note, b.decisionNote].filter(Boolean).join(" · ")}</p>}
      {b.conflicts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" data-testid="conflicts">
          {b.conflicts.map((c, i) => (
            <li key={i} className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-900" data-conflict={c.code}>
              {t(`conflictCodes.${c.code}`)}
            </li>
          ))}
          {b.conflictsAccepted && <li className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{t("conflictsAccepted")}</li>}
        </ul>
      )}
      {(b.permissions.decide && b.status === "REQUESTED") || (b.permissions.cancel && (b.status === "REQUESTED" || b.status === "APPROVED")) ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          {b.permissions.decide && b.status === "REQUESTED" && (
            <ActionForm action={decideBookingAction.bind(null, slug, b.id)} className="flex flex-wrap items-end gap-2 space-y-0">
              <TextField name="note" label={t("decisionNote")} className="w-48" />
              {b.conflicts.length > 0 && (
                <label className="flex min-h-11 items-center gap-2 md:min-h-9">
                  <input type="checkbox" name="acceptConflicts" className="size-5 accent-primary md:size-4" />
                  {t("acceptConflicts")}
                </label>
              )}
              <button type="submit" name="decision" value="APPROVE" className="h-11 rounded-lg bg-primary px-4 text-primary-foreground md:h-9">
                {t("approve")}
              </button>
              <button type="submit" name="decision" value="REJECT" className="h-11 rounded-lg border px-4 md:h-9">
                {t("reject")}
              </button>
            </ActionForm>
          )}
          {b.permissions.cancel && (b.status === "REQUESTED" || b.status === "APPROVED") && (
            <ActionButton action={cancelBookingAction.bind(null, slug, b.id)} variant="ghost">
              {t("cancelBooking")}
            </ActionButton>
          )}
        </div>
      ) : null}
    </li>
  );
}

