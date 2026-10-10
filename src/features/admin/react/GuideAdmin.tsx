/* Admin › App Guide — manage the first-run walkthrough and the App Guide tours (Section 13).
 *
 * Draft → Preview → Publish. The draft lives in rud_app_guides/draft; publishing copies it to
 * rud_app_guides/published with the next version number (firestore.rules: community-level admins).
 * Preview opens the public site in a new tab and runs the draft there without saving any progress. */
import { useEffect, useMemo, useState } from 'react';
import { toast } from '../../../utils/ui';
import {
  DEFAULT_GUIDE,
  safeSelector,
  sanitizeGuide,
  type GuideAction,
  type GuideConfig,
  type GuideLayout,
  type GuideStep,
  type GuideTour,
} from '../../onboarding/guideConfig';
import { loadGuideDraft, publishGuide, saveGuideDraft } from '../../onboarding/guideService';

const PREVIEW_KEY = 'rud_app_guide_preview';
const LAYOUTS: GuideLayout[] = ['all', 'mobile', 'desktop'];
const ACTIONS: GuideAction[] = ['none', 'open-explore', 'close-explore', 'open-install'];

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function GuideAdmin() {
  const [config, setConfig] = useState<GuideConfig | null>(null);
  const [published, setPublished] = useState<GuideConfig | null>(null);
  const [openTour, setOpenTour] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadGuideDraft()
      .then(({ draft, published: pub }) => {
        setConfig(draft);
        setPublished(pub);
      })
      .catch((err) => {
        setError(String(err?.message || 'The App Guide settings could not be loaded. Your role may not allow this.'));
        setConfig(DEFAULT_GUIDE);
      });
  }, []);

  const problems = useMemo(() => {
    if (!config) return [];
    const out: string[] = [];
    if (!config.tours.some((t) => t.id === config.firstRunTourId)) out.push('The first-run tour does not exist.');
    const ids = new Set<string>();
    for (const tour of config.tours) {
      if (ids.has(tour.id)) out.push(`Two tours share the id “${tour.id}”.`);
      ids.add(tour.id);
      tour.steps.forEach((s, i) => {
        if (s.target && !safeSelector(s.target)) out.push(`${tour.title} · step ${i + 1}: the target is not a valid CSS selector.`);
        if (s.route && !s.route.startsWith('#')) out.push(`${tour.title} · step ${i + 1}: routes start with #.`);
      });
      if (tour.enabled && !tour.steps.length) out.push(`${tour.title} has no steps.`);
    }
    return out;
  }, [config]);

  if (!config) return <p className="df2-inline-note">Loading App Guide…</p>;

  const update = (next: GuideConfig) => {
    setConfig(next);
    setDirty(true);
  };
  const updateTour = (id: string, patch: Partial<GuideTour>) =>
    update({ ...config, tours: config.tours.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const updateStep = (tour: GuideTour, index: number, patch: Partial<GuideStep>) =>
    updateTour(tour.id, { steps: tour.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      const message = String((err as Error)?.message || err);
      setError(/permission/i.test(message) ? 'Your admin role cannot change the App Guide.' : message);
    } finally {
      setBusy('');
    }
  }

  const preview = (tourId?: string) => {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify({ config: sanitizeGuide(config), tourId: tourId || config.firstRunTourId, at: Date.now() }));
    } catch {
      toast('Preview needs browser storage, which is blocked here.', 'error');
      return;
    }
    window.open(`${location.pathname}#home`, '_blank', 'noopener');
  };

  return (
    <section className="df2-admin-view rud-guide-admin">
      <header className="df2-admin-head">
        <div>
          <span className="df2-kicker">ONBOARDING · APP GUIDE</span>
          <h1>App Guide</h1>
          <p>
            First-run walkthrough and the tours in Explore → App Guide. Published version: <strong>{published ? `v${published.version}` : 'none (built-in default in use)'}</strong>
            {dirty ? ' · unsaved changes' : ''}
          </p>
        </div>
        <div className="df2-admin-actions">
          <button type="button" className="df2-btn df2-btn-sm" onClick={() => preview()}>
            Preview
          </button>
          <button
            type="button"
            className="df2-btn df2-btn-sm"
            disabled={!!busy}
            onClick={() =>
              run('save', async () => {
                await saveGuideDraft(config);
                setDirty(false);
                toast('Draft saved.');
              })
            }
          >
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            className="df2-btn df2-btn-sm df2-btn-primary"
            disabled={!!busy || problems.length > 0}
            onClick={() =>
              run('publish', async () => {
                const next = await publishGuide(config, published);
                setConfig(next);
                setPublished(next);
                setDirty(false);
                toast(`App Guide v${next.version} published.`);
              })
            }
          >
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>
      {error ? <p className="df2-form-error">{error}</p> : null}
      {problems.length ? (
        <ul className="df2-form-error rud-guide-admin-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <div className="df2-card rud-guide-admin-general">
        <label className="df2-toggle">
          <input type="checkbox" checked={config.enabled} onChange={(e) => update({ ...config, enabled: e.target.checked })} />
          <span>Offer the first-run walkthrough to new visitors</span>
        </label>
        <label className="df2-field">
          <span>First-run tour</span>
          <select value={config.firstRunTourId} onChange={(e) => update({ ...config, firstRunTourId: e.target.value })}>
            {config.tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="df2-field">
          <span>Show first-run again to everyone who finished before version</span>
          <input
            type="number"
            min={1}
            value={config.reshowOnVersion}
            onChange={(e) => update({ ...config, reshowOnVersion: Math.max(1, Number(e.target.value) || 1) })}
          />
          <small>Leave at 1 so people who already took the tour are not interrupted. Raise it only for a major change.</small>
        </label>
        <div className="df2-chip-row">
          <button
            type="button"
            className="df2-btn df2-btn-sm"
            onClick={() => {
              const id = `tour-${Date.now().toString(36)}`;
              update({
                ...config,
                tours: [...config.tours, { id, title: 'New tour', summary: '', enabled: false, layout: 'all', steps: [] }],
              });
              setOpenTour(id);
            }}
          >
            Add tour
          </button>
          <button type="button" className="df2-btn df2-btn-sm" onClick={() => update({ ...DEFAULT_GUIDE, version: config.version })}>
            Reset to built-in guide
          </button>
        </div>
      </div>

      <div className="df2-admin-list">
        {config.tours.map((tour, ti) => (
          <div key={tour.id} className="df2-card rud-guide-admin-tour">
            <div className="rud-guide-admin-tour-head">
              <button type="button" className="df2-link-btn" onClick={() => setOpenTour(openTour === tour.id ? '' : tour.id)} aria-expanded={openTour === tour.id}>
                <strong>{tour.title}</strong> <small>({tour.steps.length} steps{tour.enabled ? '' : ', hidden'})</small>
              </button>
              <div className="df2-admin-actions">
                <button type="button" className="df2-btn df2-btn-sm" aria-label="Move tour up" onClick={() => update({ ...config, tours: move(config.tours, ti, ti - 1) })}>
                  ↑
                </button>
                <button type="button" className="df2-btn df2-btn-sm" aria-label="Move tour down" onClick={() => update({ ...config, tours: move(config.tours, ti, ti + 1) })}>
                  ↓
                </button>
                <button type="button" className="df2-btn df2-btn-sm" onClick={() => preview(tour.id)}>
                  Preview
                </button>
              </div>
            </div>
            {openTour === tour.id ? (
              <div className="rud-guide-admin-tour-body">
                <div className="rud-guide-admin-grid">
                  <label className="df2-field">
                    <span>Title</span>
                    <input value={tour.title} maxLength={80} onChange={(e) => updateTour(tour.id, { title: e.target.value })} />
                  </label>
                  <label className="df2-field">
                    <span>Layouts</span>
                    <select value={tour.layout} onChange={(e) => updateTour(tour.id, { layout: e.target.value as GuideLayout })}>
                      {LAYOUTS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="df2-field rud-guide-admin-wide">
                    <span>Summary</span>
                    <input value={tour.summary} maxLength={200} onChange={(e) => updateTour(tour.id, { summary: e.target.value })} />
                  </label>
                  <label className="df2-toggle">
                    <input type="checkbox" checked={tour.enabled} onChange={(e) => updateTour(tour.id, { enabled: e.target.checked })} />
                    <span>Show in the App Guide</span>
                  </label>
                  <button
                    type="button"
                    className="df2-btn df2-btn-sm df2-btn-danger"
                    onClick={() => update({ ...config, tours: config.tours.filter((t) => t.id !== tour.id) })}
                    disabled={tour.id === config.firstRunTourId}
                    title={tour.id === config.firstRunTourId ? 'Choose another first-run tour first' : undefined}
                  >
                    Delete tour
                  </button>
                </div>
                <ol className="rud-guide-admin-steps">
                  {tour.steps.map((step, si) => (
                    <li key={`${step.id}-${si}`} className="rud-guide-admin-step">
                      <div className="rud-guide-admin-grid">
                        <label className="df2-field">
                          <span>Title</span>
                          <input value={step.title} maxLength={120} onChange={(e) => updateStep(tour, si, { title: e.target.value })} />
                        </label>
                        <label className="df2-field">
                          <span>Route</span>
                          <input value={step.route} placeholder="#quran (empty = stay)" maxLength={120} onChange={(e) => updateStep(tour, si, { route: e.target.value.trim() })} />
                        </label>
                        <label className="df2-field rud-guide-admin-wide">
                          <span>Target element (CSS selector)</span>
                          <input
                            value={step.target}
                            placeholder='e.g. #rudTasbihTap or [data-tour="nav-home"] (empty = centred card)'
                            maxLength={300}
                            aria-invalid={!safeSelector(step.target)}
                            onChange={(e) => updateStep(tour, si, { target: e.target.value })}
                          />
                        </label>
                        <label className="df2-field rud-guide-admin-wide">
                          <span>Explanation</span>
                          <textarea rows={2} value={step.body} maxLength={600} onChange={(e) => updateStep(tour, si, { body: e.target.value })} />
                        </label>
                        <label className="df2-field">
                          <span>Layouts</span>
                          <select value={step.layout} onChange={(e) => updateStep(tour, si, { layout: e.target.value as GuideLayout })}>
                            {LAYOUTS.map((l) => (
                              <option key={l}>{l}</option>
                            ))}
                          </select>
                        </label>
                        <label className="df2-field">
                          <span>Before showing</span>
                          <select value={step.action} onChange={(e) => updateStep(tour, si, { action: e.target.value as GuideAction })}>
                            {ACTIONS.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="df2-admin-actions">
                        <button type="button" className="df2-btn df2-btn-sm" aria-label="Move step up" onClick={() => updateTour(tour.id, { steps: move(tour.steps, si, si - 1) })}>
                          ↑
                        </button>
                        <button type="button" className="df2-btn df2-btn-sm" aria-label="Move step down" onClick={() => updateTour(tour.id, { steps: move(tour.steps, si, si + 1) })}>
                          ↓
                        </button>
                        <button type="button" className="df2-btn df2-btn-sm df2-btn-danger" onClick={() => updateTour(tour.id, { steps: tour.steps.filter((_, i) => i !== si) })}>
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="df2-btn df2-btn-sm"
                  onClick={() =>
                    updateTour(tour.id, {
                      steps: [
                        ...tour.steps,
                        { id: `step-${Date.now().toString(36)}`, route: '', target: '', title: 'New step', body: '', layout: 'all', action: 'none' },
                      ],
                    })
                  }
                >
                  Add step
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
