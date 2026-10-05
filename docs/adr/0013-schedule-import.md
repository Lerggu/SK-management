# ADR 0013 — MS Project and Primavera P6 schedule import

- Status: Accepted (V3, owner decision: import required in V3)

## Formats
The import reads files only. There is no API connection, and no integration is fabricated.
- **MS Project XML (MSPDI)**, from "Save as → XML". Parsed with `fast-xml-parser`, with entity processing disabled, so no entity expansion and no external resources. The native binary `.mpp` format is not supported; users export it to XML.
- **Primavera P6 XER**, a tab-separated export. Parsed by a small reader over the `%T/%F/%R` records.
  - The first project in the file is read. Tasks are taken from `TASK` (target dates, falling back to early dates). The WBS chain comes from `PROJWBS` (the project node is excluded), and dependencies from `TASKPRED`.
  - Files that are not valid UTF-8 are decoded as Latin-1.

Both formats are normalized to leaf tasks with a summary/WBS path and FS/SS/FF/SF links with lags in days. MSPDI uses `MinutesPerDay` (default 480); XER assumes 8-hour days.

## Mapping
- The user chooses the **WBS level of the takt area** (1–3) and a target building for new areas.
- The path element at that level is the takt area. The next element is the work package, or the task itself when the task sits directly under the area.
- Several tasks for the same area × work package are merged (earliest start, latest finish).
- Milestones and tasks above the area level are reported as not imported.
- Areas and work packages are matched by name or code. Missing ones are created, with codes derived from the name.
- Start and duration are converted to cycles with the plan's working calendar.

## Safety
- **Two steps.**
  - Upload stores the original file in object storage with its SHA-256, plus a `schedule_imports` row with a JSON preview, status PREVIEW. The original file can be downloaded later.
  - Apply writes into the open DRAFT, or a new draft copied from the baseline. It never writes into a baseline.
  - A PROPOSED version blocks the import until it is returned to draft.
- If the schedule starts before the version start, the version start moves earlier. Existing assignments then shift by the same number of cycles, so their dates do not change.
- Dependencies that would create a cycle are skipped and counted.
- Preview, apply and discard are audited.
- Size limits and the upload rate limit match document uploads.
