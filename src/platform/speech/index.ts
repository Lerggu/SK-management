/**
 * Speech-to-text port (ADR 0031). Implementation: Azure AI Speech (short-audio
 * REST, WAV 16 kHz mono PCM, up to 60 s), configured by `SK_SPEECH_KEY` and
 * `SK_SPEECH_REGION` (Key Vault in Azure). The audio stays in the company's
 * Azure tenant region. Tests set a fake with `setSpeechForTests`.
 */
export interface SpeechToText {
  readonly name: string;
  transcribe(wav: Uint8Array, locale: "fi" | "en"): Promise<string>;
}

export class SpeechError extends Error {}

/** Longest accepted recording: 60 s of 16 kHz mono 16-bit PCM plus the header. */
export const MAX_WAV_BYTES = 60 * 16_000 * 2 + 44;

class AzureSpeech implements SpeechToText {
  readonly name = "azure";
  constructor(
    private readonly key: string,
    private readonly region: string,
  ) {}

  async transcribe(wav: Uint8Array, locale: "fi" | "en") {
    const lang = locale === "en" ? "en-US" : "fi-FI";
    const url = `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=simple`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": this.key, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", Accept: "application/json" },
      body: Buffer.from(wav),
    });
    if (!res.ok) throw new SpeechError(`Speech service returned ${res.status}`);
    const body = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
    if (body.RecognitionStatus !== "Success") return "";
    return (body.DisplayText ?? "").trim();
  }
}

let override: SpeechToText | null | undefined;

export function getSpeech(): SpeechToText | null {
  if (override !== undefined) return override;
  const key = process.env.SK_SPEECH_KEY;
  const region = process.env.SK_SPEECH_REGION;
  if (key && region && /^[a-z0-9]+$/.test(region)) return new AzureSpeech(key, region);
  return null;
}

export function setSpeechForTests(s: SpeechToText | null | undefined) {
  override = s;
}

/** Checks the RIFF/WAVE header: PCM, mono, 16 kHz, 16-bit. */
export function isSupportedWav(b: Uint8Array): boolean {
  if (b.length < 44 || b.length > MAX_WAV_BYTES) return false;
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return s(0, 4) === "RIFF" && s(8, 4) === "WAVE" && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16000 && v.getUint16(34, true) === 16;
}
