"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/ui/components/button";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

/**
 * Camera QR scanning with the browser's BarcodeDetector. When the camera or
 * the API is not available the manual code field below is used instead. A
 * detected value is put into the code field and the form is submitted, so
 * resolution and authorization always happen on the server.
 */
export function Scanner({ formId }: { formId: string }) {
  const t = useTranslations("materials");
  const video = React.useRef<HTMLVideoElement>(null);
  const [state, setState] = React.useState<"idle" | "running" | "unsupported" | "denied">("idle");
  const stream = React.useRef<MediaStream | null>(null);

  const stop = React.useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
  }, []);

  React.useEffect(() => stop, [stop]);

  async function start() {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      setState("denied");
      return;
    }
    const v = video.current!;
    v.srcObject = stream.current;
    await v.play();
    setState("running");
    const detector = new Ctor({ formats: ["qr_code"] });
    const tick = async () => {
      if (!stream.current) return;
      try {
        const [hit] = await detector.detect(v);
        if (hit?.rawValue) {
          stop();
          const form = document.getElementById(formId) as HTMLFormElement | null;
          const input = form?.elements.namedItem("code") as HTMLInputElement | null;
          if (form && input) {
            input.value = hit.rawValue;
            form.requestSubmit();
          }
          return;
        }
      } catch {
        // Frame not ready yet; keep scanning.
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-zinc-900 sm:aspect-video">
        <video ref={video} playsInline muted className={state === "running" ? "size-full object-cover" : "hidden"} />
        {state !== "running" && (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-zinc-300">
            {state === "idle" ? <Camera className="size-10" aria-hidden /> : <CameraOff className="size-10" aria-hidden />}
            {state === "unsupported" && <span data-testid="scan-unsupported">{t("cameraUnsupported")}</span>}
            {state === "denied" && <span>{t("cameraDenied")}</span>}
          </div>
        )}
      </div>
      {state !== "running" ? (
        <Button type="button" size="lg" className="w-full max-w-sm" onClick={start} data-testid="start-camera">
          <Camera aria-hidden /> {t("startCamera")}
        </Button>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full max-w-sm"
          onClick={() => {
            stop();
            setState("idle");
          }}
        >
          {t("stopCamera")}
        </Button>
      )}
    </div>
  );
}
