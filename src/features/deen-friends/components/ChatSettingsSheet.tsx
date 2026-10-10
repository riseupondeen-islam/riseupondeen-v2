/* Conversation settings: wallpaper theme (stored on this device) and Clear chat. */
import { useState } from 'react';
import { friendlyMessage, logError } from '../services/errors';
import { clearConversation } from '../services/interactionService';
import { ConfirmSheet, Sheet, useToast } from './ui';

export const CHAT_THEMES = [
  { id: 'ivory', name: 'Ivory Pearl', note: 'Warm & minimal' },
  { id: 'noor', name: 'Noor Gold', note: 'Golden calm' },
  { id: 'madinah', name: 'Madinah', note: 'Garden green' },
  { id: 'layl', name: 'Layl Night', note: 'Deep night' },
  { id: 'sahara', name: 'Sahara', note: 'Desert warmth' },
  { id: 'rose', name: 'Rose Dawn', note: 'Soft dawn' },
] as const;

export type ChatThemeId = (typeof CHAT_THEMES)[number]['id'];

const themeKey = (id: string) => `rud_df_chat_theme_${id}`;

export function readChatTheme(conversationId: string): ChatThemeId {
  try {
    const value = localStorage.getItem(themeKey(conversationId));
    return (CHAT_THEMES.find((t) => t.id === value)?.id || 'ivory') as ChatThemeId;
  } catch {
    return 'ivory';
  }
}

export function saveChatTheme(conversationId: string, theme: ChatThemeId): void {
  try {
    localStorage.setItem(themeKey(conversationId), theme);
  } catch {
    /* device storage blocked: the theme applies for this visit only */
  }
}

export function ChatSettingsSheet({
  conversationId,
  theme,
  onTheme,
  canClear,
  onCleared,
  onClose,
}: {
  conversationId: string;
  theme: ChatThemeId;
  onTheme: (theme: ChatThemeId) => void;
  canClear: boolean;
  onCleared: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Sheet title="Chat settings" kicker="THIS CONVERSATION" onClose={onClose}>
        <h3 className="df2-subhead">Background</h3>
        <div className="df2-theme-grid">
          {CHAT_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`df2-theme-option${theme === t.id ? ' active' : ''}`}
              aria-pressed={theme === t.id}
              onClick={() => {
                saveChatTheme(conversationId, t.id);
                onTheme(t.id);
              }}
            >
              <span className="df2-theme-preview" data-chat-theme={t.id}>
                <i />
                <i className="mine" />
              </span>
              <strong>{t.name}</strong>
              <small>{t.note}</small>
            </button>
          ))}
        </div>
        <p className="df2-footnote">Backgrounds are saved on this device only.</p>
        {canClear ? (
          <>
            <h3 className="df2-subhead">Conversation</h3>
            <button type="button" className="df2-btn df2-btn-danger df2-btn-block" onClick={() => setConfirming(true)}>
              Clear chat
            </button>
          </>
        ) : null}
      </Sheet>
      {confirming ? (
        <ConfirmSheet
          title="Clear this chat?"
          danger
          confirmLabel="Clear chat"
          message={
            <>
              <p>
                Everything <strong>you sent</strong> here is deleted for both of you (challenges that are still active
                are kept). Your friend’s earlier items are hidden on this device.
              </p>
              <p className="df2-muted">This cannot be undone.</p>
            </>
          }
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              const removed = await clearConversation(conversationId);
              toast(removed ? 'Chat cleared.' : 'Chat cleared on this device.', 'success');
              setConfirming(false);
              onCleared();
              onClose();
            } catch (err) {
              logError('clear chat', err);
              toast(friendlyMessage(err), 'error');
            }
          }}
        />
      ) : null}
    </>
  );
}
