"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/ui/components/button";

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> };

/** Longest side of a PDF page rendered to an image (enough to zoom into a site plan). */
const PDF_MAX_SIDE = 3200;

async function measure(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Renders the first page of a PDF to a JPEG in the browser (pdf.js); the server stores images only. */
async function pdfToImage(file: File): Promise<{ file: File; width: number; height: number }> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(PDF_MAX_SIDE / Math.max(base.width, base.height), 6);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.9));
    const name = file.name.replace(/\.pdf$/i, "") || "aluekartta";
    return { file: new File([blob], `${name}.jpg`, { type: "image/jpeg" }), width: canvas.width, height: canvas.height };
  } finally {
    await task.destroy();
  }
}

/**
 * Uploads the site's overview image: PNG, JPEG or WebP as is, or a PDF whose
 * first page is converted to an image here before upload.
 */
export function MapUpload({ upload, hasMap }: { upload: (fd: FormData) => Promise<Result>; hasMap: boolean }) {
  const t = useTranslations("production.map");
  const tAll = useTranslations();
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("source") as HTMLInputElement;
    const title = (form.elements.namedItem("title") as HTMLInputElement).value;
    const chosen = input.files?.[0];
    if (!chosen) {
      setStatus({ ok: false, text: tAll("validation.fileRequired") });
      return;
    }
    setBusy(true);
    try {
      let file: File = chosen;
      let size: { width: number; height: number };
      if (chosen.type === "application/pdf" || /\.pdf$/i.test(chosen.name)) {
        setStatus({ ok: true, text: t("converting") });
        const converted = await pdfToImage(chosen);
        file = converted.file;
        size = { width: converted.width, height: converted.height };
      } else {
        size = await measure(chosen);
      }
      setStatus({ ok: true, text: t("uploading") });
      const fd = new FormData();
      fd.set("file", file);
      fd.set("width", String(size.width));
      fd.set("height", String(size.height));
      fd.set("title", title);
      const r = await upload(fd);
      if (r.ok) {
        setStatus({ ok: true, text: t("uploaded") });
        form.reset();
        startTransition(() => router.refresh());
      } else {
        const keys = [...(r.fieldErrors?.file ?? []), ...(r.fieldErrors?.width ?? []), ...(r.fieldErrors?._form ?? [])];
        setStatus({ ok: false, text: keys.length ? keys.map((k) => tAll(k)).join(" ") : tAll(r.message ?? "errors.generic") });
      }
    } catch {
      setStatus({ ok: false, text: t("convertFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" data-testid="map-upload">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">{hasMap ? t("replaceMap") : t("uploadMap")}</span>
        <input name="source" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" className="h-11 rounded-lg border bg-background px-2 py-2 text-sm md:h-9 md:py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:w-56">
        <span className="font-medium">{t("mapTitle")}</span>
        <input name="title" maxLength={120} className="h-11 rounded-lg border bg-background px-3 text-sm md:h-9" />
      </label>
      <Button type="submit" variant="outline" disabled={busy} className="h-11 md:h-9">
        <Upload className="size-4" aria-hidden />
        {t("upload")}
      </Button>
      <p className="w-full text-xs text-muted-foreground">{t("uploadHint")}</p>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "w-full text-sm text-emerald-700" : "w-full text-sm text-destructive"}>
          {status.text}
        </p>
      )}
    </form>
  );
}
