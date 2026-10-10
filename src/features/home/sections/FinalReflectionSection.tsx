/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function FinalReflectionSection() {
  return (
    <section className="reflection final-visual-reflection" id="reflection">
      <div aria-hidden="true" className="reflection-orbit" />
      <div className="reflection-sky parallax-scroll" data-scroll-speed=".04">
        <div className="reflection-stars" id="reflectionStars" />
        <div className="cloud c2" style={{ top: '5%', right: '-15%', opacity: '.07' }} />
        <div className="mountains">
          <span className="mountain a" />
          <span className="mountain b" />
          <span className="mountain c" />
        </div>
      </div>
      <div className="shell reflection-content">
        <span className="eyebrow reveal">{'Reflection'}</span>
        <h2 className="reveal" data-delay="1">
          {'This Duniya Is Not Your Final Home'}
        </h2>
        <p>{'Return to Allah.'}</p>
      </div>
    </section>
  );
}
