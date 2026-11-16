import type { hrCardService } from "@/modules/hr/card.service";
import type { employeeFileService } from "@/modules/hr/files.service";
import type { FormState } from "@/ui/components/form";
import type { HrOp } from "../../hr-actions";

export type Card = Awaited<ReturnType<typeof hrCardService.get>>;
export type WorkData = NonNullable<Card["work"]>;
export type EquipmentData = NonNullable<Card["equipment"]>;
export type CardFile = Awaited<ReturnType<typeof employeeFileService.list>>[number];
export type FormAction = (state: FormState | null, formData: FormData) => Promise<FormState>;
/** Bound HR server action for one operation and record id. */
export type Act = (op: HrOp, id: string) => FormAction;
