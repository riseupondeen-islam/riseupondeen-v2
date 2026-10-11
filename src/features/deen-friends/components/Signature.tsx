/* Handwritten-style signature for the visiting card (V3.1). Four slim, clean script styles from
 * Google Fonts (already used by the app), loaded only when a signature is first shown. */
import { useEffect, useState } from 'react';
import type { Signature as SignatureValue, SignatureStyle } from '../types';

/* The signature fonts are the same four used since the visiting card was introduced (V3.2). V3.5:
 * when a font cannot be loaded (offline Home Screen app, slow or blocked font host), the browser
 * used to fall back to the generic `cursive` face — Comic Sans on Windows — so the signature looked
 * like a different, unrefined font. Each style now falls back to elegant script faces the devices
 * already have (iOS/macOS: Snell Roundhand / Apple Chancery; Windows: Segoe Script / Brush Script;
 * Android: its built-in cursive), and `cursive` only last. */
const SCRIPT_FALLBACK = "'Snell Roundhand', 'Apple Chancery', 'Segoe Script', 'Brush Script MT', cursive";
export const SIGNATURE_FONTS: Record<SignatureStyle, { family: string; primary: string; label: string; scale: number }> = {
  royal: { family: `'Great Vibes', ${SCRIPT_FALLBACK}`, primary: 'Great Vibes', label: 'Royal', scale: 1 },
  slim: { family: `'Allura', ${SCRIPT_FALLBACK}`, primary: 'Allura', label: 'Slim', scale: 1.05 },
  classic: { family: `'Pinyon Script', ${SCRIPT_FALLBACK}`, primary: 'Pinyon Script', label: 'Classic', scale: 0.86 },
  autograph: { family: `'Mrs Saint Delafield', ${SCRIPT_FALLBACK}`, primary: 'Mrs Saint Delafield', label: 'Autograph', scale: 1.15 },
};

/** How long a signature waits for its own font before showing (in the fallback face). */
const FONT_WAIT_MS = 5000;

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
        Promise.all(Object.values(SIGNATURE_FONTS).map((f) => fonts.load(`32px '${f.primary}'`).catch(() => undefined)))
          .then(() => resolve())
          .catch(() => resolve());
      };
      link.onerror = () => resolve();
      setTimeout(resolve, FONT_WAIT_MS);
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
