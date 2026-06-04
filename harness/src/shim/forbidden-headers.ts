/**
 * H4 — Drop browser-forbidden request headers without producing console
 * warnings.
 *
 * Per the Fetch spec a small set of headers (Accept-Encoding, Connection,
 * Cookie, Host, Referer, User-Agent, etc.) cannot be set from page JS — the
 * browser ignores the call but logs a console error like
 *   "Refused to set unsafe header \"Accept-Encoding\""
 * which our gallery runner (and harness Console panel) classify as a control
 * failure. The real Dynamics platform pre-sanitises these headers before the
 * call ever reaches the browser, so deployed PCFs never see the warning.
 *
 * This shim mimics that behaviour by silently dropping the header name when
 * code calls XMLHttpRequest.setRequestHeader, Headers.set/append, or passes
 * a Headers init to fetch(). Surfaced by the gallery validation run on
 * 2026-06-04 (kuldipmaharjan/ImageViewerPCF).
 */

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
]);

function isForbidden(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (FORBIDDEN_REQUEST_HEADERS.has(lower)) return true;
  // Per spec, Proxy-* and Sec-* prefixes are also forbidden.
  return lower.startsWith('proxy-') || lower.startsWith('sec-');
}

let installed = false;

export function installForbiddenHeaderShim(): void {
  if (installed) return;
  installed = true;

  if (typeof XMLHttpRequest !== 'undefined') {
    const origSet = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
      if (isForbidden(name)) return; // silently drop
      return origSet.call(this, name, value);
    };
  }

  if (typeof Headers !== 'undefined') {
    const origSet = Headers.prototype.set;
    const origAppend = Headers.prototype.append;
    Headers.prototype.set = function (name: string, value: string) {
      if (isForbidden(name)) return;
      return origSet.call(this, name, value);
    };
    Headers.prototype.append = function (name: string, value: string) {
      if (isForbidden(name)) return;
      return origAppend.call(this, name, value);
    };
  }
}
