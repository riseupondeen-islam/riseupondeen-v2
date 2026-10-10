/**
 * Ask Rise: conversational retrieval over published Duas, Hadith, Reminders and Qur'anic names; voice input and read-aloud.
 *
 * Migrated from the original single-file index.html. Module-level functions are the original
 * function declarations; init() runs the original top-level statements and is called once, in
 * the original order, by runtime/legacyRuntime.ts (admin modules: features/admin/adminConsole.ts).
 */
import { S } from '../../runtime/store';
import { RUD_QURANIC_NAMES } from './quranicNames';
import { rudOfflineItems } from '../my-deen/myDeen';
import { rudQuranCloseSheet, rudQuranMinimizePlayer } from '../quran/quran';
import { $ } from '../../runtime/core';
import { rudDeduplicateContent } from '../../services/content/publicContentCache';
import { publicSnapshotComplete } from '../../services/content/publicContentSync';
import { closeLayer, esc, millis, openLayer, route } from '../../utils/ui';

let ASK_RISE_SESSION_KEY,
  ASK_RISE_TYPES,
  ASK_RISE_NO_MATCH,
  ASK_RISE_GREETING,
  ASK_RISE_STOPWORDS,
  ASK_RISE_INTENTS,
  askRiseState,
  askRiseRecognition,
  askRiseListening,
  askRiseRecognitionText,
  askRiseVoiceError,
  askRiseSpeakingBubble,
  askRiseSubmissionLocked,
  askRiseLastSubmission,
  askRiseIndexSource,
  askRiseIndex,
  askRiseSearchFieldCache;

/* ==============================
   ASK RISE
   Conversational retrieval over existing published Firestore content only.
   No Islamic content is generated or stored by Ask Rise.
================================ */
function combinedPublicContent() {
  const live = Array.isArray(S.publicContent) ? S.publicContent.filter((x) => x && x.published === true) : [];
  const map = new Map(live.map((x) => [x.id, x]));
  rudOfflineItems().forEach((x) => {
    if (x?.id && !map.has(x.id)) map.set(x.id, x);
  });
  return rudDeduplicateContent([...map.values()], { publishedOnly: true });
}
function findPublicItem(id) {
  return combinedPublicContent().find((x) => x.id === id && x.published);
}
function askRiseDefaultState() {
  return { messages: [], lastQuery: '', lastTerms: [], lastType: null, shownIds: [], pendingType: null };
}
function askRiseSafeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => ({
      label: String(option?.label || '').slice(0, 90),
      query: String(option?.query || option?.label || '').slice(0, 140),
      type: ASK_RISE_TYPES.has(option?.type) ? option.type : null,
      itemId: typeof option?.itemId === 'string' ? option.itemId : '',
    }))
    .filter((option) => option.label && option.query && option.type);
}
function loadAskRiseState() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ASK_RISE_SESSION_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return askRiseDefaultState();
    return {
      messages: Array.isArray(raw.messages)
        ? raw.messages.slice(-30).map((message) => ({
            ...message,
            options: askRiseSafeOptions(message?.options),
          }))
        : [],
      lastQuery: String(raw.lastQuery || ''),
      lastTerms: Array.isArray(raw.lastTerms) ? raw.lastTerms.filter((x) => typeof x === 'string').slice(0, 40) : [],
      lastType: ASK_RISE_TYPES.has(raw.lastType) ? raw.lastType : null,
      shownIds: Array.isArray(raw.shownIds) ? raw.shownIds.filter((x) => typeof x === 'string').slice(-80) : [],
      pendingType: ASK_RISE_TYPES.has(raw.pendingType) ? raw.pendingType : null,
    };
  } catch {
    return askRiseDefaultState();
  }
}
function saveAskRiseState() {
  try {
    askRiseState.messages = askRiseState.messages.slice(-30);
    askRiseState.shownIds = askRiseState.shownIds.slice(-80);
    sessionStorage.setItem(ASK_RISE_SESSION_KEY, JSON.stringify(askRiseState));
  } catch {}
}
function askRiseNormalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function askRiseField(value) {
  if (Array.isArray(value)) return value.map(askRiseField).filter(Boolean).join(' ');
  if (value === null || value === undefined || typeof value === 'object') return '';
  return askRiseNormalize(value);
}
function askRiseTokens(text) {
  return askRiseNormalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !ASK_RISE_STOPWORDS.has(t));
}
function askRiseIsNameRequest(text) {
  const q = askRiseNormalize(text);
  const hasName = /\b(name|names)\b/.test(q);
  if (!hasName) return false;
  return (
    /\b(baby|boy|girl|male|female|quran|quranic|islamic)\b/.test(q) ||
    /\b(starting|starts|beginning|begins)\b/.test(q) ||
    /\bnames?\s+with\s+[a-z]\b/.test(q)
  );
}
function askRiseRequestedType(text) {
  const words = new Set(askRiseNormalize(text).split(' '));
  if (askRiseIsNameRequest(text)) return 'quran-name';
  if (words.has('hadith') || words.has('hadiths')) return 'hadith';
  if (words.has('dua') || words.has('duas')) return 'dua';
  if (words.has('reminder') || words.has('reminders')) return 'reminder';
  return null;
}
function askRiseNameInitial(text) {
  const q = askRiseNormalize(text);
  const patterns = [
    /\b(?:starting|starts|beginning|begins)\s+(?:with\s+)?([a-z])\b/,
    /\bnames?\s+with\s+([a-z])\b/,
    /\bletter\s+([a-z])\b/,
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return '';
}
function askRiseNameGender(text) {
  const q = askRiseNormalize(text);
  if (/\b(girl|female|daughter)\b/.test(q)) return 'Girl';
  if (/\b(boy|male|son)\b/.test(q)) return 'Boy';
  return '';
}
function askRiseFindQuranNames(text) {
  const initial = askRiseNameInitial(text),
    gender = askRiseNameGender(text),
    q = askRiseNormalize(text);
  let items = RUD_QURANIC_NAMES.filter(
    (item) =>
      (!initial || item.title.toUpperCase().startsWith(initial)) &&
      (!gender || item.gender === gender || item.gender === 'Unisex'),
  );
  const direct = RUD_QURANIC_NAMES.find(
    (item) =>
      askRiseNormalize(item.title) === q ||
      q === `quran name ${askRiseNormalize(item.title)}` ||
      q === `quranic name ${askRiseNormalize(item.title)}`,
  );
  if (direct) items = [direct];
  items.sort((a, b) => a.title.localeCompare(b.title));
  return { items: items.slice(0, 24), initial, gender, direct: direct || null };
}
function askRiseQuranNameGenderOptions(initial = '') {
  return ['Boy', 'Girl'].map((gender) => ({
    label: `${gender} Names`,
    query: initial
      ? `Quran ${gender.toLowerCase()} names starting with ${initial}`
      : `Quran ${gender.toLowerCase()} names`,
    type: 'quran-name',
  }));
}
function askRiseQuranNameLetterOptions(gender) {
  const letters = [
    ...new Set(
      RUD_QURANIC_NAMES.filter((item) => item.gender === gender || item.gender === 'Unisex')
        .map((item) =>
          String(item.title || '')
            .charAt(0)
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ].sort();
  return letters.map((letter) => ({
    label: letter,
    query: `Quran ${gender.toLowerCase()} names starting with ${letter}`,
    type: 'quran-name',
  }));
}
function askRiseIsMoreRequest(text) {
  return /\b(another|more)\b/.test(askRiseNormalize(text));
}
function askRiseExpandTerms(baseTerms) {
  const out = new Set(baseTerms);
  Object.values(ASK_RISE_INTENTS).forEach((group) => {
    if (group.some((term) => baseTerms.includes(term))) group.forEach((term) => out.add(term));
  });
  return [...out];
}
function askRiseGetIndex() {
  if (askRiseIndex && askRiseIndexSource === S.publicContent) return askRiseIndex;
  const contentItems = combinedPublicContent().filter(
    (item) => item.type === 'dua' || item.type === 'hadith' || item.type === 'reminder',
  );
  const items = [...contentItems, ...RUD_QURANIC_NAMES];
  const byType = { dua: [], hadith: [], reminder: [], 'quran-name': [] };
  const byId = new Map();
  items.forEach((item) => {
    byType[item.type].push(item);
    byId.set(item.id, item);
  });
  askRiseIndex = { items, contentItems, byType, byId, topicOptions: new Map() };
  askRiseIndexSource = S.publicContent;
  return askRiseIndex;
}
function askRiseInvalidateIndex() {
  askRiseIndexSource = null;
  askRiseIndex = null;
}
function askRiseSearchFields(item) {
  const cached = askRiseSearchFieldCache.get(item);
  if (cached) return cached;
  const fields = {
    title: askRiseField(item.title),
    category: askRiseField(item.category),
    keywords: askRiseField(item.keywords),
    whenToRecite: askRiseField(item.whenToRecite),
    description: askRiseField(item.description),
    arabic: askRiseField(item.arabic),
    meaning: askRiseField(item.meaning),
    translation: askRiseField(item.translation),
    content: askRiseField(item.content),
    reflection: askRiseField(item.reflection),
    transliteration: askRiseField(item.transliteration),
    reference: askRiseField(item.reference),
    source: askRiseField(item.source),
    gender: askRiseField(item.gender),
    basis: askRiseField(item.basis),
  };
  askRiseSearchFieldCache.set(item, fields);
  return fields;
}
function askRiseScore(item, queryText, terms) {
  const fields = askRiseSearchFields(item);
  const phrase = askRiseNormalize(queryText);
  const weights = {
    title: 14,
    category: 10,
    keywords: 12,
    whenToRecite: 10,
    description: 6,
    meaning: 6,
    translation: 5,
    content: 5,
    reflection: 5,
    arabic: 3,
    transliteration: 3,
    reference: 2,
    source: 2,
    gender: 5,
    basis: 3,
  };
  const contains = (value, needle) =>
    value === needle ||
    value.startsWith(needle + ' ') ||
    value.endsWith(' ' + needle) ||
    value.includes(' ' + needle + ' ');
  const similar = (value, needle) => {
    if (!value || !needle || needle.length < 3) return false;
    const words = value.split(' ').filter(Boolean);
    return words.some((word) => {
      if (word === needle) return true;
      const min = Math.min(word.length, needle.length);
      if (
        min >= 4 &&
        (word.startsWith(needle) || needle.startsWith(word)) &&
        Math.abs(word.length - needle.length) <= 3
      )
        return true;
      if (min < 4 || word[0] !== needle[0]) return false;
      let a = word,
        b = needle;
      if (Math.abs(a.length - b.length) > 2) return false;
      const row = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const hold = row[j];
          row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
          prev = hold;
        }
      }
      return row[b.length] <= (min >= 7 ? 2 : 1);
    });
  };
  let score = 0,
    matched = 0,
    strong = false,
    close = false;

  if (phrase.length > 2) {
    if (contains(fields.title, phrase)) {
      score += 28;
      strong = true;
    } else if (
      contains(fields.category, phrase) ||
      contains(fields.keywords, phrase) ||
      contains(fields.whenToRecite, phrase)
    ) {
      score += 20;
      strong = true;
    } else if (Object.values(fields).some((v) => contains(v, phrase))) score += 9;
  }

  terms.forEach((term) => {
    let best = 0,
      near = 0;
    for (const [name, value] of Object.entries(fields)) {
      if (!value) continue;
      if (contains(value, term)) best = Math.max(best, weights[name] || 1);
      else if (['title', 'category', 'keywords', 'whenToRecite'].includes(name) && similar(value, term))
        near = Math.max(near, weights[name] || 1);
    }
    if (best) {
      score += best;
      matched++;
      if (best >= 10) strong = true;
    } else if (near) {
      score += Math.max(3, Math.round(near * 0.65));
      matched++;
      close = true;
    }
  });

  if (item.featured && score) score += 1;
  return { score, matched, strong, close };
}
function askRiseSearch(queryText, { type = null, excludeIds = [], limit = 1 } = {}) {
  const query = String(queryText || '').trim();
  let baseTerms = askRiseTokens(query);
  if (!baseTerms.length && askRiseState.lastTerms.length) baseTerms = [...askRiseState.lastTerms];
  const terms = askRiseExpandTerms(baseTerms);
  if (!terms.length) return { items: [], suggestions: [], terms: baseTerms };
  const excluded = new Set(excludeIds);
  const source = type ? askRiseGetIndex().byType[type] : askRiseGetIndex().items;

  const ranked = source
    .filter((item) => !excluded.has(item.id))
    .map((item) => ({ item, ...askRiseScore(item, query, terms) }))
    .filter((x) => x.score >= 3 && x.matched > 0)
    .sort(
      (a, b) =>
        Number(b.strong) - Number(a.strong) ||
        b.score - a.score ||
        b.matched - a.matched ||
        millis(b.item.createdAt) - millis(a.item.createdAt),
    );

  const exact = ranked.filter((x) => x.strong);
  const best = exact[0]?.score || 0;
  const floor = Math.max(5, Math.min(14, Math.floor(best * 0.28)));
  const items = exact
    .filter((x) => x.score >= floor)
    .slice(0, Math.max(1, limit))
    .map((x) => x.item);
  const suggestions = items.length
    ? []
    : ranked
        .filter((x) => x.close && !x.strong && x.score >= 5)
        .slice(0, Math.max(1, limit))
        .map((x) => x.item);
  return { items, suggestions, terms: baseTerms };
}
function askRiseCleanOptionText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function askRiseTopicOptions(type) {
  const index = askRiseGetIndex();
  if (index.topicOptions.has(type)) return index.topicOptions.get(type);
  const seen = new Set();
  const options = (index.byType[type] || [])
    .map((item) => {
      const label = askRiseCleanOptionText(item.title);
      const key = askRiseNormalize(label);
      if (!label || seen.has(key)) return null;
      seen.add(key);
      return { label, query: label, type, itemId: item.id };
    })
    .filter(Boolean);
  index.topicOptions.set(type, options);
  return options;
}
function askRiseResultOptions(items, limit = 6) {
  const seen = new Set();
  return (items || [])
    .map((item) => {
      const label = askRiseCleanOptionText(
        item.title || item.whenToRecite || item.category || askRiseTypeName(item.type),
      );
      const key = askRiseNormalize(label);
      if (!label || seen.has(key)) return null;
      seen.add(key);
      return { label, query: label, type: item.type, itemId: item.id };
    })
    .filter(Boolean)
    .slice(0, limit);
}
function askRiseTypeName(type) {
  return type === 'dua' ? 'Dua' : type === 'hadith' ? 'Hadith' : type === 'quran-name' ? 'Qur’an Name' : 'Reminder';
}
function askRiseClarificationCopy(type) {
  if (type === 'dua') return 'Here are all published Dua titles available right now. Choose the one you need.';
  if (type === 'hadith') return 'Here are all published Hadith titles available right now. Choose the one you need.';
  if (type === 'quran-name') return 'Would you like names for a boy or a girl?';
  return 'Here are all published Reminder titles available right now. Choose the one you need.';
}
function askRiseStoredPreview(item, n = 170) {
  const source =
    item.type === 'dua'
      ? item.meaning ||
        item.whenToRecite ||
        item.description ||
        item.reflection ||
        item.translation ||
        item.content ||
        ''
      : item.type === 'hadith'
        ? item.translation || item.description || item.reflection || item.content || ''
        : item.content || item.description || item.reflection || item.translation || '';
  const text = String(source || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > n ? text.slice(0, n).trimEnd() + '…' : text;
}
function askRiseResultCard(item) {
  const title = String(item.title || askRiseTypeName(item.type));
  const category = askRiseCleanOptionText(item.category);
  const preview = askRiseStoredPreview(item);
  const typeName = askRiseTypeName(item.type);
  return `<button class="ask-rise-result-card" type="button" data-search-route="${esc(route(item))}" data-ask-rise-id="${esc(item.id)}" aria-label="Open full ${esc(typeName)}: ${esc(title)}"><span class="ask-rise-result-type">${esc(typeName.toUpperCase())}</span><strong>${esc(title)}</strong>${preview ? `<span class="ask-rise-result-preview">${esc(preview)}</span>` : ''}${category ? `<span class="ask-rise-result-category">${esc(category)}</span>` : ''}<span class="ask-rise-result-open">Open Full ${esc(typeName)} <i aria-hidden="true">→</i></span></button>`;
}
function askRiseQuranNameList(items) {
  return `<div class="ask-rise-name-list" role="list" aria-label="Names from the Qur'an">${items.map((item) => `<article class="ask-rise-name-row" role="listitem" data-ask-rise-name-id="${esc(item.id)}"><div class="ask-rise-name-main"><strong>${esc(item.title)}</strong><span class="ask-rise-name-arabic" lang="ar" dir="rtl">${esc(item.arabic)}</span></div><p>${esc(item.meaning)}</p><div class="ask-rise-name-meta"><span>${esc(item.gender)}</span><span class="ask-rise-name-basis ${item.basis === 'explicit' ? 'is-explicit' : 'is-word'}">${item.basis === 'explicit' ? 'Personal name explicitly in Qur’an' : 'Qur’anic term later used as a name'}</span><span>${esc(item.reference)}</span></div></article>`).join('')}</div>`;
}
function askRiseAssistantCopy(message, visibleCount = 0, userText = '') {
  if (message.kind === 'greeting') return ASK_RISE_GREETING;
  if (message.kind === 'chat' || message.kind === 'clarify' || message.kind === 'name-start')
    return String(message.text || '');

  const q = askRiseNormalize(userText);
  const rulingQuestion =
    /\b(ruling|rulings|halal|haram|permissible|allowed|forbidden|prohibited|fiqh|bidah|biddah|innovation|shirk)\b/.test(
      q,
    );

  if (message.kind === 'no-match')
    return rulingQuestion
      ? 'I’m careful not to guess about Islamic rulings. Try asking another way, or ask me to find a relevant Dua, Hadith, or Reminder.'
      : ASK_RISE_NO_MATCH;

  if (message.kind === 'results' && visibleCount) {
    if (message.text) return String(message.text);
    const item = message.resultIds?.[0] ? askRiseGetIndex().byId.get(message.resultIds[0]) : null;
    if (item?.type === 'quran-name')
      return `Here are ${visibleCount} Qur’an-based ${visibleCount === 1 ? 'entry' : 'entries'}. The label shows whether each is an explicit personal name or a Qur’anic term later used as a name.`;
    const typeName = item ? askRiseTypeName(item.type) : 'result';
    if (askRiseIsMoreRequest(userText)) return `Of course. Here is another verified ${typeName} for you.`;
    return `I found the closest verified ${typeName} for what you asked. Here is a short preview.`;
  }
  return ASK_RISE_NO_MATCH;
}
function askRiseOptionButtons(options) {
  if (!Array.isArray(options) || !options.length) return '';
  return `<div class="ask-rise-options" role="group" aria-label="Available verified options">${options.map((option) => `<button type="button" class="ask-rise-option-chip" data-ask-rise-option data-ask-rise-type="${esc(option.type)}" data-ask-rise-query="${esc(option.query)}"${option.itemId ? ` data-ask-rise-item-id="${esc(option.itemId)}"` : ''}>${option.itemId ? `<span class="ask-rise-option-type">${esc(askRiseTypeName(option.type))}</span>` : ''}<span>${esc(option.label)}</span></button>`).join('')}</div>`;
}
function askRiseAudioControls(index) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return '';
  return `<div class="ask-rise-audio" aria-label="Voice response controls"><button type="button" data-ask-audio="play" data-ask-index="${index}" aria-label="Play response"><span aria-hidden="true">🔊</span> Play</button><button type="button" data-ask-audio="pause" data-ask-index="${index}" aria-label="Pause response"><span aria-hidden="true">Ⅱ</span> Pause</button><button type="button" data-ask-audio="stop" data-ask-index="${index}" aria-label="Stop response"><span aria-hidden="true">■</span> Stop</button></div>`;
}
function askRiseMessageHTML(message, index) {
  if (message.role === 'user')
    return `<div class="ask-rise-row is-user" data-ask-message-index="${index}"><div class="ask-rise-bubble ask-rise-user-bubble"><p>${esc(message.text || '')}</p></div></div>`;
  const items = Array.isArray(message.resultIds)
    ? message.resultIds.map((id) => askRiseGetIndex().byId.get(id)).filter(Boolean)
    : [];
  const previous = askRiseState.messages[index - 1];
  const copy = askRiseAssistantCopy(message, items.length, previous?.role === 'user' ? previous.text : '');
  const nameItems = items.filter((item) => item.type === 'quran-name');
  const cards = items.length
    ? nameItems.length === items.length
      ? askRiseQuranNameList(nameItems)
      : `<div class="ask-rise-result-grid">${items.map(askRiseResultCard).join('')}</div>`
    : '';
  const options =
    message.kind === 'clarify' || message.kind === 'name-start' ? askRiseOptionButtons(message.options) : '';
  const nameIntro =
    message.kind === 'name-start'
      ? `<div class="ask-rise-name-intro"><h3>Qur’anic Names for Children</h3><span>Beautiful names with meanings and Qur’anic references</span></div>`
      : '';
  return `<div class="ask-rise-row is-assistant" data-ask-message-index="${index}"><div class="ask-rise-avatar" aria-hidden="true">R</div><div class="ask-rise-assistant-wrap"><div class="ask-rise-bubble ask-rise-assistant-bubble">${nameIntro}<p class="ask-rise-message-copy">${esc(copy)}</p>${options}${cards}</div>${askRiseAudioControls(index)}</div></div>`;
}
function askRiseScrollToBottom(smooth = true) {
  const root = $('#askRiseChat');
  if (!root) return;
  requestAnimationFrame(() => {
    if (typeof root.scrollTo === 'function')
      root.scrollTo({ top: root.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    else root.scrollTop = root.scrollHeight;
  });
}
function askRiseAppendMessage(message, index, { scroll = true } = {}) {
  const root = $('#askRiseChat');
  if (!root) return;
  root.insertAdjacentHTML('beforeend', askRiseMessageHTML(message, index));
  if (scroll) askRiseScrollToBottom(true);
}
function renderAskRiseChat({ scroll = true } = {}) {
  const root = $('#askRiseChat');
  if (!root) return;
  if (!askRiseState.messages.length) {
    askRiseState.messages.push({ role: 'assistant', kind: 'greeting' });
    saveAskRiseState();
  }
  root.innerHTML = askRiseState.messages.map(askRiseMessageHTML).join('');
  if (scroll) askRiseScrollToBottom(false);
}
function askRiseSetLoading(on) {
  const root = $('#askRiseChat');
  if (!root) return;
  root.querySelector('.ask-rise-typing')?.remove();
  const send = $('#askRiseSend');
  if (send) send.disabled = !!on;
  root.setAttribute('aria-busy', String(!!on));
  if (on) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="ask-rise-row is-assistant ask-rise-typing"><div class="ask-rise-avatar" aria-hidden="true">R</div><div class="ask-rise-bubble ask-rise-assistant-bubble"><span>Checking verified content</span><b></b><b></b><b></b></div></div>`,
    );
    askRiseScrollToBottom(true);
  }
}
function askRiseSetVoiceState(text, mode = '') {
  const el = $('#askRiseVoiceState');
  if (el) el.textContent = text;
  const panel = $('#searchOverlay');
  panel?.classList.toggle('is-listening', mode === 'listening');
  panel?.classList.toggle('is-speaking', mode === 'speaking');
}
function askRiseAddUser(text) {
  const message = { role: 'user', text: String(text).slice(0, 500) };
  askRiseState.messages.push(message);
  saveAskRiseState();
  askRiseAppendMessage(message, askRiseState.messages.length - 1);
}
function askRiseAddAssistant(kind, items = [], text = '', options = []) {
  const message = {
    role: 'assistant',
    kind,
    resultIds: items.map((i) => i.id),
    text: String(text || '').slice(0, 300),
    options: askRiseSafeOptions(options),
  };
  askRiseState.messages.push(message);
  saveAskRiseState();
  const index = askRiseState.messages.length - 1;
  askRiseAppendMessage(message, index);
  if (askRiseSpeakingBubble === -1) {
    askRiseSpeakingBubble = null;
    askRisePlaySpeech(index);
  }
}
async function askRiseEnsureContent() {
  if (typeof publicSnapshotComplete !== 'undefined' && publicSnapshotComplete)
    return askRiseGetIndex().contentItems.length > 0;
  try {
    if (window.RUD_whenPublicReady) await window.RUD_whenPublicReady();
  } catch {}
  askRiseInvalidateIndex();
  return askRiseGetIndex().contentItems.length > 0;
}
function askRiseIsDuplicateSubmission(text) {
  const normalized = askRiseNormalize(text);
  const now = Date.now();
  const duplicate = normalized && normalized === askRiseLastSubmission.text && now - askRiseLastSubmission.at < 800;
  if (!duplicate) askRiseLastSubmission = { text: normalized, at: now };
  return duplicate;
}
async function askRiseSubmit(rawText, context = {}) {
  const text = String(rawText ?? $('#askRiseInput')?.value ?? '').trim();
  if (!text || askRiseSubmissionLocked || askRiseIsDuplicateSubmission(text)) return;
  askRiseSubmissionLocked = true;

  const input = $('#askRiseInput');
  if (input) {
    input.value = '';
    askRiseResizeInput();
  }
  askRiseAddUser(text);

  try {
    const normalized = askRiseNormalize(text);
    const greetingOnly = /^(assalamu alaikum|assalamualaikum|salam|hello|hi|hey)( there)?$/.test(normalized);
    const thanksOnly = /^(thank you|thanks|shukran|jazakallah|jazak allah|okay|ok|great|nice)$/.test(normalized);
    const capabilityOnly = /^(who are you|what can you do|how can you help|what do you do|help)$/.test(normalized);
    const smallTalkOnly =
      /^(how are you|how r you|good morning|good afternoon|good evening|good night|whats up|what is up|how is it going|how are things)$/.test(
        normalized,
      );
    if (greetingOnly || thanksOnly || capabilityOnly || smallTalkOnly) {
      const reply = greetingOnly
        ? 'Wa alaikum assalam. I’m here. Tell me what’s on your heart, or ask for authentic names from the Qur’an.'
        : thanksOnly
          ? 'You’re most welcome. What would you like help finding next?'
          : capabilityOnly
            ? 'Tell me a moment, feeling, or need, or ask for names from the Qur’an. I’ll only use verified content available here.'
            : 'I’m here and ready to help. Tell me what’s on your heart, and I’ll guide you to a relevant Dua, Hadith, or Reminder.';
      askRiseAddAssistant('chat', [], reply);
      return;
    }

    const forcedType = ASK_RISE_TYPES.has(context.forcedType) ? context.forcedType : null;
    const forcedItemId = typeof context.forcedItemId === 'string' ? context.forcedItemId : '';

    if ((forcedType === 'quran-name' || askRiseIsNameRequest(text)) && !forcedItemId) {
      const found = askRiseFindQuranNames(text);
      askRiseState.pendingType = null;
      askRiseState.lastQuery = text;
      askRiseState.lastTerms = [];
      askRiseState.lastType = 'quran-name';

      if (found.direct) {
        askRiseState.shownIds = [...new Set([...askRiseState.shownIds, found.direct.id])];
        askRiseAddAssistant(
          'results',
          [found.direct],
          'Here is the Qur’an-based name you asked for. Its basis is labelled clearly below.',
        );
        return;
      }

      if (!found.gender) {
        askRiseAddAssistant(
          'name-start',
          [],
          'Would you like names for a boy or a girl?',
          askRiseQuranNameGenderOptions(found.initial),
        );
        return;
      }

      if (!found.initial) {
        const letters = askRiseQuranNameLetterOptions(found.gender);
        askRiseAddAssistant('clarify', [], 'Which letter would you like the name to begin with?', letters);
        return;
      }

      if (found.items.length) {
        askRiseState.shownIds = [...new Set([...askRiseState.shownIds, ...found.items.map((item) => item.id)])];
        askRiseAddAssistant(
          'results',
          found.items,
          `Here are ${found.items.length} Qur’an-based ${found.gender.toLowerCase()} ${found.items.length === 1 ? 'name' : 'names'} starting with ${found.initial}. Personal names explicitly appearing in the Qur’an are kept separate from Qur’anic Arabic terms later used as names.`,
        );
      } else {
        askRiseAddAssistant(
          'chat',
          [],
          `I don’t have an authenticated Qur’an-based ${found.gender.toLowerCase()} name starting with ${found.initial} in this curated set. I won’t substitute an ordinary Arabic or Muslim name without a clear Qur’anic basis.`,
        );
      }
      return;
    }

    if (forcedItemId) {
      const item = askRiseGetIndex().byId.get(forcedItemId);
      if (item && (!forcedType || item.type === forcedType)) {
        askRiseState.pendingType = null;
        askRiseState.lastQuery = text;
        askRiseState.lastTerms = askRiseTokens(text);
        askRiseState.lastType = item.type;
        askRiseState.shownIds = [...new Set([...askRiseState.shownIds, item.id])];
        askRiseAddAssistant('results', [item], 'Here’s the one you selected.');
        return;
      }
    }

    const hadLocalContent = askRiseGetIndex().contentItems.length > 0;
    if (!hadLocalContent) {
      askRiseSetLoading(true);
      askRiseSetVoiceState('Checking verified content…');
      await askRiseEnsureContent();
      askRiseSetLoading(false);
    }

    const requestedType = askRiseRequestedType(text);
    const freshTerms = askRiseTokens(text);
    const broadType = !!(requestedType && !freshTerms.length && !forcedType);

    if (broadType) {
      const options = askRiseTopicOptions(requestedType);
      askRiseState.lastType = requestedType;
      askRiseState.pendingType = requestedType;
      askRiseState.lastQuery = '';
      askRiseState.lastTerms = [];
      if (options.length) askRiseAddAssistant('clarify', [], askRiseClarificationCopy(requestedType), options);
      else askRiseAddAssistant('no-match');
      return;
    }

    const moreRequest = askRiseIsMoreRequest(text) && freshTerms.length === 0;
    const hasFreshTopic = freshTerms.length > 0;
    const effectiveType =
      forcedType || requestedType || askRiseState.pendingType || (moreRequest ? askRiseState.lastType : null);
    const effectiveQuery = moreRequest
      ? askRiseState.lastQuery || text
      : hasFreshTopic
        ? text
        : askRiseState.lastQuery || text;
    const exclude = moreRequest ? [...askRiseState.shownIds] : [];
    let found = askRiseSearch(effectiveQuery, { type: effectiveType, excludeIds: exclude, limit: 6 });
    if (!found.items.length && typeof publicSnapshotComplete !== 'undefined' && !publicSnapshotComplete) {
      askRiseSetLoading(true);
      askRiseSetVoiceState('Checking verified content…');
      await askRiseEnsureContent();
      askRiseSetLoading(false);
      found = askRiseSearch(effectiveQuery, { type: effectiveType, excludeIds: exclude, limit: 6 });
    }

    askRiseState.pendingType = null;
    if (found.items.length > 1 && !moreRequest) {
      const options = askRiseResultOptions(found.items, 6);
      askRiseState.lastQuery = effectiveQuery;
      askRiseState.lastTerms = found.terms;
      askRiseState.lastType = effectiveType || null;
      askRiseAddAssistant(
        'clarify',
        [],
        `I found ${options.length} verified matches for “${text}”. Which one are you looking for?`,
        options,
      );
      return;
    }

    if (found.items.length) {
      const item = found.items[0];
      askRiseState.lastQuery = effectiveQuery;
      askRiseState.lastTerms = found.terms;
      askRiseState.lastType = effectiveType || item.type || null;
      askRiseState.shownIds = [...new Set([...askRiseState.shownIds, item.id])];
      askRiseAddAssistant('results', [item]);
    } else if (found.suggestions?.length) {
      const options = askRiseResultOptions(found.suggestions, 6);
      askRiseState.lastQuery = effectiveQuery;
      askRiseState.lastTerms = found.terms;
      askRiseState.lastType = effectiveType || found.suggestions[0]?.type || null;
      askRiseState.pendingType = effectiveType || null;
      askRiseAddAssistant(
        'clarify',
        [],
        options.length === 1
          ? 'I found a close verified match. Are you looking for this?'
          : 'I found a few close verified matches. Are you looking for one of these?',
        options,
      );
    } else {
      if (hasFreshTopic || forcedType || requestedType) {
        askRiseState.lastQuery = effectiveQuery;
        askRiseState.lastTerms = found.terms;
        askRiseState.lastType = effectiveType;
      }
      const fallbackType = effectiveType && ASK_RISE_TYPES.has(effectiveType) ? effectiveType : null;
      const fallbackOptions = fallbackType ? askRiseTopicOptions(fallbackType).slice(0, 6) : [];
      if (fallbackOptions.length)
        askRiseAddAssistant(
          'clarify',
          [],
          `I may be understanding the wording differently. Are you looking for one of these verified ${askRiseTypeName(fallbackType)}s?`,
          fallbackOptions,
        );
      else
        askRiseAddAssistant(
          'chat',
          [],
          'I may be understanding the wording differently. Tell me the same need in another way, and I’ll look for the closest verified Dua, Hadith, or Reminder instead of guessing.',
        );
    }
  } finally {
    askRiseSetLoading(false);
    askRiseSetVoiceState('Type or speak naturally');
    askRiseSubmissionLocked = false;
  }
}
function askRiseClearChat() {
  askRiseCloseVoice();
  askRiseState = askRiseDefaultState();
  askRiseLastSubmission = { text: '', at: 0 };
  try {
    sessionStorage.removeItem(ASK_RISE_SESSION_KEY);
  } catch {}
  const root = $('#askRiseChat');
  if (root) root.innerHTML = '';
  const input = $('#askRiseInput');
  if (input) input.value = '';
  renderAskRiseChat({ scroll: false });
  askRiseResizeInput();
}
function askRiseResizeInput() {
  const input = $('#askRiseInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 112) + 'px';
}
function askRiseSpeechText(index) {
  const row = $(`[data-ask-message-index="${index}"]`, $('#askRiseChat'));
  if (!row) return '';
  const copy = row.querySelector('.ask-rise-message-copy')?.textContent?.trim() || '';
  const optionText = [...row.querySelectorAll('.ask-rise-option-chip')]
    .map((button) => button.textContent?.trim() || '')
    .filter(Boolean)
    .join('. ');
  const resultText = [...row.querySelectorAll('.ask-rise-result-card')]
    .map((card) => {
      const type = card.querySelector('.ask-rise-result-type')?.textContent?.trim() || '';
      const title = card.querySelector('strong')?.textContent?.trim() || '';
      const preview = card.querySelector('.ask-rise-result-preview')?.textContent?.trim() || '';
      return [type, title, preview].filter(Boolean).join('. ');
    })
    .filter(Boolean)
    .join('. ');
  const nameText = [...row.querySelectorAll('.ask-rise-name-row')]
    .map((card) => {
      const title = card.querySelector('strong')?.textContent?.trim() || '';
      const meaning = card.querySelector('p')?.textContent?.trim() || '';
      const meta = [...card.querySelectorAll('.ask-rise-name-meta span')]
        .map((x) => x.textContent?.trim() || '')
        .filter(Boolean)
        .join('. ');
      return [title, meaning, meta].filter(Boolean).join('. ');
    })
    .filter(Boolean)
    .join('. ');
  return [copy, optionText, resultText, nameText].filter(Boolean).join(' ');
}
function askRiseStopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  askRiseSpeakingBubble = null;
  askRiseSetVoiceState(
    askRiseListening ? 'Listening…' : 'Type or speak naturally',
    askRiseListening ? 'listening' : '',
  );
}
function askRiseCloseVoice() {
  askRiseRecognitionText = '';
  if (askRiseRecognition) {
    try {
      askRiseRecognition.abort();
    } catch {}
    askRiseRecognition = null;
  }
  askRiseListening = false;
  askRiseStopSpeech();
}
function askRisePlaySpeech(index) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
  const text = askRiseSpeechText(index);
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = document.documentElement.lang || navigator.language || 'en-US';
  utterance.rate = 0.96;
  utterance.onstart = () => {
    askRiseSpeakingBubble = index;
    askRiseSetVoiceState('Speaking…', 'speaking');
  };
  utterance.onend = () => {
    askRiseSpeakingBubble = null;
    askRiseSetVoiceState('Type or speak naturally');
  };
  utterance.onerror = () => {
    askRiseSpeakingBubble = null;
    askRiseSetVoiceState('Type or speak naturally');
  };
  window.speechSynthesis.speak(utterance);
}
function askRisePauseSpeech() {
  if (!('speechSynthesis' in window)) return;
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
    askRiseSetVoiceState('Paused');
  } else if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    askRiseSetVoiceState('Speaking…', 'speaking');
  }
}
function askRiseSetupVoice() {
  const mic = $('#askRiseMic');
  if (!mic) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    mic.hidden = true;
    mic.setAttribute('aria-hidden', 'true');
    return;
  }
  mic.hidden = false;
  mic.removeAttribute('aria-hidden');
}
function askRiseStartListening() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  if (askRiseListening) {
    try {
      askRiseRecognition?.stop();
    } catch {}
    return;
  }
  askRiseStopSpeech();
  askRiseRecognitionText = '';
  askRiseVoiceError = '';
  askRiseRecognition = new Recognition();
  askRiseRecognition.lang = navigator.language || 'en-US';
  askRiseRecognition.continuous = false;
  askRiseRecognition.interimResults = true;
  askRiseRecognition.maxAlternatives = 1;
  askRiseRecognition.onstart = () => {
    askRiseListening = true;
    askRiseSetVoiceState('Listening…', 'listening');
  };
  askRiseRecognition.onresult = (e) => {
    let interim = '',
      finalText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0]?.transcript || '';
      if (e.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (finalText) askRiseRecognitionText = (askRiseRecognitionText + ' ' + finalText).trim();
    const input = $('#askRiseInput');
    if (input) {
      input.value = (askRiseRecognitionText + ' ' + interim).trim();
      askRiseResizeInput();
    }
  };
  askRiseRecognition.onerror = (e) => {
    const error = e.error || '';
    askRiseListening = false;
    if (error === 'aborted' || error === 'no-speech') {
      askRiseVoiceError = '';
      return;
    }
    askRiseVoiceError = error;
  };
  askRiseRecognition.onend = () => {
    const spoken = askRiseRecognitionText.trim();
    const voiceError = askRiseVoiceError;
    askRiseListening = false;
    askRiseRecognition = null;
    askRiseRecognitionText = '';
    askRiseVoiceError = '';
    if (voiceError && !spoken) {
      askRiseSetVoiceState(
        voiceError === 'not-allowed' || voiceError === 'service-not-allowed'
          ? 'Allow microphone access to use voice.'
          : 'Tap the mic to try again',
      );
      return;
    }
    askRiseSetVoiceState('Type or speak naturally');
    if (spoken) {
      askRiseSpeakingBubble = -1;
      askRiseSubmit(spoken);
    }
  };
  try {
    askRiseRecognition.start();
  } catch {
    askRiseRecognition = null;
    askRiseListening = false;
    askRiseSetVoiceState('Type or speak naturally');
  }
}
function askRiseRenderSuggestions() {
  const root = $('#askRiseSuggestions');
  if (!root) return;
  const index = askRiseGetIndex();
  const buttons = [
    ['dua', 'Duas'],
    ['hadith', 'Hadiths'],
    ['reminder', 'Reminders'],
  ].filter(([type]) => index.byType[type].length);
  const guidance = buttons
    .map(
      ([type, labelText]) =>
        `<button type="button" data-ask-rise-prompt="${esc(labelText)}" data-ask-rise-type-shortcut="${esc(type)}">${esc(labelText)}</button>`,
    )
    .join('');
  const nameEntry = `<button type="button" class="ask-rise-name-shortcut" data-ask-rise-prompt="Names from the Quran">Qur’anic Names for Children</button>`;
  root.innerHTML = guidance + nameEntry;
  root.hidden = false;
}
function askRiseRefreshVisibleResults() {
  const root = $('#askRiseChat');
  if (!root) return;
  root.querySelectorAll('.ask-rise-result-card[data-ask-rise-id]').forEach((card) => {
    const item = askRiseGetIndex().byId.get(card.dataset.askRiseId);
    if (item) card.outerHTML = askRiseResultCard(item);
    else card.remove();
  });
}
function openSearch(initialQuery = '') {
  if (initialQuery && typeof initialQuery === 'object') initialQuery = '';
  /* Ask Rise is a focused reading/search surface: never allow the persistent
     Qur'an mini/full player to cover it. Audio state is preserved; only the
     visible player chrome is suppressed while Ask Rise is open. */
  document.body.classList.add('search-open', 'rud-ask-rise-open');
  try {
    const quranOverlay = document.getElementById('rudQuranPlayerOverlay');
    if (quranOverlay?.classList.contains('open') && typeof rudQuranMinimizePlayer === 'function')
      rudQuranMinimizePlayer();
    const quranSheet = document.getElementById('rudQuranSheetOverlay');
    if (quranSheet?.classList.contains('open') && typeof rudQuranCloseSheet === 'function') rudQuranCloseSheet();
  } catch {}
  openLayer('searchOverlay');
  askRiseSetupVoice();
  askRiseSetVoiceState('Type or speak naturally');
  const chat = $('#askRiseChat');
  const emptyChat = !chat?.children.length;
  if (emptyChat) renderAskRiseChat({ scroll: false });
  askRiseRenderSuggestions();
  const input = $('#askRiseInput');
  if (input && String(initialQuery || '').trim()) input.value = String(initialQuery).trim();
  askRiseResizeInput();
  if (emptyChat) askRiseScrollToBottom(false);
  if (!matchMedia('(pointer:coarse)').matches) setTimeout(() => input?.focus(), 40);
  if (!askRiseGetIndex().contentItems.length && window.RUD_whenPublicReady) {
    window
      .RUD_whenPublicReady()
      .then(() => {
        askRiseInvalidateIndex();
        askRiseRenderSuggestions();
        askRiseRefreshVisibleResults();
      })
      .catch(() => {});
  }
}

/** Runs this module's original top-level statements. Called once, in original order, by runtime/legacyRuntime. */
export function init() {
  ASK_RISE_SESSION_KEY = 'rud_ask_rise_session_v1';
  ASK_RISE_TYPES = new Set(['dua', 'hadith', 'reminder', 'quran-name']);
  ASK_RISE_NO_MATCH =
    'I’m here to help. Tell me what’s on your heart, and I’ll help you find a relevant Dua, Hadith, Reminder, or Qur’an-based name.';
  ASK_RISE_GREETING =
    '“Begin with what is on your heart.” Tell me a moment, feeling, or need, or ask for names from the Qur’an.';
  ASK_RISE_STOPWORDS = new Set([
    'a',
    'about',
    'an',
    'and',
    'another',
    'any',
    'are',
    'as',
    'at',
    'be',
    'because',
    'been',
    'before',
    'can',
    'could',
    'do',
    'does',
    'find',
    'for',
    'from',
    'give',
    'have',
    'help',
    'how',
    'i',
    'im',
    'in',
    'is',
    'it',
    'item',
    'items',
    'me',
    'more',
    'my',
    'of',
    'on',
    'one',
    'ones',
    'or',
    'other',
    'please',
    'read',
    'should',
    'show',
    'some',
    'something',
    'that',
    'the',
    'them',
    'this',
    'to',
    'today',
    'want',
    'what',
    'when',
    'where',
    'which',
    'with',
    'would',
    'you',
    'your',
    'dua',
    'duas',
    'hadith',
    'hadiths',
    'reminder',
    'reminders',
    'guidance',
    'verified',
    'name',
    'names',
    'baby',
    'boy',
    'girl',
    'male',
    'female',
    'islamic',
    'quran',
    'quranic',
    'starting',
    'starts',
    'beginning',
    'begins',
    'letter',
  ]);
  ASK_RISE_INTENTS = {
    sleep: ['sleep', 'sleeping', 'asleep', 'bedtime', 'night', 'rest', 'insomnia', 'wake', 'waking'],
    worry: [
      'worry',
      'worried',
      'worrying',
      'anxiety',
      'anxious',
      'stress',
      'stressed',
      'fear',
      'afraid',
      'future',
      'uncertain',
      'uncertainty',
      'concern',
      'concerned',
    ],
    travel: ['travel', 'travelling', 'traveling', 'traveller', 'traveler', 'journey', 'trip'],
    forgiveness: ['forgiveness', 'forgive', 'forgiven', 'repent', 'repentance', 'tawbah', 'sin', 'sins', 'mercy'],
    anger: ['anger', 'angry', 'mad', 'rage', 'temper', 'upset'],
    protection: ['protect', 'protection', 'protected', 'safety', 'safe', 'shaytan', 'shaitan', 'evil'],
    parents: ['parent', 'parents', 'mother', 'father', 'mom', 'mum', 'dad'],
    trust: ['trust', 'trusting', 'trusted', 'tawakkul', 'rely', 'reliance'],
    sadness: ['sad', 'sadness', 'grief', 'grieving', 'sorrow', 'heartbroken'],
    gratitude: ['gratitude', 'grateful', 'thankful', 'thanks', 'shukr', 'blessing', 'blessings'],
    patience: ['patience', 'patient', 'sabr', 'hardship', 'trial', 'difficulty'],
    guidance: ['guidance', 'guided', 'direction', 'lost', 'confused', 'confusion', 'hidayah'],
    loneliness: ['lonely', 'loneliness', 'alone'],
    innovation: ['bidah', 'biddah', 'innovation'],
    shirk: ['shirk', 'polytheism'],
  };
  askRiseState = loadAskRiseState();
  askRiseRecognition = null;
  askRiseListening = false;
  askRiseRecognitionText = '';
  askRiseVoiceError = '';
  askRiseSpeakingBubble = null;
  askRiseSubmissionLocked = false;
  askRiseLastSubmission = { text: '', at: 0 };
  askRiseIndexSource = null;
  askRiseIndex = null;
  askRiseSearchFieldCache = new WeakMap();
  window.RUD_askRiseCloseVoice = askRiseCloseVoice;
  $('#heroMoodSearch')?.addEventListener('click', () => openSearch());
  $('#askRiseClear')?.addEventListener('click', askRiseClearChat);
  $('#searchClose')?.addEventListener('click', () => {
    askRiseCloseVoice();
    closeLayer('searchOverlay');
  });
  $('#searchOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('#searchOverlay')) {
      askRiseCloseVoice();
      closeLayer('searchOverlay');
      return;
    }

    const routeButton = e.target.closest('[data-search-route]');
    if (routeButton) {
      askRiseStopSpeech();
      saveAskRiseState();
      document.body.dataset.askRiseReturn = '1';
      closeLayer('searchOverlay');
      location.hash = routeButton.dataset.searchRoute;
      return;
    }

    const option = e.target.closest('[data-ask-rise-option]');
    if (option) {
      const type = option.dataset.askRiseType;
      const queryText = option.dataset.askRiseQuery || option.textContent || '';
      const itemId = option.dataset.askRiseItemId || '';
      if (ASK_RISE_TYPES.has(type) && queryText) askRiseSubmit(queryText, { forcedType: type, forcedItemId: itemId });
      return;
    }

    const prompt = e.target.closest('[data-ask-rise-prompt]');
    if (prompt) {
      const type = prompt.dataset.askRiseTypeShortcut;
      askRiseSubmit(
        prompt.dataset.askRisePrompt || prompt.textContent || '',
        ASK_RISE_TYPES.has(type) ? { forcedType: null } : {},
      );
      return;
    }

    const audio = e.target.closest('[data-ask-audio]');
    if (audio) {
      const index = Number(audio.dataset.askIndex);
      if (audio.dataset.askAudio === 'play') askRisePlaySpeech(index);
      if (audio.dataset.askAudio === 'pause') askRisePauseSpeech();
      if (audio.dataset.askAudio === 'stop') askRiseStopSpeech();
    }
  });
  $('#askRiseForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    askRiseSubmit();
  });
  $('#askRiseInput')?.addEventListener('input', askRiseResizeInput);
  $('#askRiseInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askRiseSubmit();
    }
  });
  $('#askRiseMic')?.addEventListener('click', askRiseStartListening);
  window.addEventListener('rud:public-content-updated', () => {
    askRiseInvalidateIndex();
    if ($('#searchOverlay')?.classList.contains('open')) {
      askRiseRenderSuggestions();
      askRiseRefreshVisibleResults();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) askRiseStopSpeech();
  });
}

export { combinedPublicContent, findPublicItem, openSearch };
