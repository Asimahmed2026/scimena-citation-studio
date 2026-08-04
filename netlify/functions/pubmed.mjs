const ALLOWED = ['/esearch.fcgi', '/esummary.fcgi'];

export const handler = async (event) => {
  const path = event.queryStringParameters?.path || '';
  if (!ALLOWED.some(prefix => path.startsWith(prefix))) {
    return json(400, { error: 'Invalid PubMed path.' });
  }
  try {
    const separator = path.includes('?') ? '&' : '?';
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils${path}${separator}tool=scimena_citation_studio&email=info@scimena.com`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await response.text();
    return {
      statusCode: response.status,
      headers: cors({ 'Content-Type': response.headers.get('content-type') || 'application/json' }),
      body
    };
  } catch (error) {
    return json(502, { error: 'PubMed request failed.', detail: error.message });
  }
};

function cors(extra = {}) {
  return { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300', ...extra };
}
function json(statusCode, payload) {
  return { statusCode, headers: cors({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) };
}
