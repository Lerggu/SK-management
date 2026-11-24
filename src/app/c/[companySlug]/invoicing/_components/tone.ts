/** Status badge tone of a sales document; an issued document that has been e-mailed shows as sent. */
export const TONE: Record<string, string> = { DRAFT: "DRAFT", ISSUED: "IN_USE", SENT: "APPROVED", VOID: "ARCHIVED" };

export const shownStatus = (r: { status: string; sentAt: Date | null }) => (r.status === "ISSUED" && r.sentAt ? "SENT" : r.status);
