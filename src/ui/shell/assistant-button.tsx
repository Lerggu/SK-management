import Link from "next/link";
import { Mic } from "lucide-react";

/** Floating shortcut to the voice/text assistant (ADR 0031), above the phone navigation bar. */
export function AssistantButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="fixed right-4 bottom-24 z-40 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 md:bottom-6"
      data-testid="assistant-button"
    >
      <Mic className="size-6" aria-hidden />
    </Link>
  );
}
