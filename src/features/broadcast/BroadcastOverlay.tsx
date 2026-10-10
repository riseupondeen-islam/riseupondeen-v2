/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* Admin broadcast overlay (behaviour: features/analytics/broadcast). */

export function BroadcastOverlay() {
  return (
    <div aria-hidden="true" id="rudBroadcastOverlay">
      {'\n'}
      <div aria-hidden="true" className="rud-broadcast-noor" />
      {'\n'}
      <div aria-hidden="true" className="rud-broadcast-kaaba" />
      {'\n'}
      <section aria-labelledby="rudBroadcastTitle" aria-modal="true" className="rud-broadcast-card" role="dialog">
        {'\n'}
        <div aria-hidden="true" className="rud-broadcast-line" />
        {'\n'}
        <p className="rud-broadcast-kicker">{'RISE UPON DEEN'}</p>
        {'\n'}
        <h2 id="rudBroadcastTitle">{'A Reminder for You'}</h2>
        {'\n'}
        <p id="rudBroadcastMessage" />
        {'\n'}
        <button id="rudBroadcastDismiss" type="button">
          {'Continue'}
        </button>
        {'\n'}
      </section>
      {'\n'}
    </div>
  );
}
