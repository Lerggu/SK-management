"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RequestContext } from "@/platform/authz";
import { ValidationError } from "@/platform/errors";
import { competenceAreaService, hrSettingsService, jobProfileService, qualificationTypeService } from "@/modules/hr/settings.service";
import {
  assessmentService,
  authorizationService,
  clothingService,
  companyItemService,
  hrCardService,
  languageService,
  orientationService,
  qualificationService,
  trainingService,
} from "@/modules/hr/card.service";
import { employeeFileService } from "@/modules/hr/files.service";
import { formInput, readFile, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

type Op = (ctx: RequestContext, id: string, formData: FormData) => Promise<unknown>;
const input = <T,>(fd: FormData) => formInput<T>(fd);

async function requiredFile(fd: FormData, name = "file") {
  const file = await readFile(fd, name);
  if (!file) throw new ValidationError({ [name]: ["validation.fileRequired"] });
  return file;
}

/**
 * HR form operations (ADR 0025). The bound operation name only selects a
 * service call; every service checks the caller's access itself.
 */
const OPS = {
  // card
  employment: (c, id, fd) => hrCardService.updateEmployment(c, id, input(fd)),
  personal: (c, id, fd) => hrCardService.updatePersonal(c, id, input(fd)),
  driving: (c, id, fd) => hrCardService.updateDriving(c, id, input(fd)),
  photo: async (c, id, fd) => employeeFileService.uploadPhoto(c, id, await requiredFile(fd)),
  // assessments (id = employee or assessment)
  assessmentCreate: (c, id, fd) => assessmentService.create(c, id, input(fd)),
  assessmentUpdate: (c, id, fd) => assessmentService.update(c, id, input(fd)),
  assessmentPublish: (c, id) => assessmentService.publish(c, id),
  assessmentDiscard: (c, id) => assessmentService.discardDraft(c, id),
  assessmentComment: (c, id, fd) => assessmentService.comment(c, id, input(fd)),
  assessmentActionDone: (c, id) => assessmentService.completeAction(c, id),
  selfAssessment: (c, id, fd) => assessmentService.createSelf(c, id, input(fd)),
  // trainings and qualifications
  trainingAdd: (c, id, fd) => trainingService.add(c, id, input(fd)),
  trainingUpdate: (c, id, fd) => trainingService.update(c, id, input(fd)),
  trainingVerify: (c, id) => trainingService.verify(c, id),
  trainingArchive: (c, id) => trainingService.archive(c, id),
  qualificationAdd: (c, id, fd) => qualificationService.add(c, id, input(fd)),
  qualificationUpdate: (c, id, fd) => qualificationService.update(c, id, input(fd)),
  qualificationRenew: (c, id, fd) => qualificationService.renew(c, id, input(fd)),
  qualificationVerify: (c, id) => qualificationService.verify(c, id),
  qualificationArchive: (c, id) => qualificationService.archive(c, id),
  // orientations, permits, languages
  orientationAdd: (c, id, fd) => orientationService.add(c, id, input(fd)),
  orientationUpdate: (c, id, fd) => orientationService.update(c, id, input(fd)),
  orientationAcknowledge: (c, id) => orientationService.acknowledge(c, id),
  orientationArchive: (c, id) => orientationService.archive(c, id),
  authorizationAdd: (c, id, fd) => authorizationService.add(c, id, input(fd)),
  authorizationArchive: (c, id) => authorizationService.archive(c, id),
  languageSave: (c, id, fd) => {
    const data = input<Record<string, string>>(fd);
    return languageService.save(c, id, { ...data, language: data.language === "other" ? (data.otherLanguage ?? "") : data.language } as never);
  },
  languageRemove: (c, id) => languageService.remove(c, id),
  // clothing and items
  clothingIssue: (c, id, fd) => clothingService.issue(c, id, input(fd)),
  clothingCancel: (c, id) => clothingService.cancel(c, id),
  itemAdd: (c, id, fd) => companyItemService.add(c, id, input(fd)),
  itemUpdate: (c, id, fd) => companyItemService.update(c, id, input(fd)),
  itemAcknowledge: (c, id) => companyItemService.acknowledge(c, id),
  // files (id = employee or file)
  fileUpload: async (c, id, fd) => employeeFileService.upload(c, id, input(fd), await requiredFile(fd)),
  fileRename: (c, id, fd) => employeeFileService.rename(c, id, input(fd)),
  fileArchive: (c, id) => employeeFileService.archive(c, id),
  // settings (id unused or the catalogue record)
  settingsUpdate: (c, _id, fd) => hrSettingsService.update(c, input(fd)),
  areaCreate: (c, _id, fd) => competenceAreaService.create(c, input(fd)),
  areaUpdate: (c, id, fd) => competenceAreaService.update(c, id, input(fd)),
  areaArchive: (c, id) => competenceAreaService.archive(c, id),
  areaRestore: (c, id) => competenceAreaService.restore(c, id),
  areaSuggested: (c) => competenceAreaService.addSuggested(c),
  typeCreate: (c, _id, fd) => qualificationTypeService.create(c, input(fd)),
  typeArchive: (c, id) => qualificationTypeService.archive(c, id),
  typeRestore: (c, id) => qualificationTypeService.restore(c, id),
  typeSuggested: (c) => qualificationTypeService.addSuggested(c),
  profileCreate: (c, _id, fd) => jobProfileService.create(c, input(fd)),
  profileArchive: (c, id) => jobProfileService.archive(c, id),
  requirementAdd: (c, id, fd) => jobProfileService.addRequirement(c, id, input(fd)),
  requirementRemove: (c, id) => jobProfileService.removeRequirement(c, id),
} satisfies Record<string, Op>;

export type HrOp = keyof typeof OPS;

export async function hrAction(slug: string, op: HrOp, id: string, _: ActionState | null, formData?: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? (OPS[op] as Op) : null;
  if (!fn) return { ok: false, message: "errors.generic" };
  const fd = formData instanceof FormData ? formData : new FormData();
  const r = await runAction(formData instanceof FormData ? formData : null, () => fn(ctx, id, fd).then(() => undefined));
  revalidatePath(`/c/${slug}/workforce`, "layout");
  return r;
}

/** Runs the expiry reminders of this company now (HR admin) and shows the counts. */
export async function runRemindersAction(slug: string, _: ActionState | null): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let target = "";
  const r = await runAction(null, async () => {
    const res = await hrSettingsService.runReminders(ctx);
    target = `/c/${slug}/workforce/settings?sent=${res.sent}&failed=${res.failed}&noAddress=${res.noAddress}`;
  });
  if (r.ok) redirect(target);
  return r;
}
