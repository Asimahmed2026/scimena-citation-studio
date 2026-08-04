const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const MAX_TEXT_LENGTH = 6000;
const MAX_CLAIMS = 5;
const MAX_RESULTS_PER_SOURCE = 6;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(503, {
      error: 'OPENAI_API_KEY is not configured.',
      detail: 'Add OPENAI_API_KEY in Netlify environment variables and redeploy the site.'
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON request body.' });
  }

  const text = String(payload.text || '').trim();
  const mode = payload.mode === 'find' ? 'find' : 'polish';
  if (text.length < 20) return json(400, { error: 'Select a complete sentence or paragraph.' });
  if (text.length > MAX_TEXT_LENGTH) return json(400, { error: `Text must not exceed ${MAX_TEXT_LENGTH} characters.` });

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  try {
    const analysis = await analyzeClaims({ apiKey, model, text, mode });
    const normalized = normalizeAnalysis(analysis.claims, analysis.polished_text, text);
    const claims = normalized.claims;

    const claimsWithCandidates = await Promise.all(
      claims.map(async (claim) => ({
        ...claim,
        candidates: await searchClaim(claim)
      }))
    );

    const ranked = await rankCandidates({
      apiKey,
      model,
      claims: claimsWithCandidates
    }).catch((error) => {
      console.warn('OpenAI ranking failed; using lexical fallback.', error.message);
      return [];
    });

    const rankingMap = new Map(ranked.map((match) => [
      `${match.claim_id}::${match.candidate_id}`,
      match
    ]));

    const finalClaims = claimsWithCandidates.map((claim) => {
      const rankedCandidates = claim.candidates.map((candidate) => {
        const match = rankingMap.get(`${claim.id}::${candidate.candidate_id}`);
        const fallback = lexicalRelevance(claim, candidate);
        return {
          ...candidate,
          relevance: normalizeRelevance(match?.relevance || fallback.relevance),
          rationale: cleanText(match?.rationale || fallback.rationale, 320),
          _score: relevanceScore(match?.relevance || fallback.relevance) + fallback.score
        };
      }).sort((a, b) => b._score - a._score);

      const useful = rankedCandidates.filter((candidate) => candidate.relevance !== 'weak').slice(0, 4);
      const selected = useful.length ? useful : rankedCandidates.slice(0, 3);
      return {
        ...claim,
        candidates: selected.map(({ _score, abstract, ...candidate }) => candidate)
      };
    });

    return json(200, {
      model,
      polished_text: ensureMarkers(normalized.polished_text, finalClaims),
      claims: finalClaims
    });
  } catch (error) {
    console.error('AI citation function failed:', error);
    return json(error.statusCode || 502, {
      error: 'AI citation analysis failed.',
      detail: error.message || 'Unknown error.'
    });
  }
};

async function analyzeClaims({ apiKey, model, text, mode }) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['polished_text', 'claims'],
    properties: {
      polished_text: { type: 'string' },
      claims: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CLAIMS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'claim', 'search_query', 'marker'],
          properties: {
            id: { type: 'string' },
            claim: { type: 'string' },
            search_query: { type: 'string' },
            marker: { type: 'string' }
          }
        }
      }
    }
  };

  const instruction = mode === 'find'
    ? 'Preserve the user wording exactly except for adding claim markers.'
    : 'Improve clarity, grammar, concision, and academic tone without changing meaning or adding new factual claims.';

  const system = `You are a biomedical academic-writing assistant. ${instruction}
Identify between 1 and ${MAX_CLAIMS} independently citable factual claims. Do not invent references, authors, journals, identifiers, statistics, or facts.
Return polished_text in the same language as the input. For each claim, use sequential IDs C1, C2, and so on. Insert the exact marker [[C1]], [[C2]], etc. once in polished_text immediately after the punctuation that ends the supported clause. Every listed claim must have exactly one marker and every marker must correspond to a listed claim.
Write search_query in English as a concise PubMed/Crossref search query containing the central population, exposure/intervention, and outcome concepts. Avoid full sentences, quotation marks, DOI values, and invented study names.`;

  return openAiStructured({
    apiKey,
    model,
    name: 'citation_claim_analysis',
    schema,
    maxOutputTokens: 2200,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  });
}

async function rankCandidates({ apiKey, model, claims }) {
  const rows = [];
  for (const claim of claims) {
    for (const candidate of claim.candidates) {
      rows.push({
        claim_id: claim.id,
        claim: claim.claim,
        candidate_id: candidate.candidate_id,
        title: candidate.title,
        year: candidate.year,
        journal: candidate.journal,
        abstract: cleanText(candidate.abstract || '', 1800)
      });
    }
  }
  if (!rows.length) return [];

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['matches'],
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claim_id', 'candidate_id', 'relevance', 'rationale'],
          properties: {
            claim_id: { type: 'string' },
            candidate_id: { type: 'string' },
            relevance: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
            rationale: { type: 'string' }
          }
        }
      }
    }
  };

  const system = `You screen biomedical references for citation relevance. Evaluate only the supplied title and abstract metadata. Do not infer evidence that is not stated.
Use strong only when the record directly addresses and appears capable of supporting the claim. Use moderate for partial or indirect support. Use weak when the record is off-topic, too broad, or metadata is insufficient. Be especially conservative when no abstract is available. Return one match for every supplied candidate. Keep each rationale under 28 words.`;

  const result = await openAiStructured({
    apiKey,
    model,
    name: 'citation_candidate_ranking',
    schema,
    maxOutputTokens: Math.min(5000, 350 + rows.length * 90),
    input: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(rows) }
    ]
  });
  return Array.isArray(result.matches) ? result.matches : [];
}

async function openAiStructured({ apiKey, model, name, schema, input, maxOutputTokens }) {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `OpenAI request failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  const outputText = extractOutputText(data);
  if (!outputText) throw new Error('OpenAI returned no structured output.');
  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error('OpenAI returned invalid structured JSON.');
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function normalizeAnalysis(rawClaims, polishedText, originalText) {
  let normalizedText = String(polishedText || originalText).trim();
  const claims = (Array.isArray(rawClaims) ? rawClaims : []).slice(0, MAX_CLAIMS).map((claim, index) => {
    const id = `C${index + 1}`;
    const marker = `[[${id}]]`;
    const rawId = cleanText(claim.id || '', 30);
    const rawMarker = cleanText(claim.marker || '', 40);
    const possibleMarkers = [rawMarker, rawId ? `[[${rawId}]]` : ''].filter(Boolean);
    for (const possible of possibleMarkers) {
      normalizedText = normalizedText.split(possible).join(marker);
    }
    return {
      id,
      claim: cleanText(claim.claim || originalText, 800),
      search_query: cleanText(claim.search_query || claim.claim || originalText, 500),
      marker
    };
  }).filter((claim) => claim.claim && claim.search_query);

  if (!claims.length) {
    return {
      polished_text: `${normalizedText} [[C1]]`.trim(),
      claims: [{ id: 'C1', claim: cleanText(originalText, 800), search_query: cleanText(originalText, 500), marker: '[[C1]]' }]
    };
  }
  return { polished_text: normalizedText, claims };
}

function ensureMarkers(text, claims) {
  let result = String(text || '').trim();
  for (const claim of claims) {
    const marker = claim.marker;
    if (!result.includes(marker)) result += ` ${marker}`;
  }
  return result;
}

async function searchClaim(claim) {
  const settled = await Promise.allSettled([
    searchPubMed(claim.search_query),
    searchCrossref(claim.search_query)
  ]);
  const combined = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const unique = [];
  const seen = new Set();
  for (const candidate of combined) {
    const key = candidate.doi
      ? `doi:${normalizeDoi(candidate.doi)}`
      : candidate.pmid
        ? `pmid:${candidate.pmid}`
        : `title:${normalizeTitle(candidate.title)}:${candidate.year}`;
    if (!seen.has(key) && candidate.title) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique.slice(0, 10).map((candidate, index) => ({
    ...candidate,
    candidate_id: `${claim.id}_R${index + 1}`
  }));
}

async function searchPubMed(query) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const common = 'tool=scimena_citation_studio&email=info@scimena.com';
  const searchUrl = `${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${MAX_RESULTS_PER_SOURCE}&sort=relevance&${common}`;
  const searchResponse = await fetch(searchUrl, { headers: { Accept: 'application/json' } });
  if (!searchResponse.ok) throw new Error(`PubMed search HTTP ${searchResponse.status}`);
  const searchData = await searchResponse.json();
  const ids = searchData.esearchresult?.idlist || [];
  if (!ids.length) return [];

  const [summaryResponse, abstractResponse] = await Promise.all([
    fetch(`${base}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&${common}`, { headers: { Accept: 'application/json' } }),
    fetch(`${base}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml&${common}`, { headers: { Accept: 'application/xml,text/xml' } })
  ]);
  if (!summaryResponse.ok) throw new Error(`PubMed summary HTTP ${summaryResponse.status}`);
  const summaryData = await summaryResponse.json();
  const abstractMap = abstractResponse.ok ? parsePubMedAbstracts(await abstractResponse.text()) : new Map();

  return (summaryData.result?.uids || ids).map((id) => {
    const item = summaryData.result?.[id];
    if (!item) return null;
    const articleIds = item.articleids || [];
    const doi = articleIds.find((entry) => entry.idtype === 'doi')?.value || '';
    return {
      source_id: String(id),
      source: 'PubMed',
      type: 'article-journal',
      title: stripTags(item.title || 'Untitled'),
      authors: parsePubMedAuthors(item.authors || []),
      year: String(item.pubdate || '').match(/\d{4}/)?.[0] || '',
      journal: item.fulljournalname || item.source || '',
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.pages || '',
      doi,
      pmid: String(id),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      abstract: abstractMap.get(String(id)) || ''
    };
  }).filter(Boolean);
}

async function searchCrossref(query) {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${MAX_RESULTS_PER_SOURCE}&mailto=info@scimena.com`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SciMENA-Citation-Studio/2.0 (mailto:info@scimena.com)'
    }
  });
  if (!response.ok) throw new Error(`Crossref search HTTP ${response.status}`);
  const data = await response.json();
  return (data.message?.items || []).map((item) => {
    const dateParts = item.published?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0] || [];
    return {
      source_id: item.DOI || item.URL || '',
      source: 'Crossref',
      type: item.type || 'article-journal',
      title: stripTags(item.title?.[0] || 'Untitled'),
      authors: (item.author || []).map((author) => ({ family: author.family || '', given: author.given || '' })),
      year: dateParts[0] ? String(dateParts[0]) : '',
      journal: item['container-title']?.[0] || '',
      volume: item.volume || '',
      issue: item.issue || '',
      pages: item.page || item['article-number'] || '',
      doi: item.DOI || '',
      pmid: '',
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
      abstract: stripTags(item.abstract || '')
    };
  });
}

function parsePubMedAuthors(authors) {
  return authors.map((author) => {
    const raw = String(author.name || '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { family: raw, given: '' };
    return { family: parts.slice(0, -1).join(' '), given: parts.at(-1) };
  });
}

function parsePubMedAbstracts(xml) {
  const map = new Map();
  const articles = String(xml).match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  for (const article of articles) {
    const pmid = decodeXml(article.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/)?.[1] || '').trim();
    const parts = [...article.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((match) => {
      const label = decodeXml(match[1].match(/Label="([^"]+)"/)?.[1] || '');
      const text = stripTags(match[2]);
      return label ? `${label}: ${text}` : text;
    }).filter(Boolean);
    if (pmid && parts.length) map.set(pmid, parts.join(' '));
  }
  return map;
}

function lexicalRelevance(claim, candidate) {
  const claimTokens = tokenSet(`${claim.claim} ${claim.search_query}`);
  const candidateTokens = tokenSet(`${candidate.title} ${candidate.abstract}`);
  const overlap = [...claimTokens].filter((token) => candidateTokens.has(token)).length;
  const score = claimTokens.size ? overlap / claimTokens.size : 0;
  const relevance = score >= 0.42 ? 'strong' : score >= 0.20 ? 'moderate' : 'weak';
  return {
    relevance,
    score,
    rationale: relevance === 'strong'
      ? 'Title or abstract directly overlaps with the main claim concepts.'
      : relevance === 'moderate'
        ? 'The record overlaps with part of the claim but may not support every component.'
        : 'Metadata provides limited evidence that this record directly supports the claim.'
  };
}

function tokenSet(text) {
  const stop = new Set(['the','and','for','with','that','from','this','were','was','are','have','has','into','among','between','than','their','these','those','using','used','study','studies','patients','patient']);
  return new Set(normalizeTitle(text).split(/\s+/).filter((token) => token.length > 3 && !stop.has(token)));
}

function relevanceScore(value) {
  return value === 'strong' ? 3 : value === 'moderate' ? 2 : 1;
}

function normalizeRelevance(value) {
  return ['strong', 'moderate', 'weak'].includes(value) ? value : 'weak';
}

function normalizeDoi(value = '') {
  return String(value).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
}

function normalizeTitle(value = '') {
  return stripTags(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ').trim();
}

function stripTags(value = '') {
  return decodeXml(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function decodeXml(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function cleanText(value = '', max = 1000) {
  return stripTags(value).slice(0, max).trim();
}

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    ...extra
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: cors({ 'Content-Type': 'application/json; charset=utf-8' }),
    body: JSON.stringify(payload)
  };
}
