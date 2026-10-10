/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */
/* First-visit name prompt (behaviour: features/visitor). */

export function WelcomeIntro() {
  return (
    <div aria-hidden="true" hidden id="rudWelcomeIntro">
      {'\n'}
      <section aria-labelledby="rudWelcomeTitle" aria-modal="true" className="rud-welcome-card" role="dialog">
        {'\n'}
        <div aria-hidden="true" className="rud-welcome-mark" />
        {'\n'}
        <p className="rud-welcome-kicker">{'RISE UPON DEEN'}</p>
        {'\n'}
        <h1 id="rudWelcomeTitle">{'Welcome'}</h1>
        {'\n'}
        <p className="rud-welcome-copy">{'Before you begin, what should we call you?'}</p>
        {'\n'}
        <form autoComplete="off" id="rudWelcomeForm">
          {'\n'}
          <input
            autoComplete="name"
            id="rudVisitorName"
            maxLength={50}
            name="visitorName"
            placeholder="Enter your name"
            required
            type="text"
          />
          {'\n'}
          <button id="rudWelcomeContinue" type="submit">
            {'Enter Rise Upon Deen'}
          </button>
          {'\n'}
        </form>
        {'\n'}
        <p className="rud-welcome-privacy">{'Your name is used only for your Rise Upon Deen visitor analytics.'}</p>
        {'\n'}
      </section>
      {'\n'}
    </div>
  );
}
