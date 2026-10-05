import { notFound } from "next/navigation";
import { isDevLoginEnabled } from "@/platform/config/env";
import { listDevMailbox } from "@/platform/mail";

export const dynamic = "force-dynamic";

/** Development-only mailbox for e-mail links; hard-disabled in production. */
export default async function DevMailboxPage() {
  if (!isDevLoginEnabled()) notFound();
  const mails = await listDevMailbox();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-xl font-semibold">Dev mailbox</h1>
      <ul className="space-y-3">
        {mails.map((m) => (
          <li key={m.id} className="rounded-lg border p-3 text-sm" data-testid="dev-mail" data-to={m.to}>
            <p className="font-medium">
              {m.to} · {m.subject}
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-all font-sans">{m.bodyText}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
