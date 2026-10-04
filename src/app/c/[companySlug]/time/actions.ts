"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { timesheetService } from "@/modules/timesheets/service";
import { formObject, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";
import { parseLocation } from "@/app/_lib/locations";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function entryFields(formData: FormData) {
  const f = formObject(formData);
  const { projectId, siteId } = parseLocation(f.location);
  return {
    projectId: projectId ?? "",
    siteId,
    workDate: str(f.workDate) ?? "",
    hours: str(f.hours),
    startTime: str(f.startTime),
    endTime: str(f.endTime),
    workClass: (str(f.workClass) ?? "NORMAL") as "NORMAL",
    note: str(f.note),
  };
}

export async function createEntryAction(slug: string, employeeId: string | null, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => timesheetService.create(ctx, { ...entryFields(formData), employeeId }).then(() => undefined));
  revalidatePath(`/c/${slug}/time`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createCrewAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () =>
    timesheetService.createCrew(ctx, { ...entryFields(formData), employeeIds: formData.getAll("employeeIds").map(String) }).then(() => undefined),
  );
  revalidatePath(`/c/${slug}/time`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function archiveEntryAction(slug: string, entryId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => timesheetService.archive(ctx, entryId).then(() => undefined));
  revalidatePath(`/c/${slug}/time`);
  return r;
}

export async function submitWeekAction(slug: string, employeeId: string | null, date: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => timesheetService.submitWeek(ctx, { employeeId, date }).then(() => undefined));
  revalidatePath(`/c/${slug}/time`);
  return r;
}

export async function correctionAction(slug: string, entryId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const f = formObject(formData);
  const r = await runAction(formData, () => timesheetService.createCorrection(ctx, entryId, { hours: str(f.hours) ?? "", note: str(f.note) ?? "" }).then(() => undefined));
  revalidatePath(`/c/${slug}/time`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function decideAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const decision = formData.get("decision") === "REJECT" ? "REJECT" : "APPROVE";
  const r = await runAction(formData, () =>
    timesheetService
      .decide(ctx, { entryIds: formData.getAll("entryIds").map(String), decision, reason: str(formData.get("reason")) ?? null })
      .then(() => undefined),
  );
  revalidatePath(`/c/${slug}/time/approvals`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function exportAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let batchId = "";
  const r = await runAction(formData, async () => {
    batchId = (await timesheetService.exportApproved(ctx, { from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? "") })).batchId;
  });
  if (r.ok) redirect(`/c/${slug}/time/export?batch=${batchId}`);
  return r;
}
