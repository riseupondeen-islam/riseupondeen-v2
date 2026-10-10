/* Markup migrated verbatim from the original index.html (static app shell).
   Text nodes are explicit string literals so whitespace and wording are preserved exactly.
   Legacy feature controllers attach behaviour to these elements by id/class after mount. */

export function ExploreDrawer() {
  return (
    <div aria-hidden="true" className="rud-explore-drawer" id="rudExploreDrawer">
      {'\n'}
      <button aria-label="Close Explore" className="rud-explore-backdrop" data-rud-explore-close="" type="button" />
      {'\n'}
      <aside aria-labelledby="rudExploreTitle" aria-modal="true" className="rud-explore-panel" role="dialog">
        {'\n'}
        <header className="rud-explore-head">
          <div>
            <span className="rud-explore-kicker">{'RISE UPON DEEN'}</span>
            <h2 id="rudExploreTitle">{'Explore'}</h2>
            <p>{'Everything you need, without crowding your screen.'}</p>
          </div>
          <button aria-label="Close Explore" className="rud-explore-close" data-rud-explore-close="" type="button">
            {'×'}
          </button>
        </header>
        {'\n'}
        <section className="rud-explore-group">
          <span className="rud-explore-group-title">{'Your space'}</span>
          <nav aria-label="Primary" className="rud-explore-links">
            <a className="rud-explore-link" data-rud-explore-route="home" href="#home">
              {'Home'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="quran" href="#quran">
              {"Qur'an"}
            </a>
            <button className="rud-explore-link" id="rudExploreAskRise" type="button">
              {'Ask Rise'}
            </button>
            <a className="rud-explore-link" data-rud-explore-route="my-deen" href="#my-deen">
              {'My Deen'}
            </a>
            <button className="rud-explore-link" hidden id="rudExploreInstall" type="button">
              {'Install Rise Upon Deen'}
            </button>
          </nav>
        </section>
        {'\n'}
        <section className="rud-explore-group">
          <span className="rud-explore-group-title">{'Read & reflect'}</span>
          <nav aria-label="Knowledge" className="rud-explore-links">
            <a className="rud-explore-link" data-rud-explore-route="duas" href="#duas">
              {'Duas'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="hadith" href="#hadith">
              {'Hadith'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="reminders" href="#reminders">
              {'Reminders'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="names" href="#names">
              {'99 Names of Allah'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="saved" href="#saved">
              {'Collection'}
            </a>
          </nav>
        </section>
        {'\n'}
        <section className="rud-explore-group">
          <span className="rud-explore-group-title">{'Practice'}</span>
          <nav aria-label="Tools" className="rud-explore-links">
            <a className="rud-explore-link" data-rud-explore-route="prayer" href="#prayer">
              {'Prayer & Qiblah'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="tasbih" href="#tasbih">
              {'Tasbih'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="umrah" href="#umrah">
              {'Hajj & Umrah'}
            </a>
            <a className="rud-explore-link" data-rud-explore-route="tracker" href="#tracker">
              {'Zakat & Sadaqah'}
            </a>
          </nav>
        </section>
        {'\n'}
        <div className="rud-explore-foot">{'Free · local-first · no premium · no paywall'}</div>
        {'\n'}
      </aside>
      {'\n'}
    </div>
  );
}
