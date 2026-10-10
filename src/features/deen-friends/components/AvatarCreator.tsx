/* Avatar builder (Section 10): modest, faceless, illustrated avatars built from shared SVG parts.
 * Preview live, pick a preset, customise, save, or reset to the classic artwork. */
import { useState } from 'react';
import type { AvatarConfig, OwnProfile } from '../types';
import {
  ACCENTS,
  AVATAR_FIGURES,
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

  return (
    <Sheet
      title="Create your avatar"
      kicker="MODEST · ILLUSTRATED · NO FACES"
      onClose={onClose}
      wide
      footer={
        <>
          {profile.avatarConfig ? (
            <button type="button" className="df2-btn df2-btn-ghost-danger" disabled={saving} onClick={() => void save(null)}>
              Use classic avatar
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
        <div className="df2-av-preview" aria-label="Preview">
          <AvatarArt config={config} name={profile.displayName} size={132} />
          <div className="df2-av-preview-small" aria-hidden="true">
            <AvatarArt config={config} name={profile.displayName} size={44} />
            <AvatarArt config={config} name={profile.displayName} size={32} />
          </div>
          <small>How it looks on your profile, in chats and lists.</small>
        </div>
        <div className="df2-av-controls">
          <fieldset className="df2-fieldset df2-av-choices">
            <legend>Start from a style</legend>
            <div>
              {AVATAR_PRESETS.map((p) => (
                <button key={p.name} type="button" onClick={() => setConfig(p.config)}>
                  <AvatarArt config={p.config} size={44} />
                  <small>{p.name}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <Choice label="Figure" options={AVATAR_FIGURES} labels={LABELS.figure} value={config.figure} onPick={(v) => set('figure', v)} render={(v) => ({ ...config, figure: v })} />
          <Choice label="Shape" options={AVATAR_SHAPES} labels={LABELS.shape} value={config.shape} onPick={(v) => set('shape', v)} render={(v) => ({ ...config, shape: v })} />
          <Choice label="Pattern" options={AVATAR_PATTERNS} labels={LABELS.pattern} value={config.pattern} onPick={(v) => set('pattern', v)} render={(v) => ({ ...config, pattern: v })} />
          <Choice label="Motif" options={AVATAR_MOTIFS} labels={LABELS.motif} value={config.motif} onPick={(v) => set('motif', v)} render={(v) => ({ ...config, motif: v })} />
          <Swatches label="Background" map={BACKGROUNDS} value={config.background} onPick={(k) => set('background', k)} />
          <Swatches label="Clothing colour" map={OUTFITS} value={config.outfit} onPick={(k) => set('outfit', k)} />
          <Swatches label="Accent" map={ACCENTS} value={config.accent} onPick={(k) => set('accent', k)} />
          <label className="df2-toggle">
            <input type="checkbox" checked={config.initials} onChange={(e) => set('initials', e.target.checked)} />
            <span>
              <strong>Show my initials</strong>
              <small>A small badge with the first letters of your display name.</small>
            </span>
          </label>
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
