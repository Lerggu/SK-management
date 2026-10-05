import { NextResponse } from "next/server";
import { isAppError } from "@/platform/errors";
import { timesheetService } from "@/modules/timesheets/service";
import { requireCompanyContext } from "@/app/_lib/context";

/** Payroll CSV for one export batch (semicolon-separated, UTF-8 BOM for Excel). */
function csvCell(raw: string) {
  // Neutralise spreadsheet formulas in free text; negative numbers (corrections) stay numeric.
  const v = /^[=+@\t\r]|^-(?![\d.])/.test(raw) ? `'${raw}` : raw;
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(_req: Request, { params }: { params: Promise<{ companySlug: string; batchId: string }> }) {
  const { companySlug, batchId } = await params;
  const ctx = await requireCompanyContext(companySlug);
  try {
    const rows = await timesheetService.exportRows(ctx, batchId);
    const header = ["employee_number", "last_name", "first_name", "work_date", "project", "site", "hours", "work_class", "correction_of", "note"];
    const lines = rows.map((r) =>
      [r.employeeNumber, r.lastName, r.firstName, r.workDate.toISOString().slice(0, 10), r.projectCode, r.site, r.hours, r.workClass, r.correctionOf, r.note].map((v) => csvCell(String(v))).join(";"),
    );
    const body = "﻿" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hours-${batchId.slice(0, 8)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
