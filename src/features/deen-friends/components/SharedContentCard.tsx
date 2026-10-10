/* A piece of shared Islamic content inside a chat (friend chat or Deen circle) — Section 21.
 * Shows the complete Arabic (right-to-left), transliteration, translation and reference/source.
 * Older messages saved with V2's 300-character limit are completed from the app's verified sources
 * (services/sharedContent.ts); missing fields are omitted, never invented. */
import { memo, useEffect, useState, type ReactNode } from 'react';
import type { SharedContent } from '../types';
import { completeSharedContent, looksTruncated } from '../services/sharedContent';
import { Icon, Sheet, useToast } from './ui';

export const CONTENT_LABEL: Record<string, string> = {
  quran: 'Qur’an',
  dua: 'Dua',
  hadith: 'Hadith',
  zikr: 'Dhikr',
  reminder: 'Reminder',
};

const ICON: Record<string, 'book' | 'beads' | 'hands' | 'scroll'> = {
  quran: 'book',
  zikr: 'beads',
  dua: 'hands',
  hadith: 'scroll',
  reminder: 'scroll',
};

function useCompleteContent(stored: SharedContent): { content: SharedContent; status: 'ok' | 'completing' } {
  const [content, setContent] = useState(stored);
  const [status, setStatus] = useState<'ok' | 'completing'>(looksTruncated(stored) ? 'completing' : 'ok');
  useEffect(() => {
    setContent(stored);
    if (!looksTruncated(stored)) {
      setStatus('ok');
      return;
    }
    let cancelled = false;
    setStatus('completing');
    completeSharedContent(stored)
      .then((full) => {
        if (!cancelled) setContent(full);
      })
      .finally(() => {
        if (!cancelled) setStatus('ok');
      });
    return () => {
      cancelled = true;
    };
  }, [stored]);
  return { content, status };
}

function Paragraphs({ text, className, lang, dir }: { text: string; className?: string; lang?: string; dir?: string }) {
  const parts = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className={className} lang={lang} dir={dir}>
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function ContentBody({ content }: { content: SharedContent }) {
  const translation = content.translation || content.preview || '';
  const attribution = [content.reference, content.source && content.source !== content.reference ? content.source : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {content.arabic ? <Paragraphs text={content.arabic} className="df2-arabic df2-shared-arabic" lang="ar" dir="rtl" /> : null}
      {content.transliteration ? <Paragraphs text={content.transliteration} className="df2-shared-translit" /> : null}
      {translation ? <Paragraphs text={translation} className="df2-shared-translation" /> : null}
      {attribution ? <small className="df2-reference">{attribution}</small> : null}
    </>
  );
}

export const SharedContentCard = memo(function SharedContentCard({
  stored,
  mine,
  fromLabel,
  meta,
}: {
  stored: SharedContent;
  mine: boolean;
  fromLabel: string;
  meta?: ReactNode;
}) {
  const { content, status } = useCompleteContent(stored);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const long = (content.arabic || '').length + (content.translation || content.preview || '').length > 900;
  return (
    <article className={`df2-msg df2-msg-card df2-shared ${mine ? 'mine' : 'theirs'}`}>
      <header className="df2-card-kicker">
        <span>
          <Icon name={ICON[content.type] || 'scroll'} size={15} /> {CONTENT_LABEL[content.type] || 'Shared'}
        </span>
        <b>{fromLabel}</b>
      </header>
      <h3>{content.title}</h3>
      <ContentBody content={content} />
      {status === 'completing' ? <small className="df2-inline-note">Loading the complete text…</small> : null}
      <div className="df2-shared-actions">
        {long ? (
          <button type="button" className="df2-link-btn" onClick={() => setOpen(true)}>
            Read in full screen
          </button>
        ) : null}
        <button
          type="button"
          className="df2-link-btn"
          onClick={async () => {
            const text = [content.title, content.arabic, content.transliteration, content.translation || content.preview, [content.reference, content.source].filter(Boolean).join(' · ')]
              .filter(Boolean)
              .join('\n\n');
            try {
              await navigator.clipboard.writeText(text);
              toast('Copied with its reference.', 'success');
            } catch {
              toast('Copying isn’t available here.', 'error');
            }
          }}
        >
          Copy
        </button>
      </div>
      {meta}
      {open ? (
        <Sheet title={content.title} kicker={CONTENT_LABEL[content.type] || 'Shared'} onClose={() => setOpen(false)} wide>
          <div className="df2-shared-reader">
            <ContentBody content={content} />
          </div>
        </Sheet>
      ) : null}
    </article>
  );
});
