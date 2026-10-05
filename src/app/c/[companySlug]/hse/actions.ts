"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hseActionService, hseObservationService, hsePhotoService, incidentService } from "@/modules/hse/hse.service";
import { hseInspectionService, riskAssessmentService, toolboxTalkService, workPermitService } from "@/modules/hse/planning.service";
import type {
  ActionInput,
  CloseInput,
  IncidentInput,
  IncidentPersonInput,
  IncidentTriageInput,
  InspectionInput,
  InvestigationInput,
  ObservationInput,
  ObservationTriageInput,
  PermitDecisionInput,
  PermitInput,
  RiskAssessmentInput,
  RiskAssessmentUpdateInput,
  RiskItemInput,
  ToolboxTalkInput,
} from "@/modules/hse/schemas";
import { ValidationError } from "@/platform/errors";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const refresh = (slug: string) => {
  revalidatePath(`/c/${slug}/hse`, "layout");
  revalidatePath(`/c/${slug}/portal`, "layout");
};

/** Where to land after a report: the portal for external reporters, else the record. */
function after(slug: string, external: boolean, projectId: string, path: string) {
  return external ? `/c/${slug}/portal/${projectId}?reported=1` : `/c/${slug}/hse/${path}`;
}

async function attachPhoto(ctx: Awaited<ReturnType<typeof requireCompanyContext>>, recordType: "OBSERVATION" | "INCIDENT", recordId: string, formData: FormData) {
  const file = await readFile(formData, "photo");
  if (!file) return true;
  try {
    await hsePhotoService.add(ctx, { recordType, recordId }, file);
    return true;
  } catch {
    return false;
  }
}

/** Report an observation / near miss, with an optional photo (one step on the phone). */
export async function reportObservationAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let target: string | null = null;
  const r = await runAction(formData, async () => {
    const o = await hseObservationService.create(ctx, formInput<ObservationInput>(formData));
    target = after(slug, ctx.external, o.projectId, `observations/${o.id}`);
    // The report is saved even if the photo is rejected; the reporter is told and can retry.
    if (!(await attachPhoto(ctx, "OBSERVATION", o.id, formData))) target += target.includes("?") ? "&photoError=1" : "?photoError=1";
  });
  refresh(slug);
  if (r.ok && target) redirect(target);
  return r;
}

export async function reportIncidentAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let target: string | null = null;
  const r = await runAction(formData, async () => {
    const i = await incidentService.report(ctx, formInput<IncidentInput>(formData));
    target = after(slug, ctx.external, i.projectId, `incidents/${i.id}`);
    // The report is saved even if the photo is rejected; the reporter is told and can retry.
    if (!(await attachPhoto(ctx, "INCIDENT", i.id, formData))) target += target.includes("?") ? "&photoError=1" : "?photoError=1";
  });
  refresh(slug);
  if (r.ok && target) redirect(target);
  return r;
}

export async function requestPermitAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let target: string | null = null;
  const r = await runAction(formData, async () => {
    const p = await workPermitService.request(ctx, formInput<PermitInput>(formData));
    target = after(slug, ctx.external, p.projectId, `permits/${p.id}`);
  });
  refresh(slug);
  if (r.ok && target) redirect(target);
  return r;
}

export async function addPhotoAction(slug: string, recordType: "OBSERVATION" | "INCIDENT" | "INSPECTION" | "RISK_ASSESSMENT", recordId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, async () => {
    const file = await readFile(formData, "photo");
    if (!file) throw new ValidationError({ photo: ["validation.imageOnly"] });
    await hsePhotoService.add(ctx, { recordType, recordId }, file);
  });
  refresh(slug);
  return r;
}

export async function triageObservationAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => hseObservationService.triage(ctx, id, formInput<ObservationTriageInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function closeObservationAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => hseObservationService.close(ctx, id, formInput<CloseInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function triageIncidentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => incidentService.triage(ctx, id, formInput<IncidentTriageInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function startInvestigationAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => incidentService.startInvestigation(ctx, id).then(() => undefined));
  refresh(slug);
  return r;
}

export async function recordInvestigationAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => incidentService.recordInvestigation(ctx, id, formInput<InvestigationInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function closeIncidentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => incidentService.close(ctx, id, formInput<CloseInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addPersonAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => incidentService.addPerson(ctx, id, formInput<IncidentPersonInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createHseActionAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => hseActionService.create(ctx, formInput<ActionInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function hseActionStepAction(slug: string, id: string, step: "done" | "reopen" | "verify", _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const note = { note: String(formData.get("note") ?? "") };
  const r = await runAction(null, async () => {
    if (step === "done") await hseActionService.markDone(ctx, id, note);
    else if (step === "reopen") await hseActionService.reopen(ctx, id, note);
    else await hseActionService.verify(ctx, id);
  });
  refresh(slug);
  return r;
}

export async function createToolboxTalkAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => toolboxTalkService.create(ctx, formInput<ToolboxTalkInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createInspectionAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await hseInspectionService.create(ctx, formInput<InspectionInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`/c/${slug}/hse/inspections/${id}`);
  return r;
}

export async function createRiskAssessmentAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await riskAssessmentService.create(ctx, formInput<RiskAssessmentInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`/c/${slug}/hse/risks/${id}`);
  return r;
}

export async function updateRiskAssessmentAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => riskAssessmentService.update(ctx, id, formInput<RiskAssessmentUpdateInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addRiskItemAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => riskAssessmentService.addItem(ctx, id, formInput<RiskItemInput>(formData)).then(() => undefined));
  refresh(slug);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function riskStepAction(slug: string, id: string, step: "approve" | "archive" | "removeItem", _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, async () => {
    if (step === "approve") await riskAssessmentService.approve(ctx, id);
    else if (step === "archive") await riskAssessmentService.archive(ctx, id);
    else await riskAssessmentService.removeItem(ctx, String(formData.get("itemId") ?? ""));
  });
  refresh(slug);
  return r;
}

export async function decidePermitAction(slug: string, id: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => workPermitService.decide(ctx, id, formInput<PermitDecisionInput>(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function closePermitAction(slug: string, id: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => workPermitService.close(ctx, id).then(() => undefined));
  refresh(slug);
  return r;
}
