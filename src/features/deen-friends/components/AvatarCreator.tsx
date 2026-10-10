/* Avatar builder: modest, faceless, illustrated avatars built from shared SVG parts.
 * A large live preview, then three tabs — Style (presets, figure), Shape (frame, pattern, motif)
 * and Colours (background, clothing, accent). Save, reset, or return to the classic artwork. */
import { useState } from 'react';
import type { AvatarConfig, OwnProfile } from '../types';
import {
  ACCENTS,
  MEN_FIGURES,
  WOMEN_FIGURES,
  AVATAR_MOTIFS,
  AVATAR_PATTERNS,
  AVATAR_PRESETS,
  AVATAR_SHAPES,
  BACKGROUNDS,
  DEFAULT_AVATAR_CONFIG,
  LABELS,
  OUTFITS,
} from '../../../components/avatar/avatarConfig';
import { AvatarArt } from '../../../components/avatar/AvatarArt';
import { saveOwnProfile } from '../services/accountService';
import { friendlyMessage, logError } from '../services/errors';
import { updateOwnProfile } from '../state/deenFriendsStore';
import { Sheet, useToast } from './ui';

function Swatches({ label, map, value, onPick }: { label: string; map: Record<string, string>; value: string; onPick: (k: string) => void }) {
  return (
    <fieldset className="df2-fieldset df2-av-swatches">
      <legend>{label}</legend>
      <div role="radiogroup" aria-label={label}>
        {Object.entries(map).map(([key, color]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            aria-label={key}
            title={key}
            className={value === key ? 'active' : ''}
            style={{ background: color }}
            onClick={() => onPick(key)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({ label, options, labels, value, onPick, render }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onPick: (v: T) => void; render: (v: T) => AvatarConfig }) {
  return (
    <fieldset className="df2-fieldset df2-av-choices">
      <legend>{label}</legend>
      <div role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button key={opt} type="button" role="radio" aria-checked={value === opt} className={value === opt ? 'active' : ''} onClick={() => onPick(opt)}>
            <AvatarArt config={render(opt)} size={44} />
            <small>{labels[opt]}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function AvatarCreator({ profile, onClose }: { profile: OwnProfile; onClose: () => void }) {
  const toast = useToast();
  const [config, setConfig] = useState<AvatarConfig>(profile.avatarConfig || DEFAULT_AVATAR_CONFIG);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));

  async function save(next: AvatarConfig | null) {
    setSaving(true);
    setError('');
    try {
      const saved = await saveOwnProfile(profile, {
        displayName: profile.displayName,
        avatar: profile.avatar,
        bio: profile.bio,
        deenFocus: profile.deenFocus,
        currentFocus: profile.currentFocus,
        favoriteSurah: profile.favoriteSurah,
        languages: profile.languages,
        field: profile.field,
        privacy: profile.privacy,
        avatarConfig: next,
      });
      updateOwnProfile(saved);
      toast(next ? 'Your avatar is saved.' : 'Back to your classic avatar.', 'success');
      onClose();
    } catch (err) {
      logError('avatar save', err);
      setError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const [tab, setTab] = useState<'style' | 'shape' | 'colours'>('style');
  const TABS = [
    { id: 'style', label: 'Style' },
    { id: 'shape', label: 'Shape' },
    { id: 'colours', label: 'Colours' },
  ] as const;

  return (
    <Sheet
      title="Your avatar"
      onClose={onClose}
      wide
      footer={
        <>
          {profile.avatarConfig ? (
            <button type="button" className="df2-btn df2-btn-ghost-danger" disabled={saving} onClick={() => void save(null)}>
              Use classic
            </button>
          ) : null}
          <button type="button" className="df2-btn" disabled={saving} onClick={() => setConfig(DEFAULT_AVATAR_CONFIG)}>
            Reset
          </button>
          <button type="button" className="df2-btn df2-btn-primary" disabled={saving} onClick={() => void save(config)}>
            {saving ? 'Saving…' : 'Save avatar'}
          </button>
        </>
      }
    >
      <div className="df2-av-layout">
        <div className="df2-av-stage" aria-label="Preview">
          <span className="df2-av-stage-shine" aria-hidden="true" />
          <div className="df2-av-stage-art">
            <AvatarArt config={config} name={profile.displayName} size={148} />
          </div>
          <div className="df2-av-preview-small" aria-hidden="true">
            <AvatarArt config={config} name={profile.displayName} size={44} />
            <AvatarArt config={config} name={profile.displayName} size={30} />
          </div>
        </div>
        <div className="df2-av-controls">
          <div className="df2-segmented df2-av-tabs" role="tablist" aria-label="Avatar options">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'style' ? (
            <>
              <fieldset className="df2-fieldset df2-av-choices">
                <legend>Presets</legend>
                <div>
                  {AVATAR_PRESETS.map((p) => (
                    <button key={p.name} type="button" onClick={() => setConfig(p.config)}>
                      <AvatarArt config={p.config} size={52} />
                      <small>{p.name}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <Choice label="Brothers" options={MEN_FIGURES} labels={LABELS.figure} value={config.figure} onPick={(v) => set('figure', v)} render={(v) => ({ ...config, figure: v })} />
              <Choice label="Sisters" options={WOMEN_FIGURES} labels={LABELS.figure} value={config.figure} onPick={(v) => set('figure', v)} render={(v) => ({ ...config, figure: v })} />
              <Choice label="No figure" options={['none'] as const} labels={LABELS.figure} value={config.figure} onPick={(v) => set('figure', v)} render={(v) => ({ ...config, figure: v })} />
              <label className="df2-toggle">
                <input type="checkbox" checked={config.initials} onChange={(e) => set('initials', e.target.checked)} />
                <span>
                  <strong>Show my initials</strong>
                </span>
              </label>
            </>
          ) : null}
          {tab === 'shape' ? (
            <>
              <Choice label="Frame" options={AVATAR_SHAPES} labels={LABELS.shape} value={config.shape} onPick={(v) => set('shape', v)} render={(v) => ({ ...config, shape: v })} />
              <Choice label="Pattern" options={AVATAR_PATTERNS} labels={LABELS.pattern} value={config.pattern} onPick={(v) => set('pattern', v)} render={(v) => ({ ...config, pattern: v })} />
              <Choice label="Motif" options={AVATAR_MOTIFS} labels={LABELS.motif} value={config.motif} onPick={(v) => set('motif', v)} render={(v) => ({ ...config, motif: v })} />
            </>
          ) : null}
          {tab === 'colours' ? (
            <>
              <Swatches label="Background" map={BACKGROUNDS} value={config.background} onPick={(k) => set('background', k)} />
              <Swatches label="Clothing" map={OUTFITS} value={config.outfit} onPick={(k) => set('outfit', k)} />
              <Swatches label="Accent" map={ACCENTS} value={config.accent} onPick={(k) => set('accent', k)} />
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="df2-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
