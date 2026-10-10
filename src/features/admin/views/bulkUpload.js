/**
 * Admin › Upload: Excel/CSV bulk import (SheetJS is loaded on demand), preview, validation and batched writes.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../../runtime/store';
import { cacheAdminContent, cacheBulkRows, clearBulkCache, restoreBulkRows } from '../adminPersistence';
import { adminHeader } from '../adminRouter';
import { renderAdminView } from '../adminViews';
import { renderHomeLive } from '../../home/homeContent';
import { $, $$, COLLECTION } from '../../../runtime/core';
import { cachePublicContent, rudDeduplicateContent } from '../../../services/content/publicContentCache';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from '../../../services/firebase/sdk';
import { busy, esc, label, millis, safeUrl, toast } from '../../../utils/ui';

let BULK_TYPES, bulkImportRunning;

function bulkKey(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
function bulkBool(v, def = false) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const x = String(v ?? '')
    .trim()
    .toLowerCase();
  if (['yes', 'y', 'true', '1', 'published', 'publish'].includes(x)) return true;
  if (['no', 'n', 'false', '0', 'draft', 'unpublished'].includes(x)) return false;
  return def;
}
function bulkValue(row, ...keys) {
  const normalized = {};
  Object.entries(row || {}).forEach(([k, v]) => (normalized[bulkKey(k)] = v));
  for (const k of keys) {
    const v = normalized[bulkKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}
function inferBulkType(row, sheetName = '') {
  const raw = String(bulkValue(row, 'type', 'content type', 'contenttype') || sheetName)
    .trim()
    .toLowerCase();
  return BULK_TYPES[raw] || BULK_TYPES[raw.replace(/\s+/g, ' ')] || '';
}
function normalizeBulkRow(row, sheetName, rowNumber, forcedType = '') {
  const type = forcedType || inferBulkType(row, sheetName);
  const d = {
    __row: rowNumber,
    __sheet: sheetName,
    type,
    title: String(
      bulkValue(
        row,
        'title',
        'article title',
        'hadith title',
        'dua title',
        'reminder title',
        'transliteration',
        'name',
      ) || '',
    ).trim(),
    number: Number(bulkValue(row, 'number', 'name number', 'no', 'index')) || null,
    description: String(bulkValue(row, 'description', 'short description') || '').trim(),
    content: String(
      bulkValue(row, 'content', 'full article content', 'article content', 'reminder text', 'text') || '',
    ).trim(),
    author: String(bulkValue(row, 'author') || 'Rise Upon Deen').trim(),
    image: String(bulkValue(row, 'image', 'image url', 'featured image', 'featured image url') || '').trim(),
    mediaUrl: String(bulkValue(row, 'media url', 'file url', 'attachment url') || '').trim(),
    mediaName: String(bulkValue(row, 'media name', 'file name') || '').trim(),
    mediaType: String(bulkValue(row, 'media type', 'file type') || '').trim(),
    arabic: String(bulkValue(row, 'arabic', 'arabic text', 'arabic name') || '').trim(),
    translation: String(bulkValue(row, 'translation', 'english translation') || '').trim(),
    source: String(bulkValue(row, 'source') || '').trim(),
    reference: String(
      bulkValue(row, 'reference', 'hadith number', 'hadith reference', 'quran reference', "qur'an reference") || '',
    ).trim(),
    reflection: String(bulkValue(row, 'reflection', 'short reflection', 'description reflection') || '').trim(),
    transliteration: String(bulkValue(row, 'transliteration') || '').trim(),
    meaning: String(bulkValue(row, 'meaning', 'english meaning') || '').trim(),
    whenToRecite: String(
      bulkValue(row, 'when to recite', 'when to remember', 'when to remember this name', 'when') || '',
    ).trim(),
    category: String(bulkValue(row, 'category') || 'General').trim(),
    keywords: String(bulkValue(row, 'keywords', 'moods', 'search keywords', 'mood keywords') || '').trim(),
    recommendedCount: (() => {
      const raw = bulkValue(row, 'recommended count', 'recommendedcount', 'prescribed count', 'count');
      const n = Number(raw);
      return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    })(),
    displayOrder: (() => {
      const raw = bulkValue(row, 'display order', 'displayorder', 'order', 'sort order', 'sequence');
      const n = Number(raw);
      return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    })(),
    featured: bulkBool(bulkValue(row, 'featured'), false),
    published: bulkBool(bulkValue(row, 'published', 'status', 'publish status'), type === 'zikr' ? false : true),
  };

  // For Names, transliteration is the title used throughout the existing CMS.
  if (type === 'name' && !d.title && d.transliteration) d.title = d.transliteration;
  if (type === 'name' && !d.transliteration) d.transliteration = d.title;

  const errors = [];
  if (!type) errors.push('Type missing or unrecognized');
  if (!d.title) errors.push('Title / transliteration is required');
  if (type === 'hadith' && !d.translation) errors.push('English translation is required');
  if (type === 'dua' && !d.arabic) errors.push('Arabic is required');
  if (type === 'dua' && !d.meaning) errors.push('Meaning is required');
  if (type === 'reminder' && !d.content) errors.push('Reminder text is required');
  if (type === 'zikr') {
    if (!d.title) errors.push('Zikr title is required');
    if (!d.arabic) errors.push('Arabic is required');
    if (!d.transliteration) errors.push('Transliteration is required');
    if (!d.meaning) errors.push('Meaning is required');
  }
  if (type === 'name') {
    if (!d.number || d.number < 1 || d.number > 99) errors.push('Name number must be 1–99');
    if (!d.arabic) errors.push('Arabic Name is required');
    if (!d.meaning) errors.push('Meaning is required');
    if (!d.reflection) errors.push('Description / reflection is required');
    if (!d.whenToRecite) errors.push('When to remember this Name is required');
  }
  d.__errors = errors;
  return d;
}
async function ensureSheetJS() {
  if (window.XLSX) return true;
  if (window.__rudSheetPromise) return window.__rudSheetPromise;
  window.__rudSheetPromise = new Promise((resolve) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    sc.async = true;
    sc.onload = () => resolve(!!window.XLSX);
    sc.onerror = () => {
      window.__rudSheetPromise = null;
      resolve(false);
    };
    document.head.appendChild(sc);
  });
  return window.__rudSheetPromise;
}
function bulkTemplateRows() {
  return {
    Hadith: [
      {
        Type: 'hadith',
        Title: 'Example Hadith',
        Arabic: '',
        EnglishTranslation: 'Enter verified translation',
        Source: 'Sahih al-Bukhari',
        Reference: 'Enter verified reference',
        Reflection: 'Short reflection',
        Category: 'Character',
        Keywords: 'anger, patience',
        Featured: 'No',
        Published: 'Yes',
      },
    ],
    Duas: [
      {
        Type: 'dua',
        Title: 'Example Dua',
        Arabic: 'Enter verified Arabic',
        Transliteration: '',
        Meaning: 'Enter verified meaning',
        Source: '',
        Reference: '',
        WhenToRecite: '',
        Reflection: '',
        Category: 'Dua',
        Keywords: 'anxiety, peace',
        Featured: 'No',
        Published: 'Yes',
      },
    ],
    Reminders: [
      {
        Type: 'reminder',
        Title: 'Example Reminder',
        ReminderText: 'Short verified reminder',
        Reference: '',
        Category: 'Faith',
        Keywords: 'forgiveness, patience',
        Featured: 'No',
        Published: 'Yes',
      },
    ],
    Names: [
      {
        Type: 'name',
        Number: 1,
        ArabicName: 'ٱلرَّحْمَٰنُ',
        Transliteration: 'Ar-Rahman',
        Meaning: 'The Most Merciful',
        Reflection: 'Short description / reflection',
        WhenToRemember: 'When seeking mercy and hope.',
        Category: 'Names of Allah',
        Published: 'Yes',
      },
    ],
    Zikr: [
      {
        Type: 'zikr',
        Title: 'Example Zikr',
        Arabic: 'Enter verified Arabic',
        Transliteration: 'Enter transliteration',
        Meaning: 'Enter meaning',
        Reference: '',
        RecommendedCount: '',
        Category: 'General',
        Order: 1,
        Published: 'Yes',
      },
    ],
  };
}
async function downloadBulkTemplate() {
  if (!(await ensureSheetJS())) return toast('Spreadsheet library is unavailable.', 'error');
  const wb = XLSX.utils.book_new();
  const sheets = bulkTemplateRows();
  Object.entries(sheets).forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  });
  XLSX.writeFile(wb, 'Rise-Upon-Deen-Bulk-Upload-Template.xlsx');
}
function renderBulkPreview() {
  const body = $('#bulkPreviewBody'),
    stats = $('#bulkStats'),
    actions = $('#bulkActions'),
    progress = $('#bulkImportProgress');
  if (!body || !stats) return;
  const valid = S.bulkRows.filter((x) => !x.__errors.length);
  const invalid = S.bulkRows.length - valid.length;
  const counts = { hadith: 0, dua: 0, reminder: 0, name: 0, zikr: 0 };
  valid.forEach((x) => {
    if (counts[x.type] !== undefined) counts[x.type]++;
  });
  stats.innerHTML = `
    <div class="bulk-stat"><small>Total Rows</small><strong>${S.bulkRows.length}</strong></div><div class="bulk-stat"><small>Ready</small><strong>${valid.length}</strong></div><div class="bulk-stat"><small>Errors</small><strong>${invalid}</strong></div><div class="bulk-stat"><small>Hadith</small><strong>${counts.hadith}</strong></div><div class="bulk-stat"><small>Duas</small><strong>${counts.dua}</strong></div><div class="bulk-stat"><small>Reminders</small><strong>${counts.reminder}</strong></div><div class="bulk-stat"><small>Names</small><strong>${counts.name}</strong></div><div class="bulk-stat"><small>Zikr</small><strong>${counts.zikr}</strong></div>`;

  body.innerHTML = S.bulkRows.length
    ? S.bulkRows
        .slice(0, 500)
        .map(
          (r) => `
    <tr class="${r.__errors.length ? 'bulk-row-error' : 'bulk-row-ok'}"><td>${esc(r.__sheet)}</td><td>${r.__row}</td><td>${esc(label(r.type || ''))}</td><td><strong>${esc(r.title || '—')}</strong></td><td>${esc(r.category || 'General')}</td><td>${r.published ? 'Published' : 'Draft'}</td><td>${r.__errors.length ? `<div class="bulk-error-text">${r.__errors.map(esc).join('<br>')}</div>` : 'Ready'}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="7">Select an Excel or CSV file to preview the rows.</td></tr>`;

  if (actions) actions.hidden = !valid.length || bulkImportRunning;
  if (progress && !bulkImportRunning && !S.bulkRows.length) {
    progress.hidden = true;
    progress.querySelector('i').style.width = '0%';
    progress.querySelector('span').textContent = '0%';
  }
}
async function readBulkFile(file) {
  if (!file) return false;
  if (bulkImportRunning) return false;
  S.bulkRows = [];
  renderBulkPreview();
  await updateBulkImportProgress(0, 1, 'Reading file… · 0%');
  if (!(await ensureSheetJS())) {
    toast('Spreadsheet reader could not load. Check your internet connection.', 'error');
    return false;
  }
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    if (!wb?.SheetNames?.length) throw new Error('workbook-empty');

    const isCsv = /\.csv$/i.test(file.name || '');
    const sheetInfo = wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
      const headerIndex = matrix.findIndex((row) => {
        const keys = (Array.isArray(row) ? row : []).map(bulkKey).filter(Boolean);
        if (!keys.length) return false;
        const hits = keys.filter((k) =>
          [
            'type',
            'contenttype',
            'title',
            'zikrtitle',
            'arabic',
            'arabictext',
            'transliteration',
            'meaning',
            'reference',
            'recommendedcount',
            'category',
            'order',
            'displayorder',
            'published',
            'status',
          ].includes(k),
        ).length;
        return hits >= 2 || keys.includes('title') || keys.includes('arabic');
      });
      if (headerIndex < 0)
        return { sheetName, sheet, headerIndex: -1, json: [], detected: inferBulkType({}, sheetName) };
      const json = XLSX.utils.sheet_to_json(sheet, { range: headerIndex, defval: '', raw: false, blankrows: false });
      const rowType = json.map((r) => inferBulkType(r, sheetName)).find(Boolean) || '';
      return { sheetName, sheet, headerIndex, json, detected: rowType || inferBulkType({}, sheetName) };
    });

    let selectedSheets = sheetInfo;
    if (S.bulkPresetType) {
      const exact = sheetInfo.filter((info) => info.detected === S.bulkPresetType);
      if (exact.length) selectedSheets = exact;
      else if (sheetInfo.length === 1 || isCsv) selectedSheets = sheetInfo;
      else {
        const names = wb.SheetNames.join(', ');
        const err = new Error(`Expected ${label(S.bulkPresetType)} sheet was not found. Workbook sheets: ${names}`);
        err.code = 'missing-content-sheet';
        throw err;
      }
    }

    const rows = [];
    let skippedOtherTypes = 0;
    for (const info of selectedSheets) {
      if (info.headerIndex < 0) {
        if (S.bulkPresetType) {
          const err = new Error(`Header row could not be detected in sheet "${info.sheetName}".`);
          err.code = 'missing-header';
          throw err;
        }
        continue;
      }
      info.json.forEach((row, i) => {
        if (Object.values(row).every((v) => String(v ?? '').trim() === '')) return;
        const detected = inferBulkType(row, info.sheetName);
        if (S.bulkPresetType && detected && detected !== S.bulkPresetType) {
          skippedOtherTypes++;
          return;
        }
        const normalized = normalizeBulkRow(
          row,
          info.sheetName,
          info.headerIndex + i + 2,
          S.bulkPresetType || detected || '',
        );
        if (S.bulkPresetType && normalized.type !== S.bulkPresetType) {
          skippedOtherTypes++;
          return;
        }
        rows.push(normalized);
      });
    }

    const seenBulk = new Set();
    const existingKeys = new Set(
      S.adminContent.map((x) => {
        if (x.type === 'name') return `name|${Number(x.number) || 0}`;
        if (x.type === 'zikr')
          return `zikr|${String(x.title || '')
            .trim()
            .toLowerCase()}|${String(x.arabic || '').trim()}`;
        return `${x.type || ''}|${String(x.reference || x.title || '')
          .trim()
          .toLowerCase()}`;
      }),
    );
    rows.forEach((r) => {
      const key =
        r.type === 'name'
          ? `name|${Number(r.number) || 0}`
          : r.type === 'zikr'
            ? `zikr|${String(r.title || '')
                .trim()
                .toLowerCase()}|${String(r.arabic || '').trim()}`
            : `${r.type || ''}|${String(r.reference || r.title || '')
                .trim()
                .toLowerCase()}`;
      if (seenBulk.has(key)) r.__errors.push('Duplicate row in this upload file');
      else seenBulk.add(key);
      if (existingKeys.has(key)) r.__errors.push('Matching content already exists in Admin');
      if (r.image && !safeUrl(r.image)) r.__errors.push('Image URL is invalid');
      if ((r.title || '').length > 180) r.__errors.push('Title is too long');
    });

    S.bulkRows = rows;
    cacheBulkRows();
    const fileName = $('#bulkFileName');
    if (fileName) fileName.textContent = `${file.name} · ${rows.length} row${rows.length === 1 ? '' : 's'}`;
    renderBulkPreview();
    if (!rows.length) {
      await updateBulkImportProgress(0, 1, '0% · No data rows found');
      toast(
        S.bulkPresetType
          ? `No ${label(S.bulkPresetType)} rows were found in this file. Check the worksheet name and headers.`
          : 'No data rows were found in this file.',
        'error',
      );
      return false;
    }
    const foundLabel = S.bulkPresetType ? `${label(S.bulkPresetType)} ` : '';
    await updateBulkImportProgress(
      0,
      rows.length,
      `Found ${rows.length} ${foundLabel}row${rows.length === 1 ? '' : 's'} · 0%`,
    );
    toast(
      skippedOtherTypes && S.bulkPresetType
        ? `Found ${rows.length} ${label(S.bulkPresetType)} row${rows.length === 1 ? '' : 's'}. Other sheets were ignored.`
        : `Found ${rows.length} row${rows.length === 1 ? '' : 's'}. Review validation, then import.`,
    );
    return true;
  } catch (e) {
    console.error('Spreadsheet read failed', e);
    S.bulkRows = [];
    renderBulkPreview();
    const message =
      e?.code === 'missing-content-sheet' || e?.code === 'missing-header'
        ? e.message
        : 'Unable to read this spreadsheet. Use a valid XLSX, XLS or CSV file.';
    await updateBulkImportProgress(0, 1, `0% · ${message}`);
    toast(message, 'error');
    return false;
  }
}
function updateBulkImportProgress(completed, total, message = '') {
  const progress = $('#bulkImportProgress');
  if (!progress) return Promise.resolve();

  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCompleted = Math.min(safeTotal, Math.max(0, Number(completed) || 0));
  const pct = Math.round((safeCompleted / safeTotal) * 100);
  const bar = progress.querySelector('i');
  const text = progress.querySelector('span');

  progress.hidden = false;
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(pct));

  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = message || `${safeCompleted} / ${safeTotal} rows · ${pct}%`;

  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      void progress.offsetWidth;
      requestAnimationFrame(resolve);
    }),
  );
}
function cleanBulkPayload(row) {
  const clean = { ...row };
  delete clean.__row;
  delete clean.__sheet;
  delete clean.__errors;
  Object.keys(clean).forEach((k) => {
    if (clean[k] === undefined) delete clean[k];
  });
  return {
    ...clean,
    published: clean.published === true,
    featured: clean.featured === true,
    recommendedCount: clean.recommendedCount ?? null,
    displayOrder: clean.displayOrder ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
async function readBackImportedContent(importedMeta) {
  const types = [...new Set(importedMeta.map((x) => x.type).filter(Boolean))];
  const byId = new Map();
  for (const type of types) {
    const snap = await getDocs(query(collection(S.db, COLLECTION), where('type', '==', type)));
    snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  }
  const missing = importedMeta.filter((x) => !byId.has(x.id));
  if (missing.length) {
    const e = new Error(
      `${missing.length} imported record${missing.length === 1 ? '' : 's'} could not be confirmed by database read-back.`,
    );
    e.code = 'readback-mismatch';
    throw e;
  }
  const records = importedMeta.map((x) => byId.get(x.id));
  const badZikr = records.filter(
    (x) =>
      x.type === 'zikr' &&
      (!x.title || !x.arabic || !x.transliteration || !x.meaning || typeof x.published !== 'boolean'),
  );
  if (badZikr.length) {
    const e = new Error(
      `${badZikr.length} Zikr record${badZikr.length === 1 ? '' : 's'} failed schema verification after saving.`,
    );
    e.code = 'readback-schema';
    throw e;
  }
  return records;
}
async function importBulkRows() {
  if (bulkImportRunning) return;
  if (!S.firebaseReady || !S.auth?.currentUser) return toast('Secure admin session is unavailable.', 'error');
  if (!S.bulkRows.length) return toast('Select a spreadsheet first.', 'error');
  const validCount = S.bulkRows.filter((x) => !x.__errors.length).length;
  if (!validCount) return toast('There are no valid rows to import. Review the Validation column.', 'error');

  const btn = $('#bulkImportBtn');
  bulkImportRunning = true;
  busy(btn, true, 'Importing…');
  const total = S.bulkRows.length;
  await updateBulkImportProgress(0, total, `0 / ${total} rows · 0%`);

  const returnType = S.bulkPresetType || '';
  const importedMeta = [];
  const writeFailures = [];
  let processed = 0,
    skipped = 0;

  try {
    for (const row of S.bulkRows) {
      if (row.__errors.length) {
        skipped++;
        processed++;
        await updateBulkImportProgress(processed, total);
        continue;
      }
      try {
        const ref = doc(collection(S.db, COLLECTION));
        const payload = cleanBulkPayload(row);
        await setDoc(ref, payload);
        importedMeta.push({ id: ref.id, type: payload.type, row });
      } catch (error) {
        console.error(`Zikr/content import failed at Excel row ${row.__row}:`, error);
        const reason =
          error?.code === 'permission-denied'
            ? 'Permission denied by Firestore rules'
            : error?.message || 'Database write failed';
        row.__errors.push(`Database write failed: ${reason}`);
        writeFailures.push({ row: row.__row, sheet: row.__sheet, reason });
        skipped++;
      }
      processed++;
      await updateBulkImportProgress(processed, total);
    }

    if (!importedMeta.length) {
      renderBulkPreview();
      await updateBulkImportProgress(total, total, `${total} / ${total} rows · 100% · 0 imported, ${skipped} skipped`);
      return toast(`0 imported, ${skipped} skipped. Review the row errors and retry.`, 'error');
    }

    await updateBulkImportProgress(total, total, `${total} / ${total} rows · 100% · Verifying saved records…`);
    const verified = await readBackImportedContent(importedMeta);

    const adminMap = new Map(S.adminContent.map((x) => [x.id, x]));
    verified.forEach((x) => adminMap.set(x.id, x));
    S.adminContent = [...adminMap.values()].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    cacheAdminContent(S.adminContent);

    const publicMap = new Map((Array.isArray(S.publicContent) ? S.publicContent : []).map((x) => [x.id, x]));
    verified.forEach((x) => {
      if (x.published === true) publicMap.set(x.id, x);
      else publicMap.delete(x.id);
    });
    S.publicContent = rudDeduplicateContent([...publicMap.values()], { publishedOnly: true });
    window.RUD_PUBLIC_CONTENT = S.publicContent;
    cachePublicContent(S.publicContent);
    renderHomeLive();

    const imported = verified.length;
    const summary = `${imported} imported, ${skipped} skipped`;
    await updateBulkImportProgress(total, total, `${total} / ${total} rows · 100% · ${summary}`);
    toast(
      skipped
        ? `${summary}. Review skipped rows for details.`
        : `${imported} ${returnType ? label(returnType) + ' ' : ''}record${imported === 1 ? '' : 's'} imported successfully.`,
      skipped ? 'error' : 'ok',
    );

    clearBulkCache();

    if (skipped) {
      S.bulkRows = S.bulkRows.filter((r) => r.__errors.length);
      cacheBulkRows();
      renderBulkPreview();
      await updateBulkImportProgress(total, total, `${total} / ${total} rows · 100% · ${summary}`);
    } else {
      S.bulkRows = [];
      S.bulkPresetType = '';
      const view = returnType
        ? { hadith: 'hadith', dua: 'duas', reminder: 'reminders', name: 'names', zikr: 'zikr' }[returnType] || 'manage'
        : 'manage';
      S.currentAdminView = view;
      renderAdminView(view);
    }
  } catch (e) {
    console.error('Bulk import failed', e);
    const message =
      e?.code === 'permission-denied'
        ? 'Permission denied. Your Firestore rules are blocking this import.'
        : e?.code === 'unavailable'
          ? 'Firebase is temporarily unavailable. Check your connection and retry.'
          : e?.code === 'readback-mismatch' || e?.code === 'readback-schema'
            ? `Records were written, but verification failed: ${e.message}`
            : `Bulk import failed${e?.code ? ` (${e.code})` : ''}.`;
    await updateBulkImportProgress(
      processed,
      total,
      `${processed} / ${total} rows · ${Math.round((processed / Math.max(1, total)) * 100)}% · Import stopped`,
    );
    toast(message, 'error');
  } finally {
    bulkImportRunning = false;
    busy(btn, false);
    const actions = $('#bulkActions');
    if (actions) actions.hidden = !S.bulkRows.some((x) => !x.__errors.length);
  }
}
function bulkUploadView(presetType = '') {
  if (presetType !== undefined) S.bulkPresetType = presetType || S.bulkPresetType || '';
  S.currentAdminView = 'upload';
  if (!S.bulkRows.length) {
    const restored = restoreBulkRows();
    if (restored && S.bulkPresetType && S.bulkRows.some((r) => r.type !== S.bulkPresetType)) {
      S.bulkRows = [];
      clearBulkCache();
    }
  }
  const typeName = S.bulkPresetType ? label(S.bulkPresetType) : 'Mixed Content';
  $('#adminMain').innerHTML =
    `${adminHeader(S.bulkPresetType ? `Upload ${typeName}` : 'Upload Content File', S.bulkPresetType ? `Import only ${typeName}. A full workbook is allowed; other sheets are ignored.` : 'Import Hadith, Duas, Reminders, Names and Zikr from one workbook.', false)}
  <div class="admin-upload-type-strip">
    <button type="button" data-upload-type="hadith" class="${S.bulkPresetType === 'hadith' ? 'active' : ''}">Hadith</button>
    <button type="button" data-upload-type="dua" class="${S.bulkPresetType === 'dua' ? 'active' : ''}">Duas</button>
    <button type="button" data-upload-type="reminder" class="${S.bulkPresetType === 'reminder' ? 'active' : ''}">Reminders</button>
    <button type="button" data-upload-type="name" class="${S.bulkPresetType === 'name' ? 'active' : ''}">99 Names</button>
    <button type="button" data-upload-type="zikr" class="${S.bulkPresetType === 'zikr' ? 'active' : ''}">Zikr</button>
    <button type="button" data-upload-type="" class="${!S.bulkPresetType ? 'active' : ''}">Mixed Workbook</button>
  </div>
  <div class="bulk-upload-shell">
    <section class="admin-panel admin-file-import-panel">
      <div class="admin-file-import-title"><span class="eyebrow">${S.bulkPresetType ? 'TYPE-SPECIFIC IMPORT' : 'BULK IMPORT'}</span><h2>${S.bulkPresetType ? `Upload ${typeName} File` : 'Upload Complete Workbook'}</h2><p>${S.bulkPresetType ? `Upload the full workbook or a ${typeName}-only file. Only matching rows will be loaded.` : 'Upload the Rise Upon Deen workbook or a mixed sheet with a Type column.'}</p></div>
      <label class="bulk-upload-drop" for="bulkFileInput"><input id="bulkFileInput" type="file" accept=".xlsx,.xls,.csv" hidden><div><div class="bulk-upload-icon">↑</div><strong>Choose Excel or CSV</strong><span id="bulkFileName">Choose an .xlsx, .xls or .csv file</span></div></label>
      <div class="bulk-actions" style="margin-top:14px"><button class="premium-btn" id="downloadBulkTemplate" type="button">Download Excel Template</button><button class="premium-btn" id="backToContentLibrary" type="button">Back to ${S.bulkPresetType ? typeName : 'Content'}</button></div>
    </section>
    <section class="bulk-help"><h3>Import rules</h3><ul><li><strong>Published = Yes</strong> makes content visible publicly.</li><li>Type-specific upload ignores other worksheets.</li><li>Hadith: Title + English Translation required.</li><li>Dua: Title + Arabic + Meaning required.</li><li>Reminder: Title + Reminder Text required.</li><li>Names: Number + Arabic Name + Transliteration + Meaning required. Reflection and When to Remember are optional.</li><li>Zikr: Title + Arabic + Transliteration + Meaning required. Reference, Recommended Count and Category are optional.</li></ul></section>
    <section class="admin-panel"><div class="admin-panel-head"><h2>Import Preview</h2><span class="muted">Nothing is written to Firebase until Import Valid Rows.</span></div><div class="bulk-meta" id="bulkStats"></div><div class="bulk-preview-wrap" style="margin-top:16px"><table class="bulk-preview"><thead><tr><th>Sheet</th><th>Row</th><th>Type</th><th>Title</th><th>Category</th><th>Status</th><th>Validation</th></tr></thead><tbody id="bulkPreviewBody"></tbody></table></div><div class="bulk-import-progress" id="bulkImportProgress" hidden style="margin-top:16px"><i></i><span>0%</span></div><div class="bulk-actions" id="bulkActions" hidden style="margin-top:16px"><button class="premium-btn" id="clearBulkBtn" type="button">Clear</button><button class="premium-btn primary" id="bulkImportBtn" type="button">Import Valid Rows to Firebase</button></div></section>
  </div>`;
  $('#bulkFileInput')?.addEventListener('change', (e) => readBulkFile(e.target.files?.[0]));
  $('#downloadBulkTemplate')?.addEventListener('click', downloadBulkTemplate);
  $('#clearBulkBtn')?.addEventListener('click', () => {
    S.bulkRows = [];
    clearBulkCache();
    const input = $('#bulkFileInput');
    if (input) input.value = '';
    const name = $('#bulkFileName');
    if (name) name.textContent = 'Choose an .xlsx, .xls or .csv file';
    renderBulkPreview();
  });
  $('#bulkImportBtn')?.addEventListener('click', importBulkRows);
  $('#backToContentLibrary')?.addEventListener('click', () => {
    const view =
      { hadith: 'hadith', dua: 'duas', reminder: 'reminders', name: 'names', zikr: 'zikr' }[S.bulkPresetType] ||
      'manage';
    S.bulkRows = [];
    clearBulkCache();
    S.bulkPresetType = '';
    renderAdminView(view);
  });
  $$('[data-upload-type]').forEach((btn) =>
    btn.addEventListener('click', () => {
      S.bulkRows = [];
      clearBulkCache();
      S.bulkPresetType = btn.dataset.uploadType || '';
      bulkUploadView(S.bulkPresetType);
    }),
  );
  renderBulkPreview();
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  BULK_TYPES = {
    hadith: 'hadith',
    hadiths: 'hadith',
    dua: 'dua',
    duas: 'dua',
    reminder: 'reminder',
    reminders: 'reminder',
    name: 'name',
    names: 'name',
    'names of allah': 'name',
    zikr: 'zikr',
    zikrs: 'zikr',
    dhikr: 'zikr',
    dhikrs: 'zikr',
    'tasbih zikr': 'zikr',
    'tasbih zikrs': 'zikr',
  };
  bulkImportRunning = false;
}

export { bulkUploadView, readBulkFile };
