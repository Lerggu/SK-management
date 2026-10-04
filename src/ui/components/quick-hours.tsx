"use client";

/** Big tap targets that fill the hours input (minimal typing on site). */
export function QuickHours({ target = "f-hours", values = ["7.5", "8", "10"], label }: { target?: string; values?: string[]; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => {
            const input = document.getElementById(target) as HTMLInputElement | null;
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
