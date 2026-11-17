"use server";

import { revalidatePath } from "next/cache";
import type { RequestContext } from "@/platform/authz";
import { staffingService, taskTypeService } from "@/modules/production/service";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

type Op = (ctx: RequestContext, id: string, formData: FormData) => Promise<unknown>;
const input = <T,>(fd: FormData) => formInput<T>(fd);

/** Production control form operations (ADR 0026); services check access. */
const OPS = {
  typeCreate: (c, _id, fd) => taskTypeService.create(c, input(fd)),
  typeUpdate: (c, id, fd) => taskTypeService.update(c, id, input(fd)),
  typeArchive: (c, id) => taskTypeService.archive(c, id),
  typeSuggested: (c) => taskTypeService.addSuggested(c),
  roleAdd: (c, id, fd) => taskTypeService.addRole(c, id, input(fd)),
  roleRemove: (c, id) => taskTypeService.removeRole(c, id),
  setTaskType: (c, id, fd) => staffingService.setTaskType(c, id, input(fd)),
  assign: (c, id, fd) => staffingService.assign(c, id, input(fd)),
} satisfies Record<string, Op>;

export type ProductionOp = keyof typeof OPS;

export async function productionAction(slug: string, op: ProductionOp, id: string, _: ActionState | null, formData?: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? (OPS[op] as Op) : null;
  if (!fn) return { ok: false, message: "errors.generic" };
  const fd = formData instanceof FormData ? formData : new FormData();
  const r = await runAction(formData instanceof FormData ? formData : null, () => fn(ctx, id, fd).then(() => undefined));
  revalidatePath(`/c/${slug}/logistics`, "layout");
  return r;
}
