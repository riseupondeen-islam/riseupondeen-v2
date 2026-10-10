/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function DeleteConfirmOverlay() {
  return (
    <div
      aria-hidden="true"
      aria-labelledby="deleteTitle"
      aria-modal="true"
      className="app-overlay"
      id="deleteOverlay"
      role="dialog"
    >
      <div className="modal-card glass" style={{ width: 'min(520px,100%)', padding: '34px', borderRadius: '28px' }}>
        <h2 id="deleteTitle" style={{ fontSize: '2rem', marginTop: '0' }}>
          {'Delete content?'}
        </h2>
        <p className="muted">{'Are you sure you want to permanently delete this content?'}</p>
        <div className="form-actions">
          <button className="premium-btn" id="cancelDelete">
            {'Cancel'}
          </button>
          <button
            className="premium-btn"
            id="confirmDelete"
            style={{ borderColor: 'rgba(255,120,120,.3)', color: '#ffd0d0' }}
          >
            {'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
