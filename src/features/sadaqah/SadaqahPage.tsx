import { useEffect, useRef, useState } from 'react';
import { FeaturePageHead } from '../tools/FeaturePageHead';
import { activeSadaqahRequests, type SadaqahRequest } from './sadaqahRequests';

const COPY_LABEL = 'Copy UPI ID';

function CopyUpiButton({ upiId }: { upiId: string }) {
  const [label, setLabel] = useState(COPY_LABEL);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    if (!upiId) return;
    try {
      await navigator.clipboard.writeText(upiId);
      setLabel('Copied');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLabel(COPY_LABEL), 1200);
    } catch {
      setLabel('Copy manually');
    }
  };
  return (
    <button
      className="rud-mini-btn"
      type="button"
      data-copy-upi={upiId}
      onClick={(e) => {
        e.preventDefault();
        void copy();
      }}
    >
      {label}
    </button>
  );
}

function SadaqahCard({ item }: { item: SadaqahRequest }) {
  return (
    <article className="rud-sadaqah-card">
      <div className="rud-sadaqah-copy">
        <span className="eyebrow">ACTIVE REQUEST</span>
        <h3>{item.title || 'Family in need'}</h3>
        <p>{item.description || ''}</p>
        <div className="rud-sadaqah-meta">
          <span>Verified / updated</span>
          <strong>{item.verifiedDate || '—'}</strong>
        </div>
      </div>
      <div className="rud-sadaqah-pay">
        <span className="eyebrow">A REMINDER</span>
        <blockquote>
          “Whoever relieves a believer’s hardship in this world, Allah will relieve a hardship for him on the Day of
          Resurrection.”
        </blockquote>
        <small>Sahih Muslim 2699a</small>
        <strong>{item.upiId || ''}</strong>
        <CopyUpiButton upiId={item.upiId || ''} />
        <small>Use this UPI ID in your UPI app to give Sadaqah directly.</small>
      </div>
    </article>
  );
}

/** #sadaqah — shows the active, admin-verified requests from the published content snapshot. */
export function SadaqahPage({ content }: { content: unknown }) {
  const items = activeSadaqahRequests(content);
  return (
    <section className="rud-feature-page rud-zakat-page rud-sadaqah-page">
      <FeaturePageHead
        kicker="Sadaqah"
        title="Give with Sincerity"
        copy="A quiet act of giving can become a lasting source of good."
      />
      <section className="rud-sadaqah-section">
        <div className="rud-sadaqah-head">
          <span className="eyebrow">SADAQAH · VOLUNTARY CHARITY</span>
          <h2>Ease a hardship. Share goodness.</h2>
          <p>Give voluntarily, sincerely, and directly to someone in need.</p>
          <strong>Give for the sake of Allah</strong>
          <small>
            Rise Upon Deen does not collect payments. Give directly using the active Admin-verified UPI ID shown below.
          </small>
        </div>
        <div className="rud-sadaqah-list" id="rudSadaqahList">
          {items.length ? (
            items.map((item, i) => <SadaqahCard key={item.id ?? i} item={item} />)
          ) : (
            <div className="rud-sadaqah-empty">There are no active Sadaqah requests at the moment.</div>
          )}
        </div>
      </section>
    </section>
  );
}
