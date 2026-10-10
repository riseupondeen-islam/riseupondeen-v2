/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function AskRiseOverlay() {
  return (
    <div
      aria-hidden="true"
      aria-labelledby="askRiseTitle"
      aria-modal="true"
      className="search-overlay ask-rise-overlay"
      id="searchOverlay"
      role="dialog"
    >
      <div className="search-panel glass heart-search-panel ask-rise-panel">
        <header className="ask-rise-head">
          <div className="ask-rise-brand">
            <span className="ask-rise-kicker">{'RISE UPON DEEN · ASK RISE'}</span>
            <h2 id="askRiseTitle">{'Ask Rise'}</h2>
            <p>{'“Begin with what is on your heart.”'}</p>
            <small>{'A quiet guide to verified Duas, Hadiths, Reminders and Qur’an-based names.'}</small>
          </div>
          <div className="ask-rise-head-actions">
            <button aria-label="Close Ask Rise" className="icon-btn ask-rise-close" id="searchClose" type="button">
              {'×'}
            </button>
          </div>
        </header>
        <div aria-label="Ask Rise content scope" className="ask-rise-trustbar">
          <span>
            <i aria-hidden="true" />
            {'Verified Duas · Hadiths · Reminders · Qur’an Names'}
          </span>
          <button aria-label="Clear Ask Rise chat" className="ask-rise-clear" id="askRiseClear" type="button">
            {'Clear chat'}
          </button>
        </div>
        <div aria-live="polite" aria-relevant="additions" className="ask-rise-chat" id="askRiseChat" role="log" />
        <div aria-label="Available verified content" className="ask-rise-suggestions" id="askRiseSuggestions" />
        <form className="ask-rise-composer" id="askRiseForm">
          <div className="ask-rise-input-shell">
            <textarea
              aria-label="Message Ask Rise"
              id="askRiseInput"
              maxLength={500}
              placeholder="Ask about duas, hadiths, reminders or Qur’an names…"
              rows={1}
            />
            <div className="ask-rise-composer-actions">
              <button
                aria-label="Speak to Ask Rise"
                className="ask-rise-icon-btn"
                id="askRiseMic"
                title="Speak"
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19">
                  <rect height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5" width="7" x="8.5" y="3" />
                  <path
                    d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
              <button aria-label="Send to Ask Rise" className="ask-rise-send" id="askRiseSend" type="submit">
                <svg aria-hidden="true" fill="none" height="19" viewBox="0 0 24 24" width="19">
                  <path
                    d="m5 12 14-7-4.3 14-3.1-5.6L5 12Z"
                    stroke="currentColor"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                  <path d="m11.6 13.4 3.7-3.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
          </div>
          <div className="ask-rise-composer-meta">
            <span id="askRiseVoiceState">{'Type or speak naturally'}</span>
            <span>{'Verified content only'}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
