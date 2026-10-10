/**
 * Live home content: daily reflection, featured cards, Names preview, social links, site copy and discovery bindings.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { orderNamesForDisplay } from '../names/nameOrder';
import { S } from '../../runtime/store';

import { rudSyncFridayMode, rudSyncSmartHome } from '../my-deen/myDeen';
import { $, $$, coarsePointer, dailyPick } from '../../runtime/core';
import { SOCIAL_LINKS } from '../../services/firebase/config';
import { dateText, esc, excerpt, label, millis, route, safeUrl } from '../../utils/ui';

let homeLatestType, bindSpotlightLight;

/* ==============================
   LIVE HOME CONTENT
================================ */
function mediaBlock(i) {
  const url = safeUrl(i.mediaUrl);
  if (!url) return '';
  const type = String(i.mediaType || '');
  if (type.startsWith('image/'))
    return `<img class="reader-img" src="${esc(url)}" alt="${esc(i.mediaName || i.title || 'Uploaded image')}" loading="lazy">`;
  if (type.startsWith('audio/'))
    return `<div class="reader-attachment"><audio controls preload="metadata" src="${esc(url)}"></audio></div>`;
  return `<div class="reader-attachment"><a class="premium-btn small" href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(i.mediaName || 'Attachment')} ↗</a></div>`;
}
function card(i, featured = false) {
  const img = safeUrl(i.image);
  const style = img
    ? `style="background-image:linear-gradient(to top,rgba(3,4,5,.96),rgba(3,4,5,.24) 62%,rgba(3,4,5,.36)),url('${esc(img)}')"`
    : '';

  if (i.type === 'reminder') {
    return `<article class="compact-guidance-card reminder-preview-card ${featured ? 'featured-live' : ''}"><a class="compact-guidance-link" href="${route(i)}" aria-label="${esc(`Open ${i.title || 'Reminder'}`)}"><span class="compact-guidance-type">Reminder</span><h3>${esc(i.title || 'Reminder')}</h3><p>${esc(excerpt(i, 92))}</p><div class="compact-guidance-meta"><span>${esc(i.category || 'Reflection')}</span><span>${esc(dateText(i.createdAt))}</span></div><span class="compact-guidance-open">Read Reflection <b aria-hidden="true">→</b></span></a></article>`;
  }

  return `<article class="live-card ${esc(i.type || 'reflection')} ${featured ? 'featured-live' : ''} ${img ? 'has-image' : ''}" ${style}><span class="live-type">${esc(label(i.type))}</span><h3>${esc(i.title || label(i.type))}</h3><p>${esc(excerpt(i))}</p><div class="live-meta"><span>${esc(i.category || 'General')}</span><span>${esc(dateText(i.createdAt))}</span></div><a class="live-link" href="${route(i)}">Read Reflection →</a></article>`;
}
function todayCard(item, type) {
  if (!item) {
    return `<article class="today-card ${type}"><span class="today-label">${esc(label(type))}</span><h3>More is being prepared.</h3><p>Publish a verified ${esc(label(type).toLowerCase())}  and it will appear here automatically.</p><div class="today-meta">RISE UPON DEEN</div></article>`;
  }
  const arabic = type === 'dua' && item.arabic ? `<div class="arabic-snippet" lang="ar">${esc(item.arabic)}</div>` : '';
  return `<article class="today-card ${type}"><span class="today-label">TODAY'S ${esc(label(type).toUpperCase())}</span>
    ${arabic}
    <h3>${esc(item.title || label(type))}</h3><p>${esc(excerpt(item, 135))}</p><div class="today-meta">${esc(item.reference || item.category || 'Rise Upon Deen')} · ${esc(dateText(item.createdAt))}</div><a class="live-link" href="${route(item)}">Read Reflection →</a></article>`;
}
function editorialCard(i) {
  const img = safeUrl(i.image);
  const style = img ? `style="background-image:url('${esc(img)}')"` : '';
  return `<article class="editorial-story ${img ? 'has-image' : ''}" ${style}><div class="story-meta">${esc(i.category || 'Article')} · ${esc(dateText(i.createdAt))}</div><h3>${esc(i.title || 'Article')}</h3><p>${esc(excerpt(i, 125))}</p><a class="live-link" href="${route(i)}">Read Article →</a></article>`;
}
function guidanceCard(i, primary = false) {
  if (!i)
    return `<article class="guidance-card ${primary ? 'primary' : ''}"><span class="eyebrow">HADITH</span><h3>Verified guidance will appear here.</h3><p>Publish a Hadith with its manually verified source and reference .</p></article>`;
  return `<article class="guidance-card ${primary ? 'primary' : ''}"><span class="eyebrow">${esc(i.category || 'HADITH')}</span><h3>${esc(i.title || 'Hadith')}</h3>
    ${i.arabic ? `<div class="hadith-arabic" lang="ar">${esc(i.arabic)}</div>` : ''}
    ${i.translation ? `<p>${esc(i.translation)}</p>` : `<p>${esc(excerpt(i, 180))}</p>`}
    ${i.source || i.reference ? `<p style="color:#77787d;font-size:12px">${esc([i.source, i.reference].filter(Boolean).join(' · '))}</p>` : ''}
    <div><a class="premium-btn small" href="${route(i)}">Read Reflection <span class="arrow">→</span></a></div></article>`;
}
function duaArch(i) {
  if (!i)
    return `<article class="dua-arch"><span class="eyebrow">DUA</span><h3>More duas are being prepared.</h3><p>Publish a verified dua to place it in this peaceful collection.</p></article>`;
  return `<article class="dua-arch"><span class="eyebrow">${esc(i.category || 'DUA')}</span>
    ${i.arabic ? `<div class="arabic" lang="ar">${esc(i.arabic)}</div>` : ''}
    <h3>${esc(i.title || 'Dua')}</h3>
    ${i.transliteration ? `<p><em>${esc(i.transliteration)}</em></p>` : ''}
    <p>${esc(i.meaning || excerpt(i, 110))}</p><div class="textual-actions"><button class="premium-btn small" data-copy="${i.id}">Copy Dua</button><a class="premium-btn small" href="${route(i)}">Open →</a></div></article>`;
}
function bindCardLights(root = document) {
  if (true) return; /* Performance: static premium cards render faster than pointer-tracked light effects. */
  $$('.live-card,.today-card,.editorial-story,.guidance-card,.topic-card,.social-card,.textual-card', root).forEach(
    (el) => {
      if (el.dataset.lightBound) return;
      el.dataset.lightBound = '1';
      el.addEventListener(
        'pointermove',
        (e) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
          el.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
        },
        { passive: true },
      );
    },
  );
}
function renderSocialLinks() {
  const root = $('#socialGrid');
  if (!root) return;
  const defs = [
    ['instagram', 'Instagram', 'Daily reminders and visual reflections.'],
    ['youtube', 'YouTube', 'Longer reflections and beneficial content.'],
    ['facebook', 'Facebook', 'Stay connected with the community.'],
  ];
  root.innerHTML = defs
    .map(([key, name, copy]) => {
      const url = safeUrl(SOCIAL_LINKS[key] || '');
      return url
        ? `<a class="social-card" href="${esc(url)}" target="_blank" rel="noopener"><h3>${name}</h3><p>${copy}</p><span class="live-link">Follow →</span></a>`
        : `<article class="social-card disabled"><h3>${name}</h3><p>${copy}</p><span class="social-status">Add your real ${name} URL in SOCIAL_LINKS to enable this.</span></article>`;
    })
    .join('');
}
function renderLatestHome() {
  const root = $('#latestLiveGrid');
  if (!root) return;
  const latest = S.publicContent.filter((x) => homeLatestType === 'all' || x.type === homeLatestType).slice(0, 4);
  root.innerHTML = latest.length
    ? latest.map((x) => card(x)).join('')
    : `<div class="empty-live">More reflections are being prepared for this category.</div>`;
  bindCardLights(root);
}
function renderDailyHeartReflection() {
  const reminder = dailyPick(
    S.publicContent.filter((x) => x.type === 'reminder'),
    0,
  );
  const card = document.querySelector('.heart-reflection');
  if (!card) return;

  if (!reminder) {
    card.innerHTML = `
      <div class="geo-pattern"></div>
      <span class="reflection-label">DAILY REFLECTION</span>
      <blockquote>For Your Heart</blockquote>
      <p class="heart-inline-full">Publish a reminder from Admin to show today’s reflection here.</p>
    `;
    return;
  }

  const fullText = String(reminder.content || reminder.description || reminder.reflection || reminder.meaning || '')
    .replace(/\s+/g, ' ')
    .trim();

  const sourceText = [reminder.source, reminder.reference].filter(Boolean).join(' · ');

  card.innerHTML = `
    <div class="geo-pattern"></div>
    <span class="reflection-label">DAILY REFLECTION</span>
    <blockquote>${esc(reminder.title || 'For Your Heart')}</blockquote>
    ${
      reminder.arabic
        ? `
      <div class="heart-inline-arabic arabic" lang="ar" dir="rtl">
        ${esc(reminder.arabic)}
      </div>`
        : ''
    }
    ${
      fullText
        ? `
      <p class="heart-inline-full">${esc(fullText)}</p>`
        : ''
    }
    ${
      sourceText
        ? `
      <div class="heart-inline-reference">
        <span>Reference</span>
        <strong>${esc(sourceText)}</strong>
      </div>`
        : ''
    }
  `;
}
function renderCmsNames() {
  const root = $('#namesGrid');
  if (!root) return;
  let names = orderNamesForDisplay(S.publicContent.filter((x) => x.type === 'name'));
  if (!names.length) {
    root.innerHTML = `<div class="empty-live">Publish Names of Allah from Admin to display them here.</div>`;
    window.RUD_PUBLISHED_NAMES = [];
    return;
  }
  root.innerHTML = names
    .slice(0, 3)
    .map(
      (n, i) => `
    <article class="name-card reveal visible" tabindex="0" role="button"
      data-arabic="${esc(n.arabic || '')}"
      data-name="${esc(n.title || '')}"
      data-meaning="${esc(n.meaning || '')}"
      data-reflection="${esc(n.reflection || '')}"
      data-when="${esc(n.whenToRecite || '')}"><div class="name-index">${String(n.number || i + 1).padStart(2, '0')} · NAME</div><div class="name-arabic arabic" lang="ar">${esc(n.arabic || '')}</div><div><h3>${esc(n.title || '')}</h3><p>${esc(n.meaning || '')}</p></div></article>`,
    )
    .join('');
  window.RUD_PUBLISHED_NAMES = names.map((n) => ({
    arabic: n.arabic || '',
    name: n.title || '',
    meaning: n.meaning || '',
    description: n.reflection || '',
    when: n.whenToRecite || '',
    number: n.number || null,
  }));
}

/* Same normaliser the Deen Friends module uses for usernameKey (admin code could not see it: ReferenceError). */
function rudDfAdminKey(v) {
  return String(v ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF _.-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);
}
function rudHomeLiveSignature() {
  let s = new Date().toDateString() + '|' + S.publicContent.length + '|';
  for (const x of S.publicContent)
    s += (x?.id || '') + ':' + (millis(x?.updatedAt) || millis(x?.createdAt) || 0) + (x?.featured ? 'f' : '') + ';';
  return s;
}
/* Home components are rebuilt only when the published content actually changed.
   Three refresh paths (cache, shared cache, network) used to rebuild every card each time. */
function renderHomeLive() {
  const sig = rudHomeLiveSignature();
  if (sig === S.rudHomeLiveSig) return;
  rudRenderHomeLiveNow();
  S.rudHomeLiveSig = sig;
}
function rudRenderHomeLiveNow() {
  renderDailyHeartReflection();
  renderCmsNames();
  applySiteContent();

  const featured = S.publicContent.filter((x) => x.featured && x.type !== 'site' && x.type !== 'name').slice(0, 3);
  renderLatestHome();

  const featuredGrid = $('#featuredLiveGrid');
  if (featuredGrid) {
    featuredGrid.innerHTML = featured.length
      ? featured.map((x, n) => card(x, n === 0)).join('')
      : `<div class="empty-live">Featured reflections will appear here when selected.</div>`;
  }

  /* IMPORTANT:
     These two homepage cards are intentionally static navigation teasers.
     Publishing/importing a Dua or Hadith must never replace their titles/content. */
  const duaRoot = $('#homeDuaSpotlight');
  if (duaRoot) {
    duaRoot.innerHTML = `
      
      <div class="guidance-ribbon-copy">
        <strong>Turn to Allah.</strong>
        <span>Explore Duas.</span>
      </div>
      <a class="guidance-ribbon-link" href="#duas" data-public-route="#duas" aria-label="Explore Duas">
        Explore Duas <i>↗</i>
      </a>`;
  }

  const hadithRoot = $('#homeHadithSpotlight');
  if (hadithRoot) {
    hadithRoot.innerHTML = `
      
      <div class="guidance-ribbon-copy">
        <strong>Prophetic Guidance.</strong>
        <span>Explore Hadith.</span>
      </div>
      <a class="guidance-ribbon-link" href="#hadith" data-public-route="#hadith" aria-label="Explore Hadith">
        Explore Hadith <i>↗</i>
      </a>`;
  }

  bindCardLights(document);
  bindSpotlightLight();
  bindHomeDiscovery();
  rudSyncFridayMode();
  rudSyncSmartHome();
}
function bindHomeDiscovery() {
  const tabs = $('#homeLatestTabs');
  if (tabs && !tabs.dataset.bound) {
    tabs.dataset.bound = '1';
    $$('[data-home-type]', tabs).forEach((b) =>
      b.addEventListener('click', () => {
        homeLatestType = b.dataset.homeType;
        $$('[data-home-type]', tabs).forEach((x) => x.classList.toggle('active', x === b));
        renderLatestHome();
      }),
    );
  }
  const topicButtons = $('#topicButtons');
  if (topicButtons && !topicButtons.dataset.bound) {
    topicButtons.dataset.bound = '1';
    $$('.topic-card', topicButtons).forEach((btn) =>
      btn.addEventListener('click', () => {
        $$('.topic-card', topicButtons).forEach((x) => x.classList.toggle('active', x === btn));
        const words = btn.dataset.topic.toLowerCase().split(/\s+/);
        const matches = S.publicContent
          .filter((i) => {
            const hay = [
              i.title,
              i.description,
              i.content,
              i.translation,
              i.meaning,
              i.reflection,
              i.category,
              i.reference,
              i.whenToRecite,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return words.some((w) => hay.includes(w));
          })
          .slice(0, 6);
        const root = $('#topicResultGrid');
        root.innerHTML = matches.length
          ? matches.map((x) => card(x)).join('')
          : `<div class="empty-live">No matching published reflection yet. As your library grows, relevant content will appear here automatically.</div>`;
        bindCardLights(root);
        root.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      }),
    );
  }
}

/* Applies the admin-edited homepage copy (Site Content) to the public home page. */
function applySiteContent() {
  const x = S.publicContent.find((i) => i.type === 'site' && i.key === 'main');
  if (!x) return;
  const set = (sel, text) => {
    const e = $(sel);
    if (e && text) e.textContent = text;
  };
  set('.hero-tagline', x.heroTagline);
  set('.hero-support', x.heroSupport);
  set('#reminder .section-title', x.dailyHeading);
  set('#names .section-title', x.namesHeading);
  set('#names .section-copy', x.namesCopy);
  set('#spotlight .section-title', x.guidanceHeading);
  set('.minimal-cinematic-reflection h2, .cinematic-reflection h2, .reflection-section h2', x.reflectionTitle);
  set('.minimal-cinematic-reflection p, .cinematic-reflection p, .reflection-section p', x.reflectionSupport);
  set('.instagram-heart-quote', x.instagramQuote);
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  homeLatestType = 'all';
  bindSpotlightLight = () => {
    if (coarsePointer) return;
    $$('.spotlight-card').forEach((el) => {
      if (el.dataset.spotBound) return;
      el.dataset.spotBound = '1';
      let spotRaf = 0,
        spotX = 0,
        spotY = 0;
      el.addEventListener(
        'pointermove',
        (e) => {
          spotX = e.clientX;
          spotY = e.clientY;
          if (spotRaf) return;
          spotRaf = requestAnimationFrame(() => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mouse-x', `${spotX - r.left}px`);
            el.style.setProperty('--mouse-y', `${spotY - r.top}px`);
            spotRaf = 0;
          });
        },
        { passive: true },
      );
    });
  };
}

export { applySiteContent, bindHomeDiscovery, card, mediaBlock, renderHomeLive, renderSocialLinks, rudDfAdminKey };
