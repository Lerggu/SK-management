# ADR 0011 — Site diary: drafts, signing and addenda

- Status: Accepted (V2)

- One diary per site and day (`UNIQUE (site_id, report_date)`). Opening a day creates the draft (`diary.manage`); viewing needs `diary.view` in the project. Client and Subcontractor templates do not get diary access.
- **Draft from structured data:** attendance is computed live from the day's time entries for the site (all statuses except rejected). Entries cover work done, equipment hours, delays and instructions. Photos and PDFs are stored through the S3 adapter (images are shown inline with a restrictive CSP; anything else is an attachment).
- **Signing** (`diary.sign`) freezes the attendance into `attendance_snapshot`, so later time entries do not change a signed diary, and sets SIGNED. The `daily_reports_guard` trigger blocks every later UPDATE and DELETE.
- **Addenda:** after signing, new entries and photos are allowed only with `is_addendum = true` (trigger `daily_report_children_guard`). They are audited as `daily_report.addendum`. Existing entries of a signed diary can never change.
- AI may draft diary prose in V8, but per the Build Master a person always signs.
