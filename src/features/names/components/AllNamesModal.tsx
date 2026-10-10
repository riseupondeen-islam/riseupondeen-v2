/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function AllNamesModal() {
  return (
    <div
      aria-hidden="true"
      aria-labelledby="allNamesTitle"
      aria-modal="true"
      className="all-names-modal"
      id="allNamesModal"
      role="dialog"
    >
      <div className="all-names-panel">
        <div className="all-names-head">
          <div>
            <span className="eyebrow">{'Names of Allah'}</span>
            <h2 id="allNamesTitle">{'The 99 Beautiful Names'}</h2>
          </div>
          <button aria-label="Close all Names" className="all-names-close" id="allNamesClose" type="button">
            {'×'}
          </button>
        </div>
        <div className="all-names-grid" id="allNamesGrid" />
        <button
          aria-label="Close 99 Names"
          className="all-names-floating-close"
          id="allNamesFloatingClose"
          type="button"
        >
          {'\n        ×\n      '}
        </button>
      </div>
    </div>
  );
}
