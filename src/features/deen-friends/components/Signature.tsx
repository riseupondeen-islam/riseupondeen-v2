/* Handwritten-style signature for the visiting card. Four script styles from Google Fonts — the same
 * four since the visiting card was introduced (V3.2): Great Vibes (Royal, the default), Allura,
 * Pinyon Script and Mrs Saint Delafield.
 *
 * V3.5.1 — the same font on every device. Previously all four fonts were requested together, and after
 * a fixed wait the signature was shown anyway in whatever script face the phone had (Snell Roundhand on
 * iOS, Android's built-in cursive). On slower mobile connections that is what people saw. Now:
 *  - only the font a signature uses is requested (one small file, so it arrives sooner);
 *  - a signature is never drawn in any other font: it stays invisible until its own font is loaded,
 *    then fades in. If the font host cannot be reached at all, the signature is simply not shown
 *    (and is retried the next time it is displayed). */
import { useEffect, useState } from 'react';
import type { Signature as SignatureValue, SignatureStyle } from '../types';

export const SIGNATURE_FONTS: Record<SignatureStyle, { family: string; primary: string; label: string; scale: number }> = {
  royal: { family: "'Great Vibes', cursive", primary: 'Great Vibes', label: 'Royal', scale: 1 },
  slim: { family: "'Allura', cursive", primary: 'Allura', label: 'Slim', scale: 1.05 },
  classic: { family: "'Pinyon Script', cursive", primary: 'Pinyon Script', label: 'Classic', scale: 0.86 },
  autograph: { family: "'Mrs Saint Delafield', cursive", primary: 'Mrs Saint Delafield', label: 'Autograph', scale: 1.15 },
};

const loads = new Map<SignatureStyle, Promise<boolean>>();
const loaded = new Set<SignatureStyle>();

/** Loads one signature font (once). Resolves true only when that exact font is ready to draw. */
export function loadSignatureFont(style: SignatureStyle): Promise<boolean> {
  const existing = loads.get(style);
  if (existing) return existing;
  const { primary } = SIGNATURE_FONTS[style];
  const promise = new Promise<boolean>((resolve) => {
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    if (!fonts) return resolve(false);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(primary).replace(/%20/g, '+')}&display=swap`;
    link.onload = () =>
      fonts
        .load(`32px '${primary}'`)
        .then((faces) => resolve(faces.some((f) => f.status === 'loaded')))
        .catch(() => resolve(false));
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
  }).then((ok) => {
    if (ok) loaded.add(style);
    else loads.delete(style); // try again the next time a signature is shown
    return ok;
  });
  loads.set(style, promise);
  return promise;
}

/** True once the style's own font is ready (re-renders when it arrives). */
function useSignatureFont(style: SignatureStyle): boolean {
  const [ready, setReady] = useState(() => loaded.has(style));
  useEffect(() => {
    let alive = true;
    setReady(loaded.has(style));
    void loadSignatureFont(style).then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, [style]);
  return ready;
}

export function SignatureText({ value, fallbackName, size = 30 }: { value: SignatureValue | null; fallbackName: string; size?: number }) {
  const style = value?.style || 'royal';
  const ready = useSignatureFont(style);
  const font = SIGNATURE_FONTS[style];
  const text = value?.text || fallbackName;
  return (
    <span
      className={`df2-signature${ready ? ' is-ready' : ''}`}
      style={{ fontFamily: font.family, fontSize: `${Math.round(size * font.scale)}px` }}
      aria-label={`Signature: ${text}`}
    >
      {text}
    </span>
  );
}

/** The small sample in the signature style picker — also only ever shown in its own font. */
export function SignatureSample({ style, text }: { style: SignatureStyle; text: string }) {
  const ready = useSignatureFont(style);
  return <span style={{ fontFamily: SIGNATURE_FONTS[style].family, visibility: ready ? 'visible' : 'hidden' }}>{text}</span>;
}
