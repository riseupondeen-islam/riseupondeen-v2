/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function DailyReflectionSection() {
  return (
    <section className="section minimal-reflection-section" id="reminder">
      <div className="site-noor warm" style={{ left: '50%', top: '4%', transform: 'translateX(-50%)' }} />
      <div className="shell">
        <div className="minimal-section-head reveal">
          <span className="eyebrow">{'For Your Heart'}</span>
          <h2 className="section-title" id="dailyHeartHeading">
            {'Explore with Intention'}
          </h2>
        </div>
        <article className="heart-reflection glass reveal heart-reflection-preview" data-delay="1">
          <div className="geo-pattern" />
          <span className="reflection-label">
            <span id="dailyHeartReference">{"QUR'AN · 13:28"}</span>
          </span>
          <blockquote>
            <span id="dailyHeartQuote">{'“Surely in the remembrance of Allah do hearts find comfort.”'}</span>
          </blockquote>
          <p className="heart-preview-copy">{'A quiet reflection for what your heart may need today.'}</p>
        </article>
      </div>
    </section>
  );
}
