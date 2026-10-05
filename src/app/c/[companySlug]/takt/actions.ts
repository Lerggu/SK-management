"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { taktStructureService } from "@/modules/takt/structure.service";
import { taktPlanService } from "@/modules/takt/plan.service";
import { taktActivityService } from "@/modules/takt/activity.service";
import { scheduleImportService } from "@/modules/takt/import.service";
import { workCalendarService } from "@/modules/takt/calendar.service";
import type { AreaInput, AssignmentInput, BlockInput, BuildingInput, ConstraintInput, DependencyInput, ImportOptionsInput, PlanInput, ProgressInput, TrainInput, WorkPackageInput } from "@/modules/takt/schemas";
import { todayInDisplayZone } from "@/platform/i18n/config";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const taktRoot = (slug: string) => `/c/${slug}/takt`;
const projectTakt = (slug: string, projectId: string) => `/c/${slug}/projects/${projectId}/takt`;

function refresh(slug: string, projectId?: string) {
  revalidatePath(taktRoot(slug), "layout");
  if (projectId) revalidatePath(projectTakt(slug, projectId));
}

const done = (r: ActionState): ActionState => (r.ok ? { ok: true, message: r.message } : r);

// ── structure (project takt page) ─────────────────────────────────────
export async function createBuildingAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktStructureService.createBuilding(ctx, formInput<BuildingInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function archiveBuildingAction(slug: string, projectId: string, buildingId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktStructureService.archiveBuilding(ctx, buildingId).then(() => undefined));
  refresh(slug, projectId);
  return r;
}

export async function createAreaAction(slug: string, projectId: string, buildingId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktStructureService.createArea(ctx, { ...formInput<AreaInput>(formData), buildingId }).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function archiveAreaAction(slug: string, projectId: string, areaId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktStructureService.archiveArea(ctx, areaId).then(() => undefined));
  refresh(slug, projectId);
  return r;
}

export async function createWorkPackageAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktStructureService.createWorkPackage(ctx, projectId, formInput<WorkPackageInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function updateWorkPackageAction(slug: string, projectId: string, workPackageId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktStructureService.updateWorkPackage(ctx, workPackageId, formInput<WorkPackageInput>(formData)).then(() => undefined));
  refresh(slug, projectId);
  return done(r);
}

export async function archiveWorkPackageAction(slug: string, projectId: string, workPackageId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktStructureService.archiveWorkPackage(ctx, workPackageId).then(() => undefined));
  refresh(slug, projectId);
  return r;
}

export async function createPlanAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let planId: string | null = null;
  const r = await runAction(formData, async () => {
    planId = (await taktPlanService.create(ctx, formInput<PlanInput>(formData))).id;
  });
  refresh(slug, projectId);
  if (r.ok && planId) redirect(`${taktRoot(slug)}/${planId}`);
  return r;
}

// ── versions (board) ─────────────────────────────────────────────────
export async function createDraftAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktPlanService.createDraft(ctx, planId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function updateDraftAction(slug: string, versionId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktPlanService.updateDraft(ctx, versionId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function discardDraftAction(slug: string, versionId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktPlanService.discardDraft(ctx, versionId));
  refresh(slug);
  return r;
}

export async function proposeAction(slug: string, versionId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktPlanService.propose(ctx, versionId).then(() => undefined));
  refresh(slug);
  return r;
}

export async function returnToDraftAction(slug: string, versionId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktPlanService.returnToDraft(ctx, versionId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function approveAction(slug: string, versionId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktPlanService.approve(ctx, versionId).then(() => undefined));
  refresh(slug);
  return r;
}

export async function generateTrainAction(slug: string, versionId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktPlanService.generateTrain(ctx, versionId, formInput<TrainInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function shiftWorkPackageAction(slug: string, versionId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const workPackageId = String(formData.get("workPackageId") ?? "");
  const r = await runAction(formData, () => taktPlanService.shiftWorkPackage(ctx, versionId, workPackageId, { days: String(formData.get("days") ?? "") }).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function setAssignmentAction(slug: string, versionId: string, activityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktPlanService.setAssignment(ctx, versionId, activityId, formInput<AssignmentInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function removeAssignmentAction(slug: string, versionId: string, activityId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktPlanService.removeAssignment(ctx, versionId, activityId));
  refresh(slug);
  return r;
}

// ── activities ───────────────────────────────────────────────────────
export async function createActivityAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktActivityService.create(ctx, planId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function updateActivityAction(slug: string, activityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktActivityService.update(ctx, activityId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function archiveActivityAction(slug: string, planId: string, activityId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktActivityService.archive(ctx, activityId).then(() => undefined));
  refresh(slug);
  if (r.ok) redirect(`${taktRoot(slug)}/${planId}`);
  return r;
}

export async function recordProgressAction(slug: string, activityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const input = formInput<ProgressInput>(formData);
  const r = await runAction(formData, () => taktActivityService.recordProgress(ctx, activityId, { ...input, reportDate: input.reportDate || todayInDisplayZone() }).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function setBlockedAction(slug: string, activityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktActivityService.setBlocked(ctx, activityId, formInput<BlockInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function addConstraintAction(slug: string, activityId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktActivityService.addConstraint(ctx, activityId, formInput<ConstraintInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function clearConstraintAction(slug: string, constraintId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktActivityService.clearConstraint(ctx, constraintId).then(() => undefined));
  refresh(slug);
  return r;
}

export async function addDependencyAction(slug: string, successorId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => taktActivityService.addDependency(ctx, { ...formInput<DependencyInput>(formData), successorId }).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function removeDependencyAction(slug: string, dependencyId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => taktActivityService.removeDependency(ctx, dependencyId));
  refresh(slug);
  return r;
}

// ── schedule import ──────────────────────────────────────────────────
export async function previewImportAction(slug: string, planId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let importId: string | null = null;
  const r = await runAction(formData, async () => {
    const file = await readFile(formData);
    importId = (await scheduleImportService.preview(ctx, planId, formInput<ImportOptionsInput>(formData), file ?? { fileName: "", bytes: new Uint8Array() })).id;
  });
  if (r.ok && importId) redirect(`${taktRoot(slug)}/${planId}/import/${importId}`);
  return r;
}

export async function applyImportAction(slug: string, planId: string, importId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => scheduleImportService.apply(ctx, importId).then(() => undefined));
  refresh(slug);
  if (r.ok) redirect(`${taktRoot(slug)}/${planId}`);
  return r;
}

export async function discardImportAction(slug: string, planId: string, importId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => scheduleImportService.discard(ctx, importId));
  refresh(slug);
  if (r.ok) redirect(`${taktRoot(slug)}/${planId}/import`);
  return r;
}

// ── work calendar (settings) ─────────────────────────────────────────
const calendarPath = (slug: string) => `/c/${slug}/settings/calendar`;

export async function updateWeekdaysAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => workCalendarService.updateWeekdays(ctx, { workingWeekdays: formData.getAll("workingWeekdays").map(String) }).then(() => undefined));
  revalidatePath(calendarPath(slug));
  return r;
}

export async function addHolidayAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => workCalendarService.addHoliday(ctx, formInput(formData)));
  revalidatePath(calendarPath(slug));
  return done(r);
}

export async function removeHolidayAction(slug: string, holidayId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => workCalendarService.removeHoliday(ctx, holidayId));
  revalidatePath(calendarPath(slug));
  return r;
}

export async function addFinnishHolidaysAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => workCalendarService.addFinnishHolidays(ctx, formInput(formData)).then(() => undefined));
  revalidatePath(calendarPath(slug));
  return done(r);
}
