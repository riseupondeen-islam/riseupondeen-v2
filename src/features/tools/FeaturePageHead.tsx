/** Header used by the feature pages (Prayer, Zakat, Sadaqah, Hajj & Umrah …).
 *  Same markup as the original pageHead() template. The Back button is handled by the shared
 *  [data-rud-feature-back] listener. */
export function FeaturePageHead({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <header className="rud-feature-head">
      <div>
        <span className="eyebrow">{kicker}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      <button type="button" className="rud-mini-btn" data-rud-feature-back="" aria-label="Back to home">
        ← Back
      </button>
    </header>
  );
}
