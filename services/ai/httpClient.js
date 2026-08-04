const { DomainError } = require('../../utils/domainError');

const DEFAULT_TIMEOUT_MS = 20_000;

function providerErrorCode(status) {
  if (status === 401 || status === 403) return 'AI_AUTHENTICATION_FAILED';
  if (status === 429) return 'AI_RATE_LIMITED';
  if (status === 402) return 'AI_CREDITS_EXHAUSTED';
  return 'AI_PROVIDER_UNAVAILABLE';
}

function createHttpClient({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fetchFn = fetchImpl;

  async function postJson(url, headers, body) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const contentType = response.headers?.get?.('content-type') || '';
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        const code = providerErrorCode(response.status);
        throw new DomainError(502, code, `AI provider responded HTTP ${response.status}: ${detail}`);
      }
      return data;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error.name === 'AbortError') {
        throw new DomainError(502, 'AI_TIMEOUT', `AI provider timed out after ${timeoutMs}ms`);
      }
      throw new DomainError(
        502,
        'AI_PROVIDER_UNREACHABLE',
        `Unable to reach AI provider: ${error.message || 'network error'}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return { postJson };
}

module.exports = { createHttpClient, DEFAULT_TIMEOUT_MS };