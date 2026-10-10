/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function GuidanceSection() {
  return (
    <section className="section guidance-ribbon-section" id="spotlight">
      <div className="shell">
        <div className="guidance-ribbon-head reveal">
          <span className="eyebrow">{'Pause & Return'}</span>
          <h2 className="section-title">{'Guidance for the Heart'}</h2>
        </div>
        <div className="guidance-ribbon">
          <article className="guidance-ribbon-item guidance-ribbon-dua reveal" id="homeDuaSpotlight">
            <div className="guidance-ribbon-copy">
              <strong>{'Turn to Allah.'}</strong>
              <span>{'Explore Duas.'}</span>
            </div>
            <a aria-label="Explore Duas" className="guidance-ribbon-link" data-public-route="#duas" href="#duas">
              {'\n              Explore Duas '}
              <i>{'↗'}</i>
            </a>
          </article>
          <div aria-hidden="true" className="guidance-ribbon-divider">
            <span />
          </div>
          <article
            className="guidance-ribbon-item guidance-ribbon-hadith reveal"
            data-delay="1"
            id="homeHadithSpotlight"
          >
            <div className="guidance-ribbon-copy">
              <strong>{'Prophetic Guidance.'}</strong>
              <span>{'Explore Hadith.'}</span>
            </div>
            <a aria-label="Explore Hadith" className="guidance-ribbon-link" data-public-route="#hadith" href="#hadith">
              {'\n              Explore Hadith '}
              <i>{'↗'}</i>
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
