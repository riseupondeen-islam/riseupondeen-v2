/**
 * Rise Upon Deen poster export (V3.4) — the one export system for Duas, Hadith, Reminders and
 * Qur'an ayahs.
 *
 * - Nothing is ever cut off: the content is laid out line by line and flows onto as many 4:5 pages
 *   as it needs (page numbers on every page when there is more than one).
 * - Short content gets larger type on a single page; long content keeps a readable size and splits
 *   only between lines, never leaving a single line stranded at the top or bottom of a page.
 * - Paragraph breaks are kept. Arabic is drawn right-to-left with an Arabic font.
 * - Fonts and the logo are loaded before drawing (with a time limit, then system fallbacks).
 * - One page → PNG. Several pages → shared as images where the device supports it, otherwise saved
 *   as a single PDF (built here, no library).
 */
import { safeFileName, toast } from '../../utils/ui';

const W = 1080;
const H = 1350;
const GOLD = '#caa867';
const GOLD_SOFT = 'rgba(202,168,103,.42)';
const PAPER = '#f4efe4';
const MUTED = '#b9b2a5';
const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
const SANS = 'Manrope, "Segoe UI", Arial, sans-serif';
const ARABIC = '"Noto Naskh Arabic", Amiri, "Geeza Pro", "Arial", serif';

/* Content area (every page): below the header band, above the footer band. */
const TOP_FIRST = 250; // page 1 starts lower: it carries the kind label and the ornament
const TOP_NEXT = 200;
const BOTTOM = 1170;
const TEXT_W = 820;

const isArabicText = (s) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s);

function fontSpec(kind, scale) {
  const px = (n) => Math.round(n * scale);
  switch (kind) {
    case 'title':
      return { font: `600 ${px(60)}px ${SERIF}`, size: px(60), lh: px(68), color: PAPER, gapAfter: px(26) };
    case 'arabic':
      return { font: `500 ${px(48)}px ${ARABIC}`, size: px(48), lh: px(86), color: PAPER, gapAfter: px(26), rtl: true };
    case 'translit':
      return { font: `italic 500 ${px(31)}px ${SERIF}`, size: px(31), lh: px(44), color: MUTED, gapAfter: px(22) };
    case 'body':
      return { font: `400 ${px(31)}px ${SANS}`, size: px(31), lh: px(47), color: PAPER, gapAfter: px(18) };
    case 'reference':
      return { font: `600 ${px(22)}px ${SANS}`, size: px(22), lh: px(32), color: GOLD, gapAfter: 0 };
    default:
      throw new Error(`unknown block ${kind}`);
  }
}

/** Splits text into lines that fit maxWidth. Words longer than a line are broken by characters. */
function wrapLines(ctx, text, maxWidth) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const push = (w) => {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      if (!line && ctx.measureText(w).width > maxWidth) {
        // A single very long token (a URL, a long transliteration): break it by characters.
        let part = '';
        for (const ch of Array.from(w)) {
          if (ctx.measureText(part + ch).width > maxWidth && part) {
            lines.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
        return;
      }
      line = test;
    } else {
      lines.push(line);
      line = '';
      push(w);
    }
  };
  for (const w of words) push(w);
  if (line) lines.push(line);
  return lines;
}

/**
 * Lays the content out into pages. Pure (apart from text measuring), so it can be tested.
 * Returns { scale, pages: [{ lines: [{ text, kind, y, ... }] }] }.
 */
function layoutPoster(ctx, content) {
  const blocks = [];
  const add = (kind, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (kind === 'body' || kind === 'arabic' || kind === 'translit') {
      // Keep the author's paragraphs; each paragraph wraps on its own.
      t.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean).forEach((p, i, all) => blocks.push({ kind, text: p, lastOfKind: i === all.length - 1 }));
    } else blocks.push({ kind, text: t, lastOfKind: true });
  };
  add('title', content.title);
  add('arabic', content.arabic);
  add('translit', content.transliteration);
  add('body', content.body);
  add('reference', content.reference);

  const build = (scale) => {
    const lines = [];
    blocks.forEach((b, bi) => {
      const spec = fontSpec(b.kind, scale);
      ctx.font = spec.font;
      ctx.direction = spec.rtl ? 'rtl' : 'ltr';
      const wrapped = wrapLines(ctx, b.text, b.kind === 'reference' ? TEXT_W - 60 : TEXT_W);
      wrapped.forEach((text, li) => {
        const last = li === wrapped.length - 1;
        lines.push({
          text,
          kind: b.kind,
          spec,
          block: bi,
          // Space after the line: the line height, plus the block gap after a block's last line
          // (a smaller gap between paragraphs of the same kind).
          advance: spec.lh + (last ? (b.lastOfKind ? spec.gapAfter : Math.round(spec.lh * 0.38)) : 0),
          // A divider is drawn before the body and before the reference.
          dividerBefore: li === 0 && (b.kind === 'reference' || (b.kind === 'body' && blocks[bi - 1]?.kind !== 'body')),
          rtl: !!spec.rtl || isArabicText(text),
        });
      });
    });
    return lines;
  };
  const DIVIDER = 56;
  const paginate = (lines) => {
    const pages = [];
    let page = { lines: [] };
    let y = TOP_FIRST;
    const top = () => (pages.length ? TOP_NEXT : TOP_FIRST);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const extra = l.dividerBefore && page.lines.length ? DIVIDER : 0;
      const need = extra + l.spec.lh;
      // Keep lines together: a block's first line never sits alone at the bottom of a page, and the
      // reference is never split from itself.
      const nextSameBlock = lines[i + 1]?.block === l.block;
      const firstOfBlock = lines[i - 1]?.block !== l.block;
      const keepWithNext = firstOfBlock && nextSameBlock ? lines[i + 1].spec.lh : 0;
      // A short paragraph (up to 5 lines) moves to the next page whole rather than splitting.
      let blockH = 0;
      if (firstOfBlock) {
        let n = 0;
        for (let j = i; j < lines.length && lines[j].block === l.block; j++, n++) blockH += lines[j].spec.lh;
        if (n > 5) blockH = 0;
      }
      const keepParagraph = blockH && y + extra + blockH > BOTTOM && blockH <= BOTTOM - TOP_NEXT;
      if (page.lines.length && (keepParagraph || y + need + keepWithNext > BOTTOM)) {
        // Avoid leaving a single last line of a block alone on the next page: pull one line over.
        const prev = page.lines[page.lines.length - 1];
        const lastOfBlock = lines[i + 1]?.block !== l.block;
        const prevSame = prev && prev.block === l.block && page.lines[page.lines.length - 2]?.block === l.block;
        const carry = lastOfBlock && !firstOfBlock && prevSame ? [page.lines.pop()] : [];
        // The reference never stands alone: the last two lines before it come along.
        if (l.kind === 'reference' && firstOfBlock) {
          while (carry.length < 2 && page.lines.filter((x) => x.text).length > 2) {
            const x = page.lines.pop();
            if (x.text) carry.unshift(x);
          }
          while (page.lines.at(-1)?.kind === 'divider') page.lines.pop();
        }
        pages.push(page);
        page = { lines: [] };
        y = top();
        for (const c of carry) {
          if (c.dividerBefore && page.lines.length) {
            page.lines.push({ kind: 'divider', y: y + 10 });
            y += DIVIDER;
          }
          c.y = y + c.spec.size;
          page.lines.push(c);
          y += c.advance;
        }
      }
      if (l.dividerBefore && page.lines.length) {
        page.lines.push({ kind: 'divider', y: y + 10 });
        y += DIVIDER;
      }
      l.y = y + l.spec.size; // baseline
      page.lines.push(l);
      y += l.advance;
    }
    if (page.lines.length) pages.push(page);
    // A single page is centred vertically in the content area, so short posters look composed.
    if (pages.length === 1) {
      const used = y - TOP_FIRST;
      const shift = Math.max(0, Math.round((BOTTOM - TOP_FIRST - used) / 2));
      for (const l of pages[0].lines) l.y += shift;
    }
    return pages;
  };

  // Short content: the largest type that fits on one page. Long content: normal size, paginated.
  for (const scale of [1.3, 1.15, 1]) {
    const pages = paginate(build(scale));
    if (pages.length === 1) return { scale, pages };
  }
  return { scale: 1, pages: paginate(build(1)) };
}

/* ----------------------------------------------------------------------------------------------- */

async function ensureFonts(scale) {
  if (!document.fonts?.load) return;
  const specs = ['title', 'arabic', 'translit', 'body', 'reference'].map((k) => fontSpec(k, scale).font);
  specs.push(`700 18px ${SANS}`, `600 26px ${SANS}`);
  const load = Promise.all(
    specs.map((f) => document.fonts.load(f, f.includes('Naskh') ? 'بسم الله' : 'Rise Upon Deen').catch(() => [])),
  ).then(() => document.fonts.ready);
  // Never wait forever (offline, blocked font host): fall back to system fonts after 2.5 s.
  await Promise.race([load, new Promise((r) => setTimeout(r, 2500))]);
}

let logoPromise = null;
function loadLogo() {
  logoPromise ||= new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/icon-192.png';
  });
  return Promise.race([logoPromise, new Promise((r) => setTimeout(() => r(null), 2500))]);
}

function drawFrame(ctx, { kind, pageNo, pageCount, logo, first }) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#071015');
  bg.addColorStop(0.58, '#0b0d0f');
  bg.addColorStop(1, '#050607');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 120, 0, W / 2, 120, 620);
  glow.addColorStop(0, 'rgba(202,168,103,.14)');
  glow.addColorStop(1, 'rgba(202,168,103,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Double gold frame with a pointed (mihrab) arch at the top.
  const arch = (inset) => {
    const l = inset, r = W - inset, b = H - inset, shoulder = 150 + inset * 0.6, apex = inset;
    ctx.beginPath();
    ctx.moveTo(l, b);
    ctx.lineTo(l, shoulder);
    ctx.bezierCurveTo(l, shoulder - 70, W / 2 - 150, apex + 34, W / 2, apex);
    ctx.bezierCurveTo(W / 2 + 150, apex + 34, r, shoulder - 70, r, shoulder);
    ctx.lineTo(r, b);
    ctx.closePath();
  };
  ctx.lineWidth = 2;
  ctx.strokeStyle = GOLD_SOFT;
  arch(44);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  arch(60);
  ctx.stroke();
  // Small crescent at the apex.
  ctx.save();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(W / 2, 30, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(W / 2 + 4, 27, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Header: logo + name, and the kind label.
  ctx.direction = 'ltr';
  const headY = first ? 128 : 118;
  if (logo) {
    ctx.save();
    const s = 46, x = W / 2 - 128, y = headY - 34;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, s, s, 12) : ctx.rect(x, y, s, s);
    ctx.clip();
    ctx.drawImage(logo, x, y, s, s);
    ctx.restore();
  }
  ctx.textAlign = logo ? 'left' : 'center';
  ctx.font = `700 22px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('RISE UPON DEEN', logo ? W / 2 - 68 : W / 2, headY - 4);
  if (first) {
    ctx.textAlign = 'center';
    ctx.font = `700 17px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(String(kind || '').toUpperCase().split('').join(' '), W / 2, 186);
    ornament(ctx, 212);
  } else {
    ctx.textAlign = 'center';
    ctx.font = `600 15px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(`${String(kind || '').toUpperCase()} · CONTINUED`, W / 2, 160);
  }

  // Footer.
  ctx.fillStyle = 'rgba(202,168,103,.34)';
  ctx.fillRect(110, 1214, W - 220, 1);
  ctx.textAlign = 'left';
  ctx.font = `600 18px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('riseupondeen.web.app', 120, 1258);
  ctx.textAlign = 'right';
  ctx.fillStyle = PAPER;
  ctx.fillText('@riseupondeen', W - 120, 1258);
  if (pageCount > 1) {
    ctx.textAlign = 'center';
    ctx.font = `700 18px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(`${pageNo} / ${pageCount}`, W / 2, 1258);
  }
}

/** A thin gold rule with a small diamond in the middle. */
function ornament(ctx, y) {
  ctx.save();
  ctx.fillStyle = GOLD;
  const g = ctx.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0);
  g.addColorStop(0, 'rgba(202,168,103,0)');
  g.addColorStop(0.5, 'rgba(202,168,103,.8)');
  g.addColorStop(1, 'rgba(202,168,103,0)');
  ctx.fillStyle = g;
  ctx.fillRect(W / 2 - 120, y, 240, 1.5);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(W / 2, y - 6);
  ctx.lineTo(W / 2 + 6, y + 0.75);
  ctx.lineTo(W / 2, y + 7.5);
  ctx.lineTo(W / 2 - 6, y + 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPage(ctx, page) {
  for (const l of page.lines) {
    if (l.kind === 'divider') {
      ornament(ctx, l.y);
      continue;
    }
    ctx.font = l.spec.font;
    ctx.fillStyle = l.spec.color;
    ctx.direction = l.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillText(l.text, W / 2, l.y);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster-export-failed'))), type, quality),
  );
}

/** Minimal PDF (one JPEG image per page, 4:5). Enough for every PDF viewer; no dependency. */
async function buildPdf(jpegs) {
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    size += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    for (const b of body) push(b);
    push('\nendobj\n');
  };
  const PW = 432, PH = 540; // points (6 × 7.5 in), same 4:5 ratio as the image
  const n = jpegs.length;
  // 1 catalog, 2 pages, then per page: page, content, image
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`]);
  for (let i = 0; i < n; i++) {
    const p = 3 + i * 3;
    const data = new Uint8Array(await jpegs[i].arrayBuffer());
    obj(p, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`]);
    const stream = `q ${PW} 0 0 ${PH} 0 0 cm /Im${i} Do Q`;
    obj(p + 1, [`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
    obj(p + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`,
      data,
      '\nendstream',
    ]);
  }
  const xref = size;
  const total = 3 + n * 3;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let exporting = false;

/** Renders the poster pages. Exported for tests and for the share flow. */
async function renderPosterPages(content) {
  const measure = document.createElement('canvas').getContext('2d');
  // Fonts first (at the largest scale we might use), so measuring and drawing agree.
  await ensureFonts(1.3);
  await ensureFonts(1);
  const layout = layoutPoster(measure, content);
  const logo = await loadLogo();
  const canvases = layout.pages.map((page, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, { kind: content.kind, pageNo: i + 1, pageCount: layout.pages.length, logo, first: i === 0 });
    drawPage(ctx, page);
    return canvas;
  });
  return { layout, canvases };
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
  if (exporting) return; // one export at a time (double taps)
  exporting = true;
  try {
    const content = { kind, title, arabic, transliteration, body, reference };
    const { layout, canvases } = await renderPosterPages(content);
    const pageCount = canvases.length;
    // Lets tests check that every word made it onto a page (public content only).
    window.__RUD_POSTER_LAST = {
      pages: pageCount,
      scale: layout.scale,
      text: layout.pages.map((p) => p.lines.filter((l) => l.text).map((l) => l.text)),
      maxY: Math.max(...layout.pages.flatMap((p) => p.lines.map((l) => l.y))),
    };
    const clean = safeFileName(fileName || title || 'rise-upon-deen');
    const pngs = await Promise.all(canvases.map((c) => canvasBlob(c, 'image/png')));
    const names = pngs.map((_, i) => (pageCount > 1 ? `${clean}-rise-upon-deen-${i + 1}-of-${pageCount}.png` : `${clean}-rise-upon-deen.png`));
    if (navigator.share && navigator.canShare && typeof File === 'function') {
      const files = pngs.map((b, i) => new File([b], names[i], { type: 'image/png' }));
      if (navigator.canShare({ files })) {
        try {
          await navigator.share({ title: String(title), files });
          toast(pageCount > 1 ? `Poster ready to share (${pageCount} pages).` : 'Poster ready to share.');
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
    }
    if (pageCount === 1) {
      saveBlob(pngs[0], names[0]);
      toast('Poster downloaded.');
    } else {
      const jpegs = await Promise.all(canvases.map((c) => canvasBlob(c, 'image/jpeg', 0.92)));
      saveBlob(await buildPdf(jpegs), `${clean}-rise-upon-deen.pdf`);
      toast(`Poster downloaded (${pageCount} pages, PDF).`);
    }
  } catch (e) {
    console.warn(e);
    toast('Unable to create the poster on this device.', 'error');
  } finally {
    exporting = false;
  }
}

export { layoutPoster, renderPosterPages, rudExportRisePoster };
