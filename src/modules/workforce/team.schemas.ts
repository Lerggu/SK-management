import { z } from "zod";
import { optionalText, optionalUuid, text, uuid } from "@/platform/http/validation";

export const TEAM_COLORS = ["slate", "sky", "amber", "emerald", "violet", "rose", "orange", "teal"] as const;

export const teamSchema = z.object({
  name: text(80),
  description: optionalText(300),
  color: z.enum(TEAM_COLORS).default("sky"),
  leaderId: optionalUuid(),
});
export type TeamInput = z.input<typeof teamSchema>;

export const memberSchema = z.object({ employeeIds: z.array(uuid()).min(1, "validation.selectPeople").max(200) });
export type MemberInput = z.input<typeof memberSchema>;
