# ADR 0009 — Internationalization

- Status: Accepted (V1)

- `next-intl` without locale routing. The locale comes from the `sk_locale` cookie and is saved to the user's profile. **Finnish is the default**; English is available.
- All UI text lives in `src/platform/i18n/messages/{fi,en}.json`. Validation errors are message keys (`validation.*`) produced by a global Zod error map, so domain services stay language-neutral.
- Codes containing dots (permissions, audit actions) are looked up with dots replaced by underscores (`codeKey`), because next-intl keys cannot contain dots.
- Timestamps are displayed in **Europe/Helsinki**. Date-only columns are formatted in UTC so the calendar day never shifts. Finnish decimal commas are accepted for money and meter-hour input.
- `src/platform/i18n/messages.test.ts` checks key parity, that no translation is empty, and that every validation key, permission and audit action used in code is translated.
