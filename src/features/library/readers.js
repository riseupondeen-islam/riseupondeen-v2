/**
 * Public libraries and readers: Duas, Hadith, Reminders, Names lists and detail pages, Saved, posters and sharing.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { orderNamesForDisplay } from '../names/nameOrder';
import { S } from '../../runtime/store';
import { showPage } from '../../app/routing/surfaces';

import { combinedPublicContent, findPublicItem, openSearch } from '../ask-rise/askRise';
import { card, mediaBlock } from '../home/homeContent';
import {
  rudOfflineAction,
  rudOfflineHas,
  rudOfflineRemoveItem,
  rudOfflineSaveItem,
  rudQuranMetaLocal,
} from '../my-deen/myDeen';
import { rudQuranBookmarks } from '../quran/quran';
import { $, $$ } from '../../runtime/core';
import {
  dateText,
  esc,
  favs,
  isFav,
  label,
  paragraphs,
  route,
  safeFileName,
  safeUrl,
  shareItem,
  toast,
  toggleFav,
} from '../../utils/ui';

function routeHero(k, t, c) {
  return `<section class="route-hero"><div class="shell"><span class="eyebrow">${esc(k)}</span><h1>${esc(t)}</h1><p class="section-copy">${esc(c)}</p></div></section>`;
}
function hadithCard(i) {
  const displayTitle = String(i.title || 'Hadith').trim() || 'Hadith';
  return `<article class="compact-guidance-card hadith-preview-card"><a class="compact-guidance-link" href="${route(i)}" aria-label="${esc(`Open ${displayTitle}`)}"><span class="compact-guidance-type">Hadith</span><h3>${esc(displayTitle)}</h3><span class="compact-guidance-open">Read Hadith <b aria-hidden="true">→</b></span></a></article>`;
}
function duaCard(i) {
  const displayTitle = String(i.title || 'Dua').trim() || 'Dua';
  return `<article class="dua-library-card"><a class="dua-library-link" href="${route(i)}" aria-label="${esc(`Open ${displayTitle}`)}"><span class="dua-library-kicker">Dua</span><span class="dua-library-ornament" aria-hidden="true">۞</span><div class="dua-library-copy"><h3>${esc(displayTitle)}</h3></div><span class="dua-library-open" aria-hidden="true">Read <b>↗</b></span></a></article>`;
}
async function rudExportRisePoster({
  kind = 'GUIDANCE',
  title = 'Rise Upon Deen',
  arabic = '',
  transliteration = '',
  body = '',
  reference = '',
  fileName = 'rise-upon-deen',
} = {}) {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas'),
      W = 1080,
      H = 1350,
      ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#071015');
    bg.addColorStop(0.58, '#0b0d0f');
    bg.addColorStop(1, '#050607');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.76, H * 0.12, 0, W * 0.76, H * 0.12, 520);
    glow.addColorStop(0, 'rgba(202,168,103,.16)');
    glow.addColorStop(1, 'rgba(202,168,103,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(202,168,103,.42)';
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 44, W - 88, H - 88);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(58, 58, W - 116, H - 116);
    const gold = '#caa867',
      paper = '#f4efe4',
      muted = '#b9b2a5',
      wrap = (text, maxWidth, font) => {
        ctx.font = font;
        const words = String(text || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean),
          lines = [];
        let line = '';
        for (const word of words) {
          const test = line ? line + ' ' + word : word;
          if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else line = test;
        }
        if (line) lines.push(line);
        return lines;
      },
      draw = (lines, y, font, color, lineHeight, max = 8) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        for (const line of lines.slice(0, max)) {
          ctx.fillText(line, W / 2, y);
          y += lineHeight;
        }
        return y;
      };
    const logo = document.querySelector('.brand-logo');
    if (logo?.complete && logo.naturalWidth) {
      try {
        ctx.drawImage(logo, 82, 72, 64, 64);
      } catch {}
    }
    ctx.textAlign = 'left';
    ctx.font = '600 25px Manrope, Arial';
    ctx.fillStyle = gold;
    ctx.fillText('RISE UPON DEEN', 164, 112);
    ctx.textAlign = 'center';
    ctx.font = '700 18px Manrope, Arial';
    ctx.fillStyle = muted;
    ctx.fillText(String(kind).toUpperCase(), W / 2, 172);
    ctx.fillStyle = gold;
    ctx.fillRect(W / 2 - 36, 198, 72, 2);
    let y = 282;
    y =
      draw(
        wrap(title, 820, '600 62px "Cormorant Garamond", Georgia, serif'),
        y,
        '600 62px "Cormorant Garamond", Georgia, serif',
        paper,
        70,
        3,
      ) + 22;
    if (arabic)
      y =
        draw(
          wrap(arabic, 860, '500 48px "Noto Naskh Arabic", Amiri, serif'),
          y,
          '500 48px "Noto Naskh Arabic", Amiri, serif',
          paper,
          72,
          4,
        ) + 26;
    if (transliteration)
      y =
        draw(
          wrap(transliteration, 820, 'italic 30px "Cormorant Garamond", Georgia, serif'),
          y,
          'italic 30px "Cormorant Garamond", Georgia, serif',
          muted,
          42,
          4,
        ) + 20;
    if (body) {
      ctx.fillStyle = 'rgba(255,255,255,.055)';
      ctx.fillRect(112, y - 18, W - 224, 2);
      y += 42;
      draw(wrap(body, 800, '400 32px Manrope, Arial'), y, '400 32px Manrope, Arial', paper, 48, 8);
    }
    if (reference) {
      ctx.fillStyle = 'rgba(255,255,255,.055)';
      ctx.fillRect(180, 1128, W - 360, 1);
      ctx.font = '500 21px Manrope, Arial';
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText(String(reference).slice(0, 150), W / 2, 1178);
    }
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    ctx.fillRect(86, 1202, W - 172, 88);
    ctx.fillStyle = 'rgba(202,168,103,.34)';
    ctx.fillRect(86, 1202, W - 172, 1);
    ctx.fillStyle = gold;
    ctx.fillRect(W / 2 - 26, 1201, 52, 3);
    ctx.textAlign = 'left';
    ctx.font = '700 14px Manrope, Arial';
    ctx.fillStyle = muted;
    ctx.fillText('RISE UPON DEEN', 116, 1238);
    ctx.font = '600 17px Manrope, Arial';
    ctx.fillStyle = gold;
    ctx.fillText('riseupondeen.web.app', 116, 1267);
    ctx.textAlign = 'right';
    ctx.font = '500 12px Manrope, Arial';
    ctx.fillStyle = muted;
    ctx.fillText('VERIFIED CONTENT', W - 116, 1238);
    ctx.font = '600 17px Manrope, Arial';
    ctx.fillStyle = paper;
    ctx.fillText('@riseupondeen', W - 116, 1267);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
    if (!blob) throw new Error('poster-export-failed');
    const clean = safeFileName(fileName || title || 'rise-upon-deen'),
      downloadName = `${clean}-rise-upon-deen.png`;
    if (navigator.share && navigator.canShare && typeof File === 'function') {
      const file = new File([blob], downloadName, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: String(title), files: [file] });
          toast('Poster ready to share.');
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
    }
    const a = document.createElement('a'),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast('Poster downloaded.');
  } catch (e) {
    console.warn(e);
    toast('Unable to create the poster on this device.', 'error');
  }
}
async function downloadGuidanceCard(i) {
  if (!i || !['dua', 'hadith', 'reminder'].includes(i.type)) return;
  const body = String(
    i.type === 'hadith'
      ? i.translation || i.content || ''
      : i.type === 'dua'
        ? i.meaning || ''
        : i.content || i.description || i.meaning || '',
  ).trim();
  return rudExportRisePoster({
    kind: label(i.type) || i.type,
    title: String(i.title || label(i.type) || 'Guidance').trim(),
    arabic: String(i.arabic || '').trim(),
    transliteration: i.type === 'dua' ? String(i.transliteration || '').trim() : '',
    body,
    reference: [i.source, i.reference].filter(Boolean).join(' · '),
    fileName: String(i.title || label(i.type) || 'guidance'),
  });
}
function bindPublicActions(root = $('#dynamicPage')) {
  $$('[data-save]', root).forEach((b) => b.addEventListener('click', () => toggleFav(b.dataset.save)));
  $$('[data-offline]', root).forEach((b) => {
    if (b.dataset.rudOfflineBound) return;
    b.dataset.rudOfflineBound = '1';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const id = b.dataset.offline,
        i = findPublicItem(id);
      if (!i) return;
      if (rudOfflineHas(id)) {
        rudOfflineRemoveItem(id);
        b.textContent = 'Make Available Offline';
        toast('Removed from offline content.');
      } else {
        rudOfflineSaveItem(i);
        b.textContent = 'Available Offline';
        toast('Available offline on this device.');
      }
    });
  });
  $$('[data-share]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const i = findPublicItem(b.dataset.share);
      if (i) shareItem(i);
    }),
  );
  $$('[data-download]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const i = findPublicItem(b.dataset.download);
      if (i) downloadGuidanceCard(i);
    }),
  );
  $$('[data-copy]', root).forEach((b) =>
    b.addEventListener('click', async () => {
      const i = findPublicItem(b.dataset.copy);
      if (!i) return;
      const t = [i.arabic, i.transliteration, i.meaning, [i.source, i.reference].filter(Boolean).join(' · ')]
        .filter(Boolean)
        .join('\n');
      try {
        await navigator.clipboard.writeText(t);
        toast('Copied to clipboard.');
      } catch {
        toast('Unable to copy this dua.', 'error');
      }
    }),
  );
}
function nameLibraryCard(i) {
  const arabic = String(i.arabic || '').trim();
  const name = String(i.name || i.title || 'Name of Allah').trim();
  const meaning = String(i.meaning || i.description || '').trim();
  const number = String(i.number || '').trim();
  return `<article class="name-library-card"><a class="name-library-link" href="#name/${encodeURIComponent(i.id)}" aria-label="${esc(`Open ${name}`)}"><span class="name-library-kicker">${number ? `${esc(number.padStart(2, '0'))} · NAME` : 'BEAUTIFUL NAME'}</span>${arabic ? `<div class="name-library-arabic" lang="ar" dir="rtl">${esc(arabic)}</div>` : ''}<div class="name-library-copy"><h3>${esc(name)}</h3>${meaning ? `<p>${esc(meaning)}</p>` : ''}</div><span class="name-library-open" aria-hidden="true">›</span></a></article>`;
}
function rudRestoreDetailCloseState() {
  const search = document.getElementById('searchOverlay');
  if (!search?.classList.contains('open')) document.body.classList.remove('search-open');
}
function renderNameDetail(i) {
  if (!i) {
    showPage(
      `${routeHero('Names of Allah', 'Name unavailable.', 'This published Name could not be found.')}<section class="section" style="padding-top:12px"><div class="shell"><a class="premium-btn" href="#names">Back to Names</a></div></section>`,
      'Name Not Found | Rise Upon Deen',
    );
    return;
  }
  const name = i.name || i.title || 'Name of Allah';
  showPage(
    `<article class="name-reader" aria-labelledby="nameReaderTitle"><button type="button" class="rud-detail-close" aria-label="Close detail">×</button><header class="name-reader-head"><button type="button" class="compact-reader-back" data-history-back><span aria-hidden="true">←</span><span>Back</span></button><span class="name-reader-label">Beautiful Name of Allah</span>${i.arabic ? `<div class="name-reader-arabic" lang="ar" dir="rtl">${esc(i.arabic)}</div>` : ''}<h1 id="nameReaderTitle">${esc(name)}</h1>${i.meaning ? `<p class="name-reader-meaning">${esc(i.meaning)}</p>` : ''}</header><div class="name-reader-body">${i.description ? `<section><span>Meaning & Reflection</span><p>${esc(i.description)}</p></section>` : ''}${i.reflection && i.reflection !== i.description ? `<section><span>Reflection</span><p>${esc(i.reflection)}</p></section>` : ''}${i.whenToRecite ? `<section><span>When to Remember This Name</span><p>${esc(i.whenToRecite)}</p></section>` : ''}</div><div class="compact-reader-actions" style="margin-top:18px"><button type="button" class="premium-btn" data-save="${i.id}">${isFav(i.id) ? '♥ Saved' : '♡ Save'}</button><button type="button" class="premium-btn" data-share="${i.id}">Share</button></div></article>`,
    `${name} | Rise Upon Deen`,
  );
  bindPublicActions();
}
function renderLibrary(type, title, copy) {
  const published = combinedPublicContent().filter((x) => x.type === type);
  /* Names of Allah are shown 1 → 99 by their published number (see features/names/nameOrder.ts). */
  const items = type === 'name' ? orderNamesForDisplay(published) : published;
  const cats = ['All', ...new Set(items.map((x) => x.category).filter(Boolean))];
  const gridClass =
    type === 'name' ? 'names-route-grid' : ['hadith', 'dua'].includes(type) ? 'textual-grid' : 'live-grid';
  const namesClose =
    type === 'name'
      ? `<button type="button" class="names-route-close" id="namesRouteClose" aria-label="Exit Beautiful Names page" title="Close">×</button>`
      : '';
  const heroHtml = routeHero(label(type), title, copy);
  const finalHero =
    type === 'name'
      ? heroHtml.replace('<div class="shell">', `<div class="shell names-route-hero-shell">${namesClose}`)
      : heroHtml;

  const isDuaOrHadith = ['dua', 'hadith'].includes(type);
  const toolbar =
    type === 'name'
      ? ''
      : isDuaOrHadith
        ? `<div class="route-toolbar rud-simple-library-toolbar">
         <button class="premium-btn small" id="routeSearch" type="button" aria-controls="searchOverlay" data-open-search>Ask Rise ✦</button>
         <a class="premium-btn small" href="#saved">Visitor Collection</a>
       </div>`
        : `<div class="route-toolbar">
         <div class="filter-row" id="routeFilters">${cats.map((c, n) => `<button class="filter-chip ${n === 0 ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
         <button class="premium-btn small" id="routeSearch" type="button" aria-controls="searchOverlay" data-open-search>Ask Rise ✦</button>
       </div>`;

  showPage(
    `${finalHero}<section class="section route-library-section" style="padding-top:20px"><div class="shell">${toolbar}<div class="${gridClass}" id="routeGrid"></div></div></section>`,
    `${title} | Rise Upon Deen`,
  );

  const draw = (cat = 'All') => {
    const list = isDuaOrHadith ? items : items.filter((x) => cat === 'All' || x.category === cat);
    const grid = $('#routeGrid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = `<div class="empty-live">${S.firebaseReady ? (type === 'name' ? 'No Names have been published from Admin yet.' : 'Nothing published here yet.') : 'Connecting to the content library…'}</div>`;
      return;
    }
    grid.innerHTML =
      type === 'hadith'
        ? list.map(hadithCard).join('')
        : type === 'dua'
          ? list.map(duaCard).join('')
          : type === 'name'
            ? list.map(nameLibraryCard).join('')
            : list.map((x) => card(x)).join('');
    bindPublicActions(grid);
  };

  draw();

  if (!isDuaOrHadith && type !== 'name') {
    $$('#routeFilters [data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        $$('#routeFilters [data-cat]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        draw(b.dataset.cat);
      }),
    );
  }

  $('#routeSearch')?.addEventListener('click', () => openSearch());
}
function renderArticle(i) {
  const img = safeUrl(i.image),
    words = String(i.content || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length,
    reading = Math.max(1, Math.ceil(words / 210)),
    rec = S.publicContent.filter((x) => x.type === 'article' && x.id !== i.id).slice(0, 3);
  showPage(
    `<article class="reader"><button type="button" class="rud-detail-close" aria-label="Close detail">×</button><div class="reader-head"><a href="#home" class="premium-btn small">← Return Home</a><div style="margin-top:28px"><span class="eyebrow">${esc(i.category || 'Article')}</span></div><h1>${esc(i.title || 'Article')}</h1>${i.description ? `<p class="reader-desc">${esc(i.description)}</p>` : ''}<div class="reader-meta"><span>${esc(i.author || 'Rise Upon Deen')}</span><span>${esc(dateText(i.createdAt))}</span><span>${reading} min read</span></div></div>${img ? `<img class="reader-img" src="${esc(img)}" alt="${esc(i.title || 'Article image')}" loading="lazy">` : mediaBlock(i)}<div class="reader-body">${paragraphs(i.content)}</div><div class="reader-actions"><button class="premium-btn" data-save="${i.id}">${isFav(i.id) ? '♥ Saved' : '♡ Save'}</button><button class="premium-btn" data-share="${i.id}">Share</button>${rudOfflineAction(i.id)}</div>${rec.length ? `<section style="margin-top:90px"><h2 style="font-size:2rem">Continue reading</h2><div class="live-grid">${rec.map((x) => card(x)).join('')}</div></section>` : ''}</article>`,
    `${i.title} | Rise Upon Deen`,
  );
  bindPublicActions();
}
function renderDuaDetail(i) {
  const sourceText = [i.source, i.reference].filter(Boolean).join(' · ');
  const category = String(i.category || 'Dua').trim();
  const generic = /^(dua|duas|general)$/i.test(category);
  const contextTitle = !generic && category ? `Dua for ${category}` : 'Dua';

  showPage(
    `
    <article class="dua-reader-v2" aria-labelledby="duaReaderTitle"><button type="button" class="rud-detail-close" aria-label="Close detail">×</button><header class="dua-reader-v2-head"><button type="button" class="dua-reader-back" data-history-back aria-label="Go back"><span aria-hidden="true">←</span><span>Back</span></button><div class="dua-reader-heading"><span class="dua-reader-context">${esc(contextTitle)}</span><h1 id="duaReaderTitle">${esc(i.title || contextTitle)}</h1>
          ${i.whenToRecite ? `<p>${esc(i.whenToRecite)}</p>` : ''}
        </div></header><section class="dua-sacred-stage" aria-label="Arabic dua"><div class="dua-sacred-halo" aria-hidden="true"></div><div class="dua-sacred-frame"><span class="dua-sacred-mark" aria-hidden="true">۞</span><div class="dua-sacred-arabic" lang="ar" dir="rtl">${esc(i.arabic || '')}</div></div></section><div class="dua-reader-v2-body">
        ${
          i.transliteration
            ? `
          <section class="dua-reader-section dua-reader-transliteration"><span class="dua-reader-label">Transliteration</span><p>${esc(i.transliteration)}</p></section>`
            : ''
        }
        ${
          i.meaning
            ? `
          <section class="dua-reader-section dua-reader-meaning"><span class="dua-reader-label">Meaning</span><p>${esc(i.meaning)}</p></section>`
            : ''
        }
        ${
          sourceText
            ? `
          <section class="dua-reader-source"><div><span class="dua-reader-label">Source</span><strong>${esc(sourceText)}</strong></div></section>`
            : ''
        }
        ${
          i.reflection
            ? `
          <section class="dua-reader-section dua-reader-reflection"><span class="dua-reader-label">Reflection</span><p>${esc(i.reflection)}</p></section>`
            : ''
        }
      </div><div class="dua-reader-actions" aria-label="Dua actions"><button type="button" class="premium-btn primary" data-copy="${i.id}">Copy Dua</button><button type="button" class="premium-btn" data-save="${i.id}">${isFav(i.id) ? '♥ Saved' : '♡ Save'}</button><button type="button" class="premium-btn" data-share="${i.id}">Share</button><button type="button" class="premium-btn" data-download="${i.id}">Share as Poster</button>${rudOfflineAction(i.id)}</div></article>
  `,
    `${i.title || contextTitle} | Rise Upon Deen`,
  );
  rudRestoreDetailCloseState();
  bindPublicActions();
}
function renderHeartReflection(indexValue) {
  const items = Array.isArray(window.RUD_DAILY_HEART_REFLECTIONS) ? window.RUD_DAILY_HEART_REFLECTIONS : [];
  const parsed = Number.parseInt(indexValue, 10);
  const index =
    Number.isInteger(parsed) && parsed >= 0 && parsed < items.length
      ? parsed
      : typeof window.RUD_getDailyHeartIndex === 'function'
        ? window.RUD_getDailyHeartIndex()
        : 0;
  const item = items[index];

  if (!item) {
    showPage(
      `${routeHero('For Your Heart', 'Reflection unavailable.', 'Return home and continue exploring.')}<section class="section" style="padding-top:10px"><div class="shell"><a class="premium-btn" href="#home">Return Home</a></div></section>`,
      'For Your Heart | Rise Upon Deen',
    );
    return;
  }

  showPage(
    `
    <article class="heart-reader" aria-labelledby="heartReaderTitle"><button type="button" class="rud-detail-close rud-heart-close" aria-label="Close reflection detail">×</button><header class="heart-reader-header"><button type="button" class="heart-reader-back" data-history-back aria-label="Go back"><span aria-hidden="true">←</span><span>Back</span></button><div class="heart-reader-heading"><span class="heart-reader-eyebrow">For Your Heart</span><h1 id="heartReaderTitle">A Reflection for Today</h1><p>Pause for a moment. Read slowly, reflect, and carry what benefits your heart.</p></div></header><section class="heart-reader-stage" aria-label="Qur'an reflection"><div class="heart-reader-noor" aria-hidden="true"></div><div class="heart-reader-card"><span class="heart-reader-reference">${esc(item.reference || "Qur'an")}</span><div class="heart-reader-divider" aria-hidden="true"><span></span><i>۞</i><span></span></div><blockquote>${esc(item.quote || '')}</blockquote></div></section><section class="heart-reader-reflection"><span class="heart-reader-label">Reflection</span><p>${esc(item.reflection || '')}</p></section><footer class="heart-reader-footer"><a class="premium-btn" href="#home">Return Home</a><a class="premium-btn primary" href="#reminders">Explore Reminders</a></footer></article>
  `,
    'For Your Heart | Rise Upon Deen',
  );

  bindPublicActions();
}
function renderDetail(i) {
  if (!i) {
    showPage(
      `${routeHero('Not Found', 'Content unavailable.', 'Please return to the previous page.')}<section class="section" style="padding-top:10px"><div class="shell"><a class="premium-btn" href="#home">Return Home</a></div></section>`,
      'Content Not Found | Rise Upon Deen',
    );
    return;
  }

  if (i.type === 'article') {
    location.hash = '#home';
    return;
  }
  if (i.type === 'dua') {
    renderDuaDetail(i);
    return;
  }

  const sourceText = [i.source, i.reference].filter(Boolean).join(' · ');

  if (i.type === 'hadith') {
    const hadithSource = String(i.source || '').trim();
    const hadithReference = String(i.reference || '').trim();
    const hadithSourceText = [hadithSource, hadithReference].filter(Boolean).join(' · ');
    const category = String(i.category || 'Hadith').trim();

    showPage(
      `
      <article class="dua-reader-v2 hadith-as-dua-reader" aria-labelledby="hadithReaderTitle">
        <button type="button" class="rud-detail-close rud-hadith-close" aria-label="Close Hadith detail">×</button>

        <header class="dua-reader-v2-head">
          <button type="button" class="dua-reader-back" data-history-back aria-label="Go back">
            <span aria-hidden="true">←</span><span>Back</span>
          </button>
          <div class="dua-reader-heading">
            <span class="dua-reader-context">${esc(category)}</span>
            <h1 id="hadithReaderTitle">${esc(i.title || 'Hadith')}</h1>
          </div>
        </header>

        ${
          i.arabic
            ? `
          <section class="dua-sacred-stage" aria-label="Arabic Hadith">
            <div class="dua-sacred-halo" aria-hidden="true"></div>
            <div class="dua-sacred-frame">
              <span class="dua-sacred-mark" aria-hidden="true">۞</span>
              <div class="dua-sacred-arabic" lang="ar" dir="rtl">${esc(i.arabic)}</div>
            </div>
          </section>`
            : ''
        }

        <div class="dua-reader-v2-body">
          ${
            i.translation
              ? `
            <section class="dua-reader-section">
              <span class="dua-reader-label">English</span>
              <p>${esc(i.translation)}</p>
            </section>`
              : ''
          }

          ${
            i.transliteration
              ? `
            <section class="dua-reader-section dua-reader-transliteration">
              <span class="dua-reader-label">Transliteration</span>
              <p>${esc(i.transliteration)}</p>
            </section>`
              : ''
          }

          ${
            hadithSourceText
              ? `
            <section class="dua-reader-source">
              <div>
                <span class="dua-reader-label">Reference</span>
                <strong>${esc(hadithSourceText)}</strong>
              </div>
            </section>`
              : ''
          }

          ${
            i.reflection
              ? `
            <section class="dua-reader-section dua-reader-reflection">
              <span class="dua-reader-label">Reflection</span>
              <p>${esc(i.reflection)}</p>
            </section>`
              : ''
          }
        </div>

        <div class="dua-reader-actions" aria-label="Hadith actions">
          <button type="button" class="premium-btn primary" data-copy="${i.id}">Copy Hadith</button>
          <button type="button" class="premium-btn" data-save="${i.id}">${isFav(i.id) ? '♥ Saved' : '♡ Save'}</button>
          <button type="button" class="premium-btn" data-share="${i.id}">Share</button>
          <button type="button" class="premium-btn" data-download="${i.id}">Share as Poster</button>
          ${rudOfflineAction(i.id)}
        </div>
      </article>
    `,
      `${i.title || 'Hadith'} | Rise Upon Deen`,
    );

    rudRestoreDetailCloseState();
    bindPublicActions();
    return;
  }
  /* Reminder reader */
  const mainText = String(i.content || i.reflection || i.description || '').trim();
  const reflection = String(i.reflection || '').trim();
  const hasSeparateReflection = reflection && reflection !== mainText;

  showPage(
    `
    <article class="compact-reader compact-reminder-reader" aria-labelledby="compactReminderTitle"><button type="button" class="rud-detail-close" aria-label="Close Reminder detail">×</button><header class="compact-reader-head"><button type="button" class="compact-reader-back" data-history-back aria-label="Go back"><span aria-hidden="true">←</span><span>Back</span></button><div class="compact-reader-heading"><span class="compact-reader-chip">${esc(i.category || 'Reminder')}</span><h1 id="compactReminderTitle">${esc(i.title || 'Reminder')}</h1></div></header><div class="reminder-focus-card"><span class="reminder-focus-mark" aria-hidden="true">۞</span><div class="reminder-focus-copy">${paragraphs(mainText)}</div></div><div class="reminder-reader-lower">
        ${
          hasSeparateReflection
            ? `
          <section class="compact-info-card reflection"><span class="compact-info-label">For the Heart</span><p>${esc(reflection)}</p></section>`
            : ''
        }

        ${
          i.reference
            ? `
          <section class="compact-info-card reminder-reference"><span class="compact-info-label">Reference</span><strong>${esc(i.reference)}</strong></section>`
            : ''
        }

        <div class="compact-reader-actions"><button type="button" class="premium-btn" data-save="${i.id}">${isFav(i.id) ? '♥ Saved' : '♡ Save'}</button><button type="button" class="premium-btn" data-share="${i.id}">Share</button><button type="button" class="premium-btn" data-download="${i.id}">Share as Poster</button>${rudOfflineAction(i.id)}</div></div></article>
  `,
    `${i.title || 'Reminder'} | Rise Upon Deen`,
  );

  bindPublicActions();
}
function renderSaved() {
  const ids = new Set(favs()),
    items = combinedPublicContent().filter((x) => ids.has(x.id)),
    marks = typeof rudQuranBookmarks === 'function' ? rudQuranBookmarks() : [];
  const quran = marks.length
    ? `<section class="rud-deen-section"><div class="rud-deen-section-head"><div><h2>Qur'an Bookmarks</h2><p>Saved locally on this device.</p></div></div><div class="rud-collection-preview">${marks
        .slice()
        .reverse()
        .map((ref) => {
          const [s, a] = ref.split(':').map(Number),
            meta = rudQuranMetaLocal().find((x) => Number(x.number) === s);
          return `<a class="rud-saved-preview" href="#quran/${s}/${a}"><strong>${esc(meta?.englishName || `Surah ${s}`)} · Ayah ${a}</strong><span>Qur'an</span></a>`;
        })
        .join('')}</div></section>`
    : '';
  showPage(
    `${routeHero('Your Collection', 'Saved for Later', 'Return to the reminders that spoke to your heart.')}<section class="section" style="padding-top:20px"><div class="shell">${quran}<div class="live-grid rud-saved-grid">${items.length ? items.map((x) => card(x)).join('') : marks.length ? '' : `<div class="empty-live">You have not saved any content yet.</div>`}</div></div></section>`,
    'Saved | Rise Upon Deen',
  );
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {}

export { renderDetail, renderHeartReflection, renderLibrary, renderNameDetail, renderSaved, rudExportRisePoster };
