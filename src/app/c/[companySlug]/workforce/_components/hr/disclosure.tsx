/** Collapsible "add / edit" area: keeps long cards short on phones. */
export function Disclosure({ summary, children, defaultOpen, testId }: { summary: string; children: React.ReactNode; defaultOpen?: boolean; testId?: string }) {
  return (
    <details className="group mt-3 rounded-lg border bg-muted/20" open={defaultOpen} data-testid={testId}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-primary marker:hidden md:min-h-9">
        <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}
