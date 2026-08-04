(() => {
  'use strict';

  const STORAGE_KEY = 'scimena-citation-studio-v1';
  const CROSSREF_DIRECT = 'https://api.crossref.org';
  const PUBMED_DIRECT = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

  const state = {
    projectTitle: 'Untitled Research Project',
    manuscript: '',
    style: 'vancouver',
    references: [],
    selectedLibraryIds: new Set(),
    pickerSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    lastSaved: null,
    aiSelection: null,
    aiResult: null,
    aiSelected: new Map(),
    aiProgressTimer: null,
    aiProgressValue: 0,
  };

  const el = (id) => document.getElementById(id);
  const els = {
    searchInput: el('searchInput'), searchBtn: el('searchBtn'), clearSearchBtn: el('clearSearchBtn'),
    searchMessage: el('searchMessage'), searchResults: el('searchResults'), demoBtn: el('demoBtn'),
    libraryList: el('libraryList'), libraryEmpty: el('libraryEmpty'), libraryCount: el('libraryCount'),
    libraryFilter: el('libraryFilter'), citationStyle: el('citationStyle'), manuscript: el('manuscript'),
    projectTitle: el('projectTitle'), wordCount: el('wordCount'), citationCount: el('citationCount'),
    previewContent: el('previewContent'), referencesContent: el('referencesContent'), auditContent: el('auditContent'),
    insertCitationBtn: el('insertCitationBtn'), citationModal: el('citationModal'), citationPicker: el('citationPicker'),
    modalFilter: el('modalFilter'), selectedCount: el('selectedCount'), confirmInsertBtn: el('confirmInsertBtn'),
    manualModal: el('manualModal'), manualForm: el('manualForm'), manualBtn: el('manualBtn'),
    saveBtn: el('saveBtn'), saveStatus: el('saveStatus'), newProjectBtn: el('newProjectBtn'), exportBtn: el('exportBtn'),
    auditBtn: el('auditBtn'), toast: el('toast'), undoBtn: el('undoBtn'), redoBtn: el('redoBtn'),
    aiCiteBtn: el('aiCiteBtn'), aiCiteModal: el('aiCiteModal'), aiOriginalText: el('aiOriginalText'),
    aiAnalyzeBtn: el('aiAnalyzeBtn'), aiStatus: el('aiStatus'), aiResults: el('aiResults'),
    aiPolishedText: el('aiPolishedText'), aiClaims: el('aiClaims'), aiSelectedCount: el('aiSelectedCount'),
    aiApplyTextBtn: el('aiApplyTextBtn'), aiApplyCitationsBtn: el('aiApplyCitationsBtn'),
    aiProgress: el('aiProgress'), aiProgressTrack: el('aiProgressTrack'), aiProgressBar: el('aiProgressBar'),
    aiProgressLabel: el('aiProgressLabel'), aiProgressPercent: el('aiProgressPercent'),
  };

  function uid(prefix = 'ref') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function stripHtml(value = '') {
    const div = document.createElement('div');
    div.innerHTML = value;
    return (div.textContent || div.innerText || '').trim();
  }

  function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeDoi(value = '') {
    return value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  }

  function normalizeTitle(value = '') {
    return stripHtml(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ').trim();
  }

  function firstAuthor(ref) {
    const author = ref.authors?.[0];
    if (!author) return 'Unknown';
    return author.family || author.literal || author.name || 'Unknown';
  }

  function authorDisplay(ref, max = 3) {
    const authors = ref.authors || [];
    if (!authors.length) return 'Unknown author';
    const names = authors.slice(0, max).map(a => [a.family || a.literal || a.name, a.given].filter(Boolean).join(' '));
    return authors.length > max ? `${names.join(', ')}, et al.` : names.join(', ');
  }

  function authorVancouver(ref) {
    const authors = ref.authors || [];
    if (!authors.length) return 'Unknown author';
    const names = authors.slice(0, 6).map(a => {
      const family = a.family || a.literal || a.name || '';
      const initials = (a.given || '').split(/[\s-]+/).filter(Boolean).map(x => x[0]).join('');
      return `${family} ${initials}`.trim();
    });
    if (authors.length > 6) names.push('et al');
    return names.join(', ');
  }

  function authorApa(ref) {
    const authors = ref.authors || [];
    if (!authors.length) return 'Unknown author';
    const format = a => {
      const family = a.family || a.literal || a.name || '';
      const initials = (a.given || '').split(/[\s-]+/).filter(Boolean).map(x => `${x[0]}.`).join(' ');
      return `${family}, ${initials}`.trim().replace(/,\s*$/, '');
    };
    if (authors.length === 1) return format(authors[0]);
    if (authors.length <= 20) return `${authors.slice(0,-1).map(format).join(', ')}, & ${format(authors.at(-1))}`;
    return `${authors.slice(0,19).map(format).join(', ')}, … ${format(authors.at(-1))}`;
  }

  function formatVancouver(ref) {
    const journal = ref.journal || '';
    const year = ref.year || 'n.d.';
    const volumeIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].join('');
    const pages = ref.pages ? `:${ref.pages}` : '';
    const doi = ref.doi ? ` doi: ${normalizeDoi(ref.doi)}.` : '';
    const core = `${authorVancouver(ref)}. ${ref.title}. ${journal ? `${journal}. ` : ''}${year}${volumeIssue ? `;${volumeIssue}${pages}` : ''}.`;
    return `${core}${doi}`.replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();
  }

  function formatApa(ref) {
    const year = ref.year || 'n.d.';
    const journal = ref.journal || '';
    const vol = ref.volume ? `, ${ref.volume}` : '';
    const issue = ref.issue ? `(${ref.issue})` : '';
    const pages = ref.pages ? `, ${ref.pages}` : '';
    const doi = ref.doi ? ` https://doi.org/${normalizeDoi(ref.doi)}` : '';
    return `${authorApa(ref)} (${year}). ${ref.title}. ${journal}${vol}${issue}${pages}.${doi}`.replace(/\s+/g, ' ').trim();
  }

  function getTokenRegex() {
    return /\{\{cite:([a-zA-Z0-9_-]+(?:\|[a-zA-Z0-9_-]+)*)\}\}/g;
  }

  function getCitationOrder() {
    const order = [];
    const seen = new Set();
    let match;
    const regex = getTokenRegex();
    while ((match = regex.exec(state.manuscript))) {
      match[1].split('|').forEach(id => {
        if (!seen.has(id) && state.references.some(r => r.id === id)) {
          seen.add(id); order.push(id);
        }
      });
    }
    return order;
  }

  function numberMap() {
    const map = new Map();
    getCitationOrder().forEach((id, index) => map.set(id, index + 1));
    return map;
  }

  function compressNumbers(numbers) {
    const sorted = [...new Set(numbers)].sort((a,b) => a-b);
    const chunks = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j+1] === sorted[j] + 1) j++;
      if (j - i >= 2) chunks.push(`${sorted[i]}–${sorted[j]}`);
      else if (j - i === 1) chunks.push(`${sorted[i]},${sorted[j]}`);
      else chunks.push(String(sorted[i]));
      i = j + 1;
    }
    return chunks.join(',');
  }

  function formatInText(ids) {
    const refs = ids.map(id => state.references.find(r => r.id === id)).filter(Boolean);
    if (!refs.length) return '[missing citation]';
    if (state.style === 'vancouver') {
      const map = numberMap();
      return `[${compressNumbers(ids.map(id => map.get(id)).filter(Boolean))}]`;
    }
    if (refs.length === 1) {
      const ref = refs[0];
      const a = firstAuthor(ref);
      return ref.authors?.length > 2 ? `(${a} et al., ${ref.year || 'n.d.'})` : ref.authors?.length === 2 ? `(${firstAuthor({authors:[ref.authors[0]]})} & ${firstAuthor({authors:[ref.authors[1]]})}, ${ref.year || 'n.d.'})` : `(${a}, ${ref.year || 'n.d.'})`;
    }
    return `(${refs.map(r => `${firstAuthor(r)}${r.authors?.length > 2 ? ' et al.' : ''}, ${r.year || 'n.d.'}`).join('; ')})`;
  }

  function renderMarkdownLike(text) {
    if (!text.trim()) return '<p class="placeholder">Your formatted manuscript will appear here.</p>';
    const citationReplaced = escapeHtml(text).replace(getTokenRegex(), (_, ids) => `<span class="citation-link">${escapeHtml(formatInText(ids.split('|')))}</span>`);
    return citationReplaced.split(/\n{2,}/).map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('## ')) return `<h2>${inlineFormat(trimmed.slice(3))}</h2>`;
      if (trimmed.startsWith('# ')) return `<h2>${inlineFormat(trimmed.slice(2))}</h2>`;
      if (trimmed.split('\n').every(line => line.startsWith('- '))) {
        return `<ul>${trimmed.split('\n').map(line => `<li>${inlineFormat(line.slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${inlineFormat(trimmed).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function inlineFormat(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  function orderedCitedRefs() {
    const order = getCitationOrder();
    if (state.style === 'vancouver') return order.map(id => state.references.find(r => r.id === id)).filter(Boolean);
    return order.map(id => state.references.find(r => r.id === id)).filter(Boolean).sort((a,b) => `${firstAuthor(a)}${a.year}`.localeCompare(`${firstAuthor(b)}${b.year}`));
  }

  function renderPreview() {
    const title = escapeHtml(state.projectTitle || 'Untitled Research Project');
    els.previewContent.innerHTML = `<h1>${title}</h1>${renderMarkdownLike(state.manuscript)}`;
    const cited = orderedCitedRefs();
    if (!cited.length) {
      els.referencesContent.innerHTML = '<h1>References</h1><p class="placeholder">Cited references will appear here automatically.</p>';
    } else if (state.style === 'vancouver') {
      els.referencesContent.innerHTML = `<h1>References</h1><ol class="references-list">${cited.map(r => `<li>${escapeHtml(formatVancouver(r))}</li>`).join('')}</ol>`;
    } else {
      els.referencesContent.innerHTML = `<h1>References</h1>${cited.map(r => `<p class="apa-reference">${escapeHtml(formatApa(r))}</p>`).join('')}`;
    }
    renderAudit();
    updateStats();
  }

  function updateStats() {
    const words = state.manuscript.replace(getTokenRegex(), '').trim().match(/[\p{L}\p{N}]+/gu)?.length || 0;
    const citations = [...state.manuscript.matchAll(getTokenRegex())].length;
    els.wordCount.textContent = `${words} word${words === 1 ? '' : 's'}`;
    els.citationCount.textContent = `${citations} citation${citations === 1 ? '' : 's'}`;
  }

  function citationUsageMap() {
    const usage = new Map(state.references.map(r => [r.id, 0]));
    for (const match of state.manuscript.matchAll(getTokenRegex())) {
      match[1].split('|').forEach(id => usage.set(id, (usage.get(id) || 0) + 1));
    }
    return usage;
  }

  function renderAudit() {
    const order = getCitationOrder();
    const citedSet = new Set(order);
    const uncited = state.references.filter(r => !citedSet.has(r.id));
    const missing = state.references.filter(r => !r.title || !r.year || !(r.authors || []).length);
    const doiGroups = new Map();
    state.references.filter(r => r.doi).forEach(r => {
      const doi = normalizeDoi(r.doi);
      doiGroups.set(doi, [...(doiGroups.get(doi) || []), r]);
    });
    const duplicates = [...doiGroups.values()].filter(group => group.length > 1);
    const issues = [];
    if (uncited.length) issues.push(`${uncited.length} reference${uncited.length === 1 ? '' : 's'} in the library ${uncited.length === 1 ? 'is' : 'are'} not cited.`);
    if (missing.length) issues.push(`${missing.length} reference${missing.length === 1 ? '' : 's'} ${missing.length === 1 ? 'has' : 'have'} incomplete core metadata.`);
    if (duplicates.length) issues.push(`${duplicates.length} duplicate DOI group${duplicates.length === 1 ? '' : 's'} detected.`);
    if (!issues.length) issues.push('No citation consistency problems detected.');
    els.auditContent.innerHTML = `
      <h1>Citation Audit</h1>
      <div class="audit-summary">
        <div class="audit-card"><strong>${state.references.length}</strong><span>Library references</span></div>
        <div class="audit-card"><strong>${order.length}</strong><span>Cited references</span></div>
        <div class="audit-card"><strong>${issues.length === 1 && issues[0].startsWith('No ') ? 0 : issues.length}</strong><span>Issues detected</span></div>
      </div>
      <ul class="audit-list">${issues.map(i => `<li class="${i.startsWith('No ') ? 'ok' : ''}">${escapeHtml(i)}</li>`).join('')}</ul>`;
  }

  function renderLibrary() {
    const filter = normalizeTitle(els.libraryFilter.value || '');
    const usage = citationUsageMap();
    const numbers = numberMap();
    const refs = state.references.filter(r => normalizeTitle(`${r.title} ${authorDisplay(r)} ${r.journal} ${r.doi}`).includes(filter));
    els.libraryCount.textContent = state.references.length;
    els.libraryEmpty.classList.toggle('hidden', state.references.length > 0);
    els.libraryList.innerHTML = refs.map(ref => {
      const checked = state.selectedLibraryIds.has(ref.id);
      return `<div class="library-item ${checked ? 'selected' : ''}" data-id="${ref.id}">
        <div class="ref-number">${numbers.get(ref.id) || '—'}</div>
        <label class="library-title"><input class="library-select" type="checkbox" ${checked ? 'checked' : ''} /> ${escapeHtml(ref.title)}</label>
        <div class="library-meta">${escapeHtml(firstAuthor(ref))} · ${escapeHtml(ref.year || 'n.d.')} · ${escapeHtml(ref.journal || ref.source || 'Unknown source')} · cited ${usage.get(ref.id) || 0}×</div>
        <div class="library-actions">
          <button data-action="insert">Insert</button>
          ${ref.doi ? `<button data-action="open">Open DOI</button>` : ref.pmid ? `<button data-action="open">Open PubMed</button>` : ''}
          <button data-action="copy">Copy</button>
          <button class="danger" data-action="delete">Delete</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderPicker() {
    const filter = normalizeTitle(els.modalFilter.value || '');
    const refs = state.references.filter(r => normalizeTitle(`${r.title} ${authorDisplay(r)} ${r.journal}`).includes(filter));
    els.citationPicker.innerHTML = refs.length ? refs.map(ref => `<label class="picker-item">
      <input type="checkbox" data-id="${ref.id}" ${state.pickerSelectedIds.has(ref.id) ? 'checked' : ''} />
      <span><span class="picker-title">${escapeHtml(ref.title)}</span><span class="picker-meta">${escapeHtml(firstAuthor(ref))} · ${escapeHtml(ref.year || 'n.d.')} · ${escapeHtml(ref.journal || '')}</span></span>
    </label>`).join('') : '<div class="empty-state"><strong>No matching references</strong><p>Add a reference to your library first.</p></div>';
    els.selectedCount.textContent = `${state.pickerSelectedIds.size} selected`;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2400);
  }

  function setSearching(active, message = '') {
    els.searchBtn.disabled = active;
    els.searchBtn.textContent = active ? 'Searching…' : 'Search references';
    if (message) els.searchMessage.textContent = message;
  }

  function selectedSource() {
    return document.querySelector('input[name="source"]:checked')?.value || 'auto';
  }

  function detectQueryType(query) {
    const clean = query.trim();
    if (/^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(clean) || /^doi:/i.test(clean)) return 'doi';
    if (/^(pmid:\s*)?\d{6,9}$/i.test(clean)) return 'pmid';
    return 'text';
  }

  async function fetchJsonWithFallback(directUrl, proxyUrl) {
    let directError;
    try {
      const res = await fetch(directUrl, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      directError = err;
    }
    try {
      const res = await fetch(proxyUrl, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
      return await res.json();
    } catch (proxyError) {
      throw new Error(`Could not reach the reference service. Direct: ${directError?.message || 'failed'}; proxy: ${proxyError.message}`);
    }
  }

  function crossrefToRef(item) {
    const dateParts = item.published?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0] || item.created?.['date-parts']?.[0] || [];
    return {
      id: uid(), sourceId: item.DOI || item.URL || uid('cr'), source: 'Crossref', type: item.type || 'article-journal',
      title: stripHtml(item.title?.[0] || 'Untitled'),
      authors: (item.author || []).map(a => ({ family: a.family || '', given: a.given || '', ORCID: a.ORCID || '' })),
      year: dateParts[0] ? String(dateParts[0]) : '', journal: item['container-title']?.[0] || '',
      volume: item.volume || '', issue: item.issue || '', pages: item.page || item['article-number'] || '',
      doi: item.DOI || '', pmid: '', url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''), raw: item,
    };
  }

  function pubmedToRef(item) {
    const articleIds = item.articleids || [];
    const doi = articleIds.find(x => x.idtype === 'doi')?.value || '';
    const authors = (item.authors || []).map(a => {
      const raw = a.name || '';
      const parts = raw.split(' ');
      const given = parts.pop() || '';
      return { family: parts.join(' ') || raw, given };
    });
    return {
      id: uid(), sourceId: item.uid, source: 'PubMed', type: 'article-journal', title: stripHtml(item.title || 'Untitled'),
      authors, year: (item.pubdate || '').match(/\d{4}/)?.[0] || '', journal: item.fulljournalname || item.source || '',
      volume: item.volume || '', issue: item.issue || '', pages: item.pages || item.elocationid?.replace(/^doi:\s*/i,'') || '',
      doi, pmid: item.uid || '', url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`, raw: item,
    };
  }

  async function searchCrossref(query, type) {
    let path;
    if (type === 'doi') path = `/works/${encodeURIComponent(normalizeDoi(query))}`;
    else path = `/works?query.bibliographic=${encodeURIComponent(query)}&rows=8`;
    const direct = `${CROSSREF_DIRECT}${path}${path.includes('?') ? '&' : '?'}mailto=info@scimena.com`;
    const proxy = `/.netlify/functions/crossref?path=${encodeURIComponent(path)}`;
    const data = await fetchJsonWithFallback(direct, proxy);
    const message = data.message;
    const items = Array.isArray(message?.items) ? message.items : message ? [message] : [];
    return items.map(crossrefToRef);
  }

  async function searchPubmed(query, type) {
    let ids = [];
    if (type === 'pmid') ids = [query.replace(/\D/g, '')];
    else {
      const searchPath = `/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=8`;
      const searchData = await fetchJsonWithFallback(`${PUBMED_DIRECT}${searchPath}`, `/.netlify/functions/pubmed?path=${encodeURIComponent(searchPath)}`);
      ids = searchData.esearchresult?.idlist || [];
    }
    if (!ids.length) return [];
    const summaryPath = `/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const data = await fetchJsonWithFallback(`${PUBMED_DIRECT}${summaryPath}`, `/.netlify/functions/pubmed?path=${encodeURIComponent(summaryPath)}`);
    return (data.result?.uids || ids).map(id => data.result?.[id]).filter(Boolean).map(pubmedToRef);
  }

  async function performSearch() {
    const query = els.searchInput.value.trim();
    if (query.length < 3) return showToast('Enter at least 3 characters.');
    const source = selectedSource();
    const type = detectQueryType(query);
    setSearching(true, 'Searching scholarly metadata…');
    els.searchResults.innerHTML = '';
    try {
      let results = [];
      if (source === 'crossref') results = await searchCrossref(query, type);
      else if (source === 'pubmed') results = await searchPubmed(query, type);
      else if (type === 'pmid') results = await searchPubmed(query, type);
      else if (type === 'doi') results = await searchCrossref(query, type);
      else {
        const settled = await Promise.allSettled([searchCrossref(query, type), searchPubmed(query, type)]);
        results = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
      }
      const unique = [];
      const keys = new Set();
      results.forEach(r => {
        const key = r.doi ? `doi:${normalizeDoi(r.doi)}` : `title:${normalizeTitle(r.title)}:${r.year}`;
        if (!keys.has(key)) { keys.add(key); unique.push(r); }
      });
      renderSearchResults(unique.slice(0, 12));
      els.searchMessage.textContent = unique.length ? `${unique.length} result${unique.length === 1 ? '' : 's'} found.` : 'No matching references found.';
    } catch (err) {
      console.error(err);
      els.searchMessage.textContent = 'Search service unavailable. You can use demo data or manual entry.';
      showToast('Search failed. Try manual entry or demo data.');
    } finally { setSearching(false); }
  }

  function renderSearchResults(results) {
    els.searchResults.innerHTML = results.map((ref, index) => {
      const existing = isDuplicate(ref);
      return `<article class="result-card" data-index="${index}">
        <div class="result-source"><span class="source-tag">${escapeHtml(ref.source)}</span><span class="result-meta">${escapeHtml(ref.year || 'n.d.')}</span></div>
        <div class="result-title">${escapeHtml(ref.title)}</div>
        <div class="result-meta">${escapeHtml(authorDisplay(ref))}<br>${escapeHtml(ref.journal || '')}${ref.doi ? `<br>DOI: ${escapeHtml(ref.doi)}` : ref.pmid ? `<br>PMID: ${escapeHtml(ref.pmid)}` : ''}</div>
        <div class="result-actions"><button class="btn btn-secondary" data-add="${index}" ${existing ? 'disabled' : ''}>${existing ? 'In library' : 'Add to library'}</button></div>
      </article>`;
    }).join('');
    els.searchResults._refs = results;
  }

  function isDuplicate(ref) {
    return state.references.find(existing => {
      if (ref.doi && existing.doi) return normalizeDoi(ref.doi) === normalizeDoi(existing.doi);
      if (ref.pmid && existing.pmid) return String(ref.pmid) === String(existing.pmid);
      return normalizeTitle(ref.title) === normalizeTitle(existing.title) && String(ref.year || '') === String(existing.year || '');
    });
  }

  function ensureReference(ref) {
    const duplicate = isDuplicate(ref);
    if (duplicate) return duplicate;
    const stored = { ...ref, id: ref.id || uid() };
    state.references.push(stored);
    return stored;
  }

  function addReference(ref) {
    if (!ref) return;
    const duplicate = isDuplicate(ref);
    if (duplicate) return showToast('This reference is already in the library.');
    ensureReference(ref);
    renderAll();
    if (els.searchResults._refs) renderSearchResults(els.searchResults._refs);
    save(false);
    showToast('Reference added.');
  }

  function insertCitation(ids) {
    const valid = ids.filter(id => state.references.some(r => r.id === id));
    if (!valid.length) return showToast('Select at least one reference.');
    snapshot();
    const token = `{{cite:${valid.join('|')}}}`;
    const start = els.manuscript.selectionStart;
    const end = els.manuscript.selectionEnd;
    const before = state.manuscript.slice(0, start);
    const after = state.manuscript.slice(end);
    const spacerBefore = before && !/\s$/.test(before) ? ' ' : '';
    const spacerAfter = after && !/^\s|[.,;:!?)]/.test(after) ? ' ' : '';
    state.manuscript = `${before}${spacerBefore}${token}${spacerAfter}${after}`;
    els.manuscript.value = state.manuscript;
    const cursor = before.length + spacerBefore.length + token.length + spacerAfter.length;
    els.manuscript.focus();
    els.manuscript.setSelectionRange(cursor, cursor);
    state.selectedLibraryIds.clear();
    state.pickerSelectedIds.clear();
    renderAll();
    save(false);
    showToast('Citation inserted and renumbered.');
  }

  function selectedAiMode() {
    return document.querySelector('input[name="aiMode"]:checked')?.value || 'polish';
  }

  function getSelectionOrParagraph() {
    const text = state.manuscript;
    let start = els.manuscript.selectionStart ?? 0;
    let end = els.manuscript.selectionEnd ?? start;
    if (start !== end && text.slice(start, end).trim()) {
      return { start, end, text: text.slice(start, end) };
    }
    if (!text.trim()) return null;
    const cursor = start;
    const previousBreak = text.lastIndexOf('\n\n', Math.max(0, cursor - 1));
    const nextBreak = text.indexOf('\n\n', cursor);
    start = previousBreak === -1 ? 0 : previousBreak + 2;
    end = nextBreak === -1 ? text.length : nextBreak;
    let selected = text.slice(start, end);
    if (!selected.trim()) {
      start = 0;
      end = text.length;
      selected = text;
    }
    return { start, end, text: selected };
  }

  function openAiCiteModal() {
    const selection = getSelectionOrParagraph();
    if (!selection) return showToast('Write or select a sentence first.');
    if (selection.text.trim().length < 20) return showToast('Select a complete scientific sentence or paragraph.');
    if (selection.text.length > 6000) return showToast('Select no more than 6,000 characters at a time.');
    state.aiSelection = selection;
    state.aiResult = null;
    state.aiSelected = new Map();
    els.aiOriginalText.value = selection.text.trim();
    els.aiPolishedText.value = '';
    els.aiClaims.innerHTML = '';
    els.aiResults.classList.add('hidden');
    els.aiStatus.textContent = 'Ready to analyze the selected text.';
    els.aiApplyTextBtn.disabled = true;
    els.aiApplyCitationsBtn.disabled = true;
    els.aiSelectedCount.textContent = '0 sources selected';
    resetAiProgress();
    els.aiCiteModal.classList.remove('hidden');
  }

  const AI_PROGRESS_STAGES = [
    { key: 'prepare', min: 0, max: 14, label: 'Preparing the selected text…' },
    { key: 'analyze', min: 14, max: 38, label: 'Improving wording and detecting citable claims…' },
    { key: 'search', min: 38, max: 73, label: 'Searching PubMed and Crossref for real records…' },
    { key: 'rank', min: 73, max: 93, label: 'Ranking evidence against each claim…' },
    { key: 'finish', min: 93, max: 100, label: 'Finalizing citation suggestions…' },
  ];

  function getAiProgressStage(value) {
    return AI_PROGRESS_STAGES.find((stage, index) => value < stage.max || index === AI_PROGRESS_STAGES.length - 1);
  }

  function updateAiProgress(value, label = '', stateClass = '') {
    const safeRawValue = Math.max(0, Math.min(100, Number(value) || 0));
    const safeValue = Math.round(safeRawValue);
    state.aiProgressValue = safeRawValue;
    const stage = getAiProgressStage(safeRawValue);
    els.aiProgress.classList.remove('hidden', 'success', 'error');
    if (stateClass) els.aiProgress.classList.add(stateClass);
    els.aiProgressBar.style.width = `${safeValue}%`;
    els.aiProgressPercent.textContent = `${safeValue}%`;
    els.aiProgressLabel.textContent = label || stage.label;
    els.aiProgressTrack.setAttribute('aria-valuenow', String(safeValue));
    document.querySelectorAll('[data-ai-progress-step]').forEach(step => {
      const stepStage = AI_PROGRESS_STAGES.find(item => item.key === step.dataset.aiProgressStep);
      step.classList.toggle('active', stepStage?.key === stage.key);
      step.classList.toggle('complete', safeValue >= (stepStage?.max || 101));
    });
  }

  function startAiProgress() {
    clearInterval(state.aiProgressTimer);
    updateAiProgress(4);
    state.aiProgressTimer = setInterval(() => {
      const current = state.aiProgressValue;
      let increment = 0.12;
      if (current < 14) increment = 2.1;
      else if (current < 38) increment = 1.25;
      else if (current < 73) increment = 0.72;
      else if (current < 93) increment = 0.32;
      else if (current < 97) increment = 0.08;
      updateAiProgress(Math.min(97, current + increment));
    }, 420);
  }

  function finishAiProgress(success, message = '') {
    clearInterval(state.aiProgressTimer);
    state.aiProgressTimer = null;
    if (success) {
      updateAiProgress(100, message || 'Complete — sources are ready for review.', 'success');
    } else {
      updateAiProgress(state.aiProgressValue || 8, message || 'Analysis stopped before completion.', 'error');
    }
  }

  function resetAiProgress() {
    clearInterval(state.aiProgressTimer);
    state.aiProgressTimer = null;
    state.aiProgressValue = 0;
    els.aiProgress.classList.add('hidden');
    els.aiProgress.classList.remove('success', 'error');
    els.aiProgressBar.style.width = '0%';
    els.aiProgressPercent.textContent = '0%';
    els.aiProgressLabel.textContent = 'Preparing analysis…';
    els.aiProgressTrack.setAttribute('aria-valuenow', '0');
    document.querySelectorAll('[data-ai-progress-step]').forEach(step => step.classList.remove('active', 'complete'));
  }

  function setAiBusy(active, message = '') {
    els.aiAnalyzeBtn.disabled = active;
    els.aiAnalyzeBtn.textContent = active ? 'Analyzing and searching…' : 'Analyze claims and search sources';
    if (message) els.aiStatus.textContent = message;
  }

  async function performAiAnalysis() {
    const text = els.aiOriginalText.value.trim();
    if (text.length < 20) return showToast('Select a complete scientific sentence or paragraph.');
    setAiBusy(true, 'OpenAI is identifying claims, then PubMed and Crossref are searched for real records…');
    startAiProgress();
    els.aiResults.classList.add('hidden');
    try {
      const response = await fetch('/.netlify/functions/ai-citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ text, mode: selectedAiMode() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data.detail || data.error || `HTTP ${response.status}`;
        throw new Error(detail);
      }
      if (!data.polished_text || !Array.isArray(data.claims)) throw new Error('The AI response was incomplete.');
      state.aiResult = data;
      finishAiProgress(true, 'Complete — claims and evidence are ready for review.');
      renderAiResults();
      els.aiStatus.textContent = `${data.claims.length} claim${data.claims.length === 1 ? '' : 's'} analyzed using ${data.model || 'OpenAI'}. Review the proposed sources before applying.`;
      els.aiResults.classList.remove('hidden');
      els.aiApplyTextBtn.disabled = false;
    } catch (error) {
      console.error(error);
      const message = String(error.message || error);
      finishAiProgress(false, 'Analysis stopped — review the error below and try again.');
      els.aiStatus.textContent = message.includes('OPENAI_API_KEY')
        ? 'OpenAI is not configured yet. Add OPENAI_API_KEY in Netlify → Site configuration → Environment variables, then redeploy.'
        : `AI citation search failed: ${message}`;
      showToast('AI citation search could not be completed.');
    } finally {
      setAiBusy(false);
    }
  }

  function candidateKey(claimId, candidateId) {
    return `${claimId}::${candidateId}`;
  }

  function renderAiResults() {
    const result = state.aiResult;
    if (!result) return;
    els.aiPolishedText.value = result.polished_text || els.aiOriginalText.value;
    state.aiSelected = new Map();
    const candidateMap = new Map();

    els.aiClaims.innerHTML = result.claims.map((claim, claimIndex) => {
      const candidates = Array.isArray(claim.candidates) ? claim.candidates : [];
      const suggested = candidates.find(c => c.relevance === 'strong') || candidates.find(c => c.relevance === 'moderate');
      if (suggested) state.aiSelected.set(claim.id, new Set([suggested.candidate_id]));
      candidates.forEach(candidate => candidateMap.set(candidateKey(claim.id, candidate.candidate_id), candidate));
      const candidateHtml = candidates.length ? candidates.map(candidate => {
        const selected = state.aiSelected.get(claim.id)?.has(candidate.candidate_id);
        const href = candidate.doi ? `https://doi.org/${normalizeDoi(candidate.doi)}` : candidate.url || (candidate.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${candidate.pmid}/` : '');
        return `<label class="ai-candidate">
          <input type="checkbox" data-ai-claim="${escapeHtml(claim.id)}" data-ai-candidate="${escapeHtml(candidate.candidate_id)}" ${selected ? 'checked' : ''} />
          <span>
            <span class="ai-candidate-title">${escapeHtml(candidate.title || 'Untitled')}</span>
            <span class="ai-candidate-meta"><span class="ai-badge ${escapeHtml(candidate.relevance || 'weak')}">${escapeHtml(candidate.relevance || 'weak')}</span>${escapeHtml(candidate.source || '')} · ${escapeHtml(firstAuthor(candidate))} · ${escapeHtml(candidate.year || 'n.d.')}<br>${escapeHtml(candidate.journal || '')}${candidate.doi ? `<br>DOI: ${escapeHtml(candidate.doi)}` : candidate.pmid ? `<br>PMID: ${escapeHtml(candidate.pmid)}` : ''}</span>
            ${candidate.rationale ? `<span class="ai-candidate-rationale">${escapeHtml(candidate.rationale)}</span>` : ''}
            ${href ? `<a class="ai-open-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">Open source record ↗</a>` : ''}
          </span>
        </label>`;
      }).join('') : '<div class="ai-empty">No sufficiently relevant records were found for this claim. Try a shorter or more specific statement.</div>';
      return `<section class="ai-claim">
        <div class="ai-claim-head">
          <div class="ai-claim-title"><strong>${claimIndex + 1}. ${escapeHtml(claim.claim)}</strong><span class="ai-claim-marker">${escapeHtml(claim.marker || `[[${claim.id}]]`)}</span></div>
          <div class="ai-query">Search: ${escapeHtml(claim.search_query || '')}</div>
        </div>
        <div class="ai-candidates">${candidateHtml}</div>
      </section>`;
    }).join('');
    els.aiClaims._candidateMap = candidateMap;
    updateAiSelectionCount();
  }

  function updateAiSelectionCount() {
    const count = [...state.aiSelected.values()].reduce((sum, ids) => sum + ids.size, 0);
    els.aiSelectedCount.textContent = `${count} source${count === 1 ? '' : 's'} selected`;
    els.aiApplyCitationsBtn.disabled = !state.aiResult || count === 0;
  }

  function applyAiResult(withCitations) {
    if (!state.aiResult || !state.aiSelection) return;
    let replacement = els.aiPolishedText.value.trim();
    const candidateMap = els.aiClaims._candidateMap || new Map();
    let insertedSources = 0;

    for (const claim of state.aiResult.claims) {
      const marker = claim.marker || `[[${claim.id}]]`;
      let citationText = '';
      if (withCitations) {
        const chosen = [...(state.aiSelected.get(claim.id) || [])]
          .map(candidateId => candidateMap.get(candidateKey(claim.id, candidateId)))
          .filter(Boolean);
        const refs = chosen.map(candidate => ensureReference({
          ...candidate,
          id: undefined,
          raw: undefined,
          sourceId: candidate.source_id || candidate.pmid || candidate.doi || candidate.candidate_id,
        }));
        const ids = [...new Set(refs.map(ref => ref.id))];
        if (ids.length) {
          citationText = ` {{cite:${ids.join('|')}}}`;
          insertedSources += ids.length;
        }
      }
      replacement = replacement.replace(new RegExp(escapeRegExp(marker), 'g'), citationText);
    }
    replacement = replacement
      .replace(/\[\[C\d+\]\]/gi, '')
      .replace(/[ \t]+([,.;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    const { start, end, text: originalText } = state.aiSelection;
    if (state.manuscript.slice(start, end) !== originalText && !confirm('The manuscript changed after AI analysis. Replace the original selected range anyway?')) return;
    snapshot();
    state.manuscript = state.manuscript.slice(0, start) + replacement + state.manuscript.slice(end);
    els.manuscript.value = state.manuscript;
    const cursor = start + replacement.length;
    els.manuscript.focus();
    els.manuscript.setSelectionRange(cursor, cursor);
    els.aiCiteModal.classList.add('hidden');
    renderAll();
    if (els.searchResults._refs) renderSearchResults(els.searchResults._refs);
    save(false);
    showToast(withCitations ? `AI text applied with ${insertedSources} selected source${insertedSources === 1 ? '' : 's'}.` : 'AI text applied without citations.');
  }

  function snapshot() {
    state.undoStack.push(state.manuscript);
    if (state.undoStack.length > 60) state.undoStack.shift();
    state.redoStack = [];
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(state.manuscript);
    state.manuscript = state.undoStack.pop();
    els.manuscript.value = state.manuscript;
    renderAll();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(state.manuscript);
    state.manuscript = state.redoStack.pop();
    els.manuscript.value = state.manuscript;
    renderAll();
  }

  function save(show = true) {
    const payload = { projectTitle: state.projectTitle, manuscript: state.manuscript, style: state.style, references: state.references, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    state.lastSaved = new Date();
    els.saveStatus.textContent = `Saved ${state.lastSaved.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (show) showToast('Project saved locally.');
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!data) return;
      state.projectTitle = data.projectTitle || state.projectTitle;
      state.manuscript = data.manuscript || '';
      state.style = data.style || 'vancouver';
      state.references = Array.isArray(data.references) ? data.references : [];
    } catch (err) { console.warn('Could not load local project', err); }
  }

  function newProject() {
    if ((state.manuscript || state.references.length) && !confirm('Create a new project? The current project remains saved only if you saved it.')) return;
    state.projectTitle = 'Untitled Research Project';
    state.manuscript = '';
    state.style = 'vancouver';
    state.references = [];
    state.selectedLibraryIds.clear();
    state.undoStack = [];
    state.redoStack = [];
    localStorage.removeItem(STORAGE_KEY);
    syncInputs(); renderAll(); showToast('New project created.');
  }

  function exportManuscript() {
    const cited = orderedCitedRefs();
    const manuscriptHtml = renderMarkdownLike(state.manuscript);
    const refsHtml = state.style === 'vancouver'
      ? `<ol>${cited.map(r => `<li>${escapeHtml(formatVancouver(r))}</li>`).join('')}</ol>`
      : cited.map(r => `<p style="padding-left:28px;text-indent:-28px">${escapeHtml(formatApa(r))}</p>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(state.projectTitle)}</title><style>body{font-family:Georgia,serif;max-width:850px;margin:50px auto;line-height:1.65;color:#111}h1{text-align:center;font-family:Arial,sans-serif}h2{font-family:Arial,sans-serif;font-size:19px}.citation-link{font-weight:bold}li{margin-bottom:9px}</style></head><body><h1>${escapeHtml(state.projectTitle)}</h1>${manuscriptHtml}<h2>References</h2>${refsHtml}</body></html>`;
    downloadBlob(html, `${safeFilename(state.projectTitle)}.html`, 'text/html');
    showToast('Manuscript exported as HTML.');
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename(name) { return (name || 'manuscript').replace(/[^a-z0-9\u0600-\u06ff_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0,80) || 'manuscript'; }

  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => showToast('Copied to clipboard.')).catch(() => {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); showToast('Copied to clipboard.');
    });
  }

  function loadDemo() {
    const demo = [
      { id: uid(), source:'Demo', type:'article-journal', title:'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews', authors:[{family:'Page',given:'Matthew J'},{family:'McKenzie',given:'Joanne E'},{family:'Bossuyt',given:'Patrick M'},{family:'Boutron',given:'Isabelle'},{family:'Hoffmann',given:'Tammy C'},{family:'Mulrow',given:'Cynthia D'}], year:'2021', journal:'BMJ', volume:'372', issue:'', pages:'n71', doi:'10.1136/bmj.n71', pmid:'33782057', url:'https://doi.org/10.1136/bmj.n71' },
      { id: uid(), source:'Demo', type:'article-journal', title:'Preferred reporting items for systematic review and meta-analysis protocols (PRISMA-P) 2015 statement', authors:[{family:'Moher',given:'David'},{family:'Shamseer',given:'Larissa'},{family:'Clarke',given:'Mike'},{family:'Ghersi',given:'Davin'},{family:'Liberati',given:'Alessandro'}], year:'2015', journal:'Systematic Reviews', volume:'4', issue:'1', pages:'1', doi:'10.1186/2046-4053-4-1', pmid:'25554246', url:'https://doi.org/10.1186/2046-4053-4-1' },
      { id: uid(), source:'Demo', type:'article-journal', title:'The Newcastle–Ottawa Scale (NOS) for assessing the quality of nonrandomised studies in meta-analyses', authors:[{family:'Wells',given:'George A'},{family:'Shea',given:'Beverley'},{family:'O’Connell',given:'D'},{family:'Peterson',given:'J'},{family:'Welch',given:'V'}], year:'2000', journal:'Ottawa Hospital Research Institute', volume:'', issue:'', pages:'', doi:'', pmid:'', url:'' },
    ];
    let added = 0;
    demo.forEach(ref => { if (!isDuplicate(ref)) { state.references.push(ref); added++; } });
    renderAll(); save(false); showToast(`${added} demo reference${added === 1 ? '' : 's'} added.`);
  }

  function switchView(view) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    els.previewContent.classList.toggle('hidden', view !== 'preview');
    els.referencesContent.classList.toggle('hidden', view !== 'references');
    els.auditContent.classList.toggle('hidden', view !== 'audit');
  }

  function renderAll() { renderLibrary(); renderPreview(); }
  function syncInputs() { els.projectTitle.value = state.projectTitle; els.manuscript.value = state.manuscript; els.citationStyle.value = state.style; }

  function bindEvents() {
    els.searchBtn.addEventListener('click', performSearch);
    els.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') performSearch(); });
    els.searchInput.addEventListener('input', () => els.clearSearchBtn.classList.toggle('hidden', !els.searchInput.value));
    els.clearSearchBtn.addEventListener('click', () => { els.searchInput.value=''; els.searchResults.innerHTML=''; els.searchMessage.textContent='Search results will appear here.'; els.clearSearchBtn.classList.add('hidden'); });
    els.demoBtn.addEventListener('click', loadDemo);
    els.searchResults.addEventListener('click', e => {
      const btn = e.target.closest('[data-add]'); if (!btn) return;
      addReference(els.searchResults._refs?.[Number(btn.dataset.add)]);
    });
    els.libraryFilter.addEventListener('input', renderLibrary);
    els.citationStyle.addEventListener('change', e => { state.style = e.target.value; renderAll(); save(false); });
    els.manuscript.addEventListener('input', e => { state.manuscript = e.target.value; renderPreview(); els.saveStatus.textContent='Unsaved changes'; clearTimeout(bindEvents.saveTimer); bindEvents.saveTimer=setTimeout(()=>save(false),800); });
    els.manuscript.addEventListener('beforeinput', e => { if (e.inputType?.startsWith('insert') || e.inputType?.startsWith('delete')) snapshot(); });
    els.projectTitle.addEventListener('input', e => { state.projectTitle=e.target.value; renderPreview(); els.saveStatus.textContent='Unsaved changes'; });
    els.projectTitle.addEventListener('change', () => save(false));
    els.saveBtn.addEventListener('click', () => save(true));
    els.newProjectBtn.addEventListener('click', newProject);
    els.exportBtn.addEventListener('click', exportManuscript);
    els.manualBtn.addEventListener('click', () => els.manualModal.classList.remove('hidden'));
    els.manualForm.addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(e.target);
      const authors = String(fd.get('authors')||'').split(';').map(s=>s.trim()).filter(Boolean).map(name=>{ const p=name.split(/\s+/); return {family:p.pop()||'',given:p.join(' ')}; });
      addReference({ id:uid(), source:'Manual', type:'article-journal', title:String(fd.get('title')||''), authors, year:String(fd.get('year')||''), journal:String(fd.get('journal')||''), volume:String(fd.get('volume')||''), issue:String(fd.get('issue')||''), pages:String(fd.get('pages')||''), doi:String(fd.get('doi')||''), pmid:String(fd.get('pmid')||''), url:'' });
      e.target.reset(); els.manualModal.classList.add('hidden');
    });
    els.libraryList.addEventListener('change', e => {
      const input = e.target.closest('.library-select'); if (!input) return;
      const id = input.closest('.library-item').dataset.id;
      input.checked ? state.selectedLibraryIds.add(id) : state.selectedLibraryIds.delete(id);
      renderLibrary();
    });
    els.libraryList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const id = btn.closest('.library-item').dataset.id; const ref = state.references.find(r=>r.id===id); if(!ref) return;
      if (btn.dataset.action === 'insert') insertCitation([id]);
      if (btn.dataset.action === 'open') window.open(ref.doi ? `https://doi.org/${normalizeDoi(ref.doi)}` : ref.url, '_blank', 'noopener');
      if (btn.dataset.action === 'copy') copyText(state.style === 'vancouver' ? formatVancouver(ref) : formatApa(ref));
      if (btn.dataset.action === 'delete') { if(confirm('Delete this reference from the library? Existing citation tokens will be marked as missing.')) { state.references=state.references.filter(r=>r.id!==id); state.selectedLibraryIds.delete(id); renderAll(); save(false); } }
    });
    els.insertCitationBtn.addEventListener('click', () => {
      if (!state.references.length) return showToast('Add a reference to the library first.');
      state.pickerSelectedIds = new Set(state.selectedLibraryIds); renderPicker(); els.citationModal.classList.remove('hidden');
    });
    els.modalFilter.addEventListener('input', renderPicker);
    els.citationPicker.addEventListener('change', e => { const input=e.target.closest('input[data-id]'); if(!input)return; input.checked?state.pickerSelectedIds.add(input.dataset.id):state.pickerSelectedIds.delete(input.dataset.id); renderPicker(); });
    els.confirmInsertBtn.addEventListener('click', () => { insertCitation([...state.pickerSelectedIds]); els.citationModal.classList.add('hidden'); });
    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => el(btn.dataset.close).classList.add('hidden')));
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if(e.target===modal) modal.classList.add('hidden'); }));
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));
    els.auditBtn.addEventListener('click', () => switchView('audit'));
    els.aiCiteBtn.addEventListener('click', openAiCiteModal);
    els.aiAnalyzeBtn.addEventListener('click', performAiAnalysis);
    els.aiClaims.addEventListener('change', e => {
      const input = e.target.closest('input[data-ai-claim][data-ai-candidate]');
      if (!input) return;
      const claimId = input.dataset.aiClaim;
      const candidateId = input.dataset.aiCandidate;
      const selected = state.aiSelected.get(claimId) || new Set();
      input.checked ? selected.add(candidateId) : selected.delete(candidateId);
      state.aiSelected.set(claimId, selected);
      updateAiSelectionCount();
    });
    els.aiClaims.addEventListener('click', e => {
      const link = e.target.closest('.ai-open-link');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(link.href, '_blank', 'noopener');
    });
    els.aiApplyTextBtn.addEventListener('click', () => applyAiResult(false));
    els.aiApplyCitationsBtn.addEventListener('click', () => applyAiResult(true));
    els.undoBtn.addEventListener('click', undo); els.redoBtn.addEventListener('click', redo);
    document.querySelectorAll('.toolbar [data-wrap]').forEach(btn => btn.addEventListener('click', () => {
      const wrap=btn.dataset.wrap, start=els.manuscript.selectionStart, end=els.manuscript.selectionEnd; snapshot();
      const selected=state.manuscript.slice(start,end); state.manuscript=state.manuscript.slice(0,start)+wrap+selected+wrap+state.manuscript.slice(end); els.manuscript.value=state.manuscript; els.manuscript.focus(); els.manuscript.setSelectionRange(start+wrap.length,end+wrap.length); renderPreview();
    }));
    document.querySelectorAll('.toolbar [data-prefix]').forEach(btn => btn.addEventListener('click', () => {
      const prefix=btn.dataset.prefix, pos=els.manuscript.selectionStart, lineStart=state.manuscript.lastIndexOf('\n',pos-1)+1; snapshot(); state.manuscript=state.manuscript.slice(0,lineStart)+prefix+state.manuscript.slice(lineStart); els.manuscript.value=state.manuscript; els.manuscript.focus(); els.manuscript.setSelectionRange(pos+prefix.length,pos+prefix.length); renderPreview();
    }));
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s') { e.preventDefault(); save(true); }
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z') { e.preventDefault(); e.shiftKey?redo():undo(); }
    });
  }

  load(); syncInputs(); bindEvents(); renderAll();
})();
