"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mic, Send, Square, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { startWavRecording, type WavRecorder } from "@/ui/lib/wav-recorder";

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]>; conversationId?: string | null };
export interface ChatAction {
  id: string;
  type: string;
  summary: string;
  money: boolean;
  amount: string | null;
  status: string;
  error: string | null;
  result: { id: string; label: string } | null;
}

/**
 * Assistant conversation (ADR 0031): speak or type, read the reply, confirm
 * or reject each proposed action. Money actions need the amount typed again.
 */
export function AssistantChat({
  slug,
  conversationId,
  messages,
  actions,
  available,
  speech,
  send,
  confirm,
  reject,
  confirmAll,
}: {
  slug: string;
  conversationId: string | null;
  messages: { role: "user" | "assistant"; text: string }[];
  actions: ChatAction[];
  available: boolean;
  speech: boolean;
  send: (conversationId: string | null, message: string) => Promise<Result>;
  confirm: (actionId: string, amount: string | null) => Promise<Result>;
  reject: (actionId: string) => Promise<Result>;
  confirmAll: (conversationId: string) => Promise<Result>;
}) {
  const t = useTranslations("assistant");
  const tAll = useTranslations();
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const rec = useRef<WavRecorder | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, actions.length]);

  const fail = (r: Result) => setError(tAll(r.fieldErrors ? (Object.values(r.fieldErrors).flat()[0] ?? r.message ?? "errors.generic") : (r.message ?? "errors.generic")));

  const submit = (message: string) => {
    if (!message.trim()) return;
    setError(null);
    start(async () => {
      const r = await send(conversationId, message.trim());
      if (!r.ok) return fail(r);
      setText("");
      if (r.conversationId && r.conversationId !== conversationId) router.replace(`/c/${slug}/assistant?c=${r.conversationId}`);
      router.refresh();
    });
  };

  const stopAndSend = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    if (!r) return;
    const wav = await r.stop();
    start(async () => {
      const res = await fetch(`/c/${slug}/assistant/transcribe`, { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" } });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !body.text) return setError(tAll(body.error ?? "assistant.notHeard"));
      setText(body.text);
      const r2 = await send(conversationId, body.text);
      if (!r2.ok) return fail(r2);
      setText("");
      if (r2.conversationId && r2.conversationId !== conversationId) router.replace(`/c/${slug}/assistant?c=${r2.conversationId}`);
      router.refresh();
    });
  };

  const toggleMic = async () => {
    if (recording) return stopAndSend();
    setError(null);
    try {
      rec.current = await startWavRecording(55, () => void stopAndSend());
      setRecording(true);
    } catch {
      setError(t("micDenied"));
    }
  };

  const decide = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) fail(r);
      else setError(null);
      router.refresh();
    });

  const proposed = actions.filter((a) => a.status === "PROPOSED");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {!available && <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">{t("unavailable")}</p>}
      <div className="space-y-3" data-testid="assistant-messages" aria-live="polite">
        {messages.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("examples")}</p>}
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[85%] rounded-2xl px-4 py-2 text-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")} data-role={m.role}>
            {m.text}
          </div>
        ))}
      </div>

      {actions.length > 0 && (
        <ul className="space-y-2" data-testid="assistant-actions">
          {actions.map((a) => (
            <li key={a.id} className={cn("rounded-xl border bg-card p-3", a.status === "PROPOSED" && "border-primary/50", a.money && a.status === "PROPOSED" && "border-amber-500")} data-action={a.type} data-status={a.status}>
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium">{a.summary}</p>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">{t(`statuses.${a.status}`)}</span>
              </div>
              {a.result && <p className="mt-1 text-xs text-muted-foreground">{t("done", { label: a.result.label })}</p>}
              {a.error && a.status === "FAILED" && <p className="mt-1 text-xs text-destructive">{tAll(a.error)}</p>}
              {a.status === "PROPOSED" && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {a.money && (
                    <label className="text-xs">
                      <span className="mb-1 block font-medium text-amber-900">{t("typeAmount", { amount: (a.amount ?? "").replace(".", ",") })}</span>
                      <input inputMode="decimal" value={amounts[a.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })} className="h-11 w-32 rounded-lg border bg-background px-2 text-base md:h-9 md:text-sm" aria-label={t("amountLabel")} />
                    </label>
                  )}
                  <button type="button" disabled={pending} onClick={() => decide(() => confirm(a.id, a.money ? (amounts[a.id] ?? "") : null))} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60 md:min-h-9">
                    <Check className="size-4" aria-hidden /> {t("confirm")}
                  </button>
                  <button type="button" disabled={pending} onClick={() => decide(() => reject(a.id))} className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm disabled:opacity-60 md:min-h-9">
                    <X className="size-4" aria-hidden /> {t("reject")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {conversationId && proposed.filter((a) => !a.money).length > 1 && (
        <button type="button" disabled={pending} onClick={() => decide(() => confirmAll(conversationId))} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
          <Check className="size-4" aria-hidden /> {t("confirmAll")}
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
      <div ref={end} />
      <form
        className="sticky bottom-20 flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        {speech && (
          <button type="button" onClick={toggleMic} disabled={pending && !recording} aria-pressed={recording} aria-label={recording ? t("stop") : t("speak")} className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-full", recording ? "animate-pulse bg-red-600 text-white" : "bg-primary text-primary-foreground")}>
            {recording ? <Square className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={recording ? t("listening") : t("placeholder")}
          aria-label={t("placeholder")}
          className="min-h-12 flex-1 resize-none rounded-xl bg-transparent px-2 py-3 text-base outline-none"
          data-testid="assistant-input"
        />
        <button type="submit" disabled={pending || !text.trim()} aria-label={t("send")} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border disabled:opacity-50">
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
        </button>
      </form>
    </div>
  );
}
