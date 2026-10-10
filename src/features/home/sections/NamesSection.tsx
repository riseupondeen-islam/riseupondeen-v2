/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function NamesSection() {
  return (
    <section className="section names-minimal-section" id="names">
      <div className="site-noor cool" style={{ left: '50%', top: '20%', transform: 'translateX(-50%)' }} />
      <div className="shell">
        <div className="minimal-section-head centered reveal">
          <span className="eyebrow">{'Names of Allah'}</span>
          <h2 className="section-title">{'The Beautiful Names'}</h2>
          <p className="section-copy">{'Know Allah through His Beautiful Names.'}</p>
        </div>
        <div className="names-grid minimal-names-grid" id="namesGrid" />
        <div className="names-section-action">
          <a className="names-all-btn" href="#names/" id="viewAllNamesBtn">
            {'View All '}
            <span>{'→'}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
