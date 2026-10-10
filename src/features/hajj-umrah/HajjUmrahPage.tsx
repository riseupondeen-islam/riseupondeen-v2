import { Fragment, useEffect, useRef, useState } from 'react';
import { FeaturePageHead } from '../tools/FeaturePageHead';
import { HAJJ_STEPS, UMRAH_STEPS, type GuideStep, type GuideType } from './guidesData';
import { readJourneyStep, saveJourneyStep } from './journeyProgress';
import { rudReadingPrefs } from '../my-deen/myDeen';

const STEPS: Record<GuideType, readonly GuideStep[]> = { umrah: UMRAH_STEPS, hajj: HAJJ_STEPS };

/** Same check as before: the "Reduced motion" reading preference turns smooth scrolling off. */
function prefersReducedMotion(): boolean {
  return rudReadingPrefs?.()?.reducedMotion === true;
}

function GuideStepCard({ step, hidden }: { step: GuideStep; hidden: boolean }) {
  return (
    <article className="rud-guide-step rud-tool-surface" hidden={hidden}>
      <div className="rud-guide-index">{step.n}</div>
      <div className="rud-guide-copy">
        <div className="rud-guide-meta">{step.meta}</div>
        <h2>{step.title}</h2>
        <ul>
          {step.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        {step.dua && (
          <div className="rud-dua-box">
            <div className="ar" lang="ar" dir="rtl">
              {step.dua.ar}
            </div>
            <div className="trans">{step.dua.trans}</div>
            <div className="meaning">{step.dua.meaning}</div>
            <div className="ref">{step.dua.ref}</div>
          </div>
        )}
      </div>
    </article>
  );
}

/** One guide timeline with optional Journey Mode (one step at a time, progress saved locally). */
function GuideTimeline({
  type,
  id,
  at,
  onNavigate,
  onExit,
}: {
  type: GuideType;
  id: string;
  at: number | null;
  onNavigate: (index: number) => void;
  onExit: () => void;
}) {
  const steps = STEPS[type];
  const timelineRef = useRef<HTMLDivElement>(null);
  const active = at !== null;
  useEffect(() => {
    if (at === null) return;
    const frame = requestAnimationFrame(() =>
      timelineRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [at]);
  return (
    <>
      {active && (
        <div className="rud-guide-journey-controls rud-tool-surface">
          <div>
            <span className="rud-deen-label">GUIDED JOURNEY</span>
            <strong>{`${type === 'hajj' ? 'Hajj' : 'Umrah'} · Step ${at + 1} / ${steps.length}`}</strong>
          </div>
          <div className="rud-inline-actions">
            <button
              className="rud-mini-btn"
              type="button"
              data-rud-guide-nav={`${type}:${at - 1}`}
              disabled={at <= 0}
              onClick={() => onNavigate(at - 1)}
            >
              Previous
            </button>
            <button
              className="rud-mini-btn"
              type="button"
              data-rud-guide-nav={`${type}:${at + 1}`}
              disabled={at >= steps.length - 1}
              onClick={() => onNavigate(at + 1)}
            >
              Next
            </button>
            <button className="rud-mini-btn" type="button" data-rud-guide-exit={type} onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      )}
      <div
        ref={timelineRef}
        className={active ? 'rud-guide-timeline rud-guide-journey-active' : 'rud-guide-timeline'}
        id={id}
        data-rud-guide-timeline={type}
      >
        {steps.map((step, i) => (
          <GuideStepCard key={step.n} step={step} hidden={active && i !== at} />
        ))}
      </div>
    </>
  );
}

export function HajjUmrahPage() {
  const [journey, setJourney] = useState<Record<GuideType, number | null>>({ umrah: null, hajj: null });

  const openJourney = (type: GuideType, index: number | null = null) => {
    const at = saveJourneyStep(
      type,
      index === null ? readJourneyStep(type, STEPS[type].length) : index,
      STEPS[type].length,
    );
    setJourney((prev) => ({ ...prev, [type]: at }));
  };
  const exitJourney = (type: GuideType) => setJourney((prev) => ({ ...prev, [type]: null }));
  const scrollToGuide = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="rud-feature-page rud-guide-page">
      <FeaturePageHead
        kicker="Hajj & Umrah"
        title="Hajj & Umrah"
        copy="Choose the journey you need and follow the existing authentic step-by-step guidance."
      />
      <div className="rud-feature-grid">
        {(['umrah', 'hajj'] as const).map((type) => {
          const name = type === 'umrah' ? 'Umrah' : 'Hajj';
          const target = type === 'umrah' ? 'rudUmrahGuide' : 'rudHajjGuide';
          return (
            <Fragment key={type}>
              <article className="rud-feature-card">
                <span className="rud-card-kicker">{`${name.toUpperCase()} GUIDE`}</span>
                <h2>{`${name} Guide`}</h2>
                <p className="rud-status">{`Step-by-step ${name} guidance`}</p>
                <div className="rud-inline-actions">
                  <button
                    className="rud-mini-btn"
                    type="button"
                    data-rud-guide-target={target}
                    onClick={() => scrollToGuide(target)}
                  >{`Open ${name} Guide ↓`}</button>
                  <button
                    className="rud-mini-btn"
                    type="button"
                    data-rud-guide-start={type}
                    onClick={() => openJourney(type)}
                  >
                    Journey Mode
                  </button>
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
      <div id="rudUmrahGuide" className="rud-guide-intro rud-tool-surface">
        <strong>Umrah Guide · Step by Step.</strong>
        {
          " Use this as a worship companion, not a substitute for your authorized group scholar or Saudi crowd-management instructions. The core sequence is Ihram → Tawaf → Sa'i → shaving/trimming. Avoid pushing, protect others from harm, and follow official access directions at all times."
        }
      </div>
      <GuideTimeline
        type="umrah"
        id="rudUmrahTimeline"
        at={journey.umrah}
        onNavigate={(i) => openJourney('umrah', i)}
        onExit={() => exitJourney('umrah')}
      />
      <div className="rud-guide-note">
        {
          "Primary sequence reference: official Nusuk Umrah Journey (Ihram, Tawaf, Sa'i, shave/trim). Detailed Sunnah reference: the Hajj narration of Jabir in Sahih Muslim 1218. No special dua has been assigned to each Tawaf round because no authentic fixed dua for every round is established."
        }
      </div>
      <div id="rudHajjGuide" className="rud-guide-intro rud-tool-surface">
        <strong>Hajj Guide · Day by Day.</strong>
        {
          " This is the Hajj Tamattu' sequence. Hajj has recognized details that vary by Hajj type and scholarly ruling. Follow your authorized scholar/group and the Ministry of Hajj and Umrah/Nusuk movement schedule, especially for transport and Jamarat times."
        }
      </div>
      <GuideTimeline
        type="hajj"
        id="rudHajjTimeline"
        at={journey.hajj}
        onNavigate={(i) => openJourney('hajj', i)}
        onExit={() => exitJourney('hajj')}
      />
      <div className="rud-guide-note">
        {
          "Core sources used here: Qur'an 2:196–203; the detailed Hajj of Jabir in Sahih Muslim 1218; Sahih Muslim 1296a and 1300 for Jamarat; Sahih al-Bukhari 1727 for shaving; Sahih al-Bukhari 1755 for Farewell Tawaf; and current official Saudi Hajj guidance."
        }
      </div>
    </section>
  );
}
