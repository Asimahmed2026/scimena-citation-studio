const ALLOWED_PREFIXES = ['/works'];

export const handler = async (event) => {
  const path = event.queryStringParameters?.path || '';
  if (!ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return json(400, { error: 'Invalid Crossref path.' });
  }
  try {
    const separator = path.includes('?') ? '&' : '?';
    const url = `https://api.crossref.org${path}${separator}mailto=info@scimena.com`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SciMENA-Citation-Studio/1.0 (mailto:info@scimena.com)'
      }
    });
    const body = await response.text();
    return {
      statusCode: response.status,
      headers: cors({ 'Content-Type': response.headers.get('content-type') || 'application/json' }),
      body
    };
  } catch (error) {
    return json(502, { error: 'Crossref request failed.', detail: error.message });
  }
};

function cors(extra = {}) {
  return { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300', ...extra };
}
function json(statusCode, payload) {
  return { statusCode, headers: cors({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) };
}
