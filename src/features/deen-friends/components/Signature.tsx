/* Handwritten-style signature for the visiting card (V3.1). Four slim, clean script styles from
 * Google Fonts (already used by the app), loaded only when a signature is first shown. */
import { useEffect, useState } from 'react';
import type { Signature as SignatureValue, SignatureStyle } from '../types';

export const SIGNATURE_FONTS: Record<SignatureStyle, { family: string; label: string; scale: number }> = {
  royal: { family: "'Great Vibes', cursive", label: 'Royal', scale: 1 },
  slim: { family: "'Allura', cursive", label: 'Slim', scale: 1.05 },
  classic: { family: "'Pinyon Script', cursive", label: 'Classic', scale: 0.86 },
  autograph: { family: "'Mrs Saint Delafield', cursive", label: 'Autograph', scale: 1.15 },
};

let fontsRequested = false;
let fontsReady: Promise<void> | null = null;

/** Adds the signature font stylesheet once (non-blocking) and resolves when the fonts are usable. */
export function ensureSignatureFonts(): Promise<void> {
  if (!fontsRequested && typeof document !== 'undefined') {
    fontsRequested = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Allura&family=Great+Vibes&family=Mrs+Saint+Delafield&family=Pinyon+Script&display=swap';
    document.head.appendChild(link);
    fontsReady = new Promise((resolve) => {
      link.onload = () => {
        const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
        if (!fonts) return resolve();
        Promise.all(Object.values(SIGNATURE_FONTS).map((f) => fonts.load(`32px ${f.family}`).catch(() => undefined)))
          .then(() => resolve())
          .catch(() => resolve());
      };
      link.onerror = () => resolve();
      setTimeout(resolve, 2500);
    });
  }
  return fontsReady || Promise.resolve();
}

export function SignatureText({ value, fallbackName, size = 30 }: { value: SignatureValue | null; fallbackName: string; size?: number }) {
  const [ready, setReady] = useState(fontsRequested && !!fontsReady);
  useEffect(() => {
    let alive = true;
    void ensureSignatureFonts().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  const style = value?.style || 'royal';
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
