"use client";

/** Big tap targets that fill the hours input (minimal typing on site). */
export function QuickHours({ name = "hours", values = ["7.5", "8", "10"], label }: { name?: string; values?: string[]; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={(e) => {
            const input = e.currentTarget.closest("form")?.querySelector<HTMLInputElement>(`input[name="${name}"]`) ?? null;
            if (input) {
              input.value = v.replace(".", ",");
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }}
          className="h-11 min-w-16 rounded-lg border bg-background px-3 text-base font-medium hover:bg-muted md:h-9 md:text-sm"
        >
          {v.replace(".", ",")} h
        </button>
      ))}
    </div>
  );
}
