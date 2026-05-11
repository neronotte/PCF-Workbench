import type { Connect, Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

import { PROXY_BASE } from './dataverse-proxy';

/* -------------------------------------------------------------------------- */
/* Per-session secret                                                          */
/* -------------------------------------------------------------------------- */

/** Fresh secret per `vite dev` run. Rotates on every plugin instantiation,
 *  which means the secret is invalidated on server restart — by design. */
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

export function getSessionSecret(): string {
  return SESSION_SECRET;
}

const META_TAG = `<meta name="pcf-session" content="${SESSION_SECRET}">`;

/* -------------------------------------------------------------------------- */
/* Allowlists                                                                  */
/* -------------------------------------------------------------------------- */

/** Hosts we accept on the `Host` header. Anything else suggests the request
 *  is not from a localhost browser tab (DNS rebinding, reverse proxy abuse). */
function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // host header is `host[:port]`; we compare host portion only.
  const host = hostHeader.split(':')[0]!.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Origins we accept. Same-origin to whatever Vite is serving. Empty / missing
 *  Origin is allowed for non-CORS requests (e.g. browser top-level fetches),
 *  but only if Host is also localhost. */
function isAllowedOrigin(originHeader: string | undefined): boolean {
  if (!originHeader) return true; // Same-origin XHR omits Origin in some browsers
  try {
    const u = new URL(originHeader);
    const host = u.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Constant-time compare                                                       */
/* -------------------------------------------------------------------------- */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                  */
/* -------------------------------------------------------------------------- */

function deny(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: code, message }));
}

/** Gate that runs BEFORE the dataverse proxy middleware. Only enforces on
 *  `/__pcf/dv/*` requests; everything else is passed through untouched so
 *  the rest of the harness keeps working. */
export function dataverseSecurityMiddleware(): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url ?? '';
    if (!url.startsWith(PROXY_BASE)) return next();

    if (!isAllowedHost(req.headers.host)) {
      return deny(res, 403, 'forbidden', `Host header ${req.headers.host ?? '<missing>'} not allowed.`);
    }
    if (!isAllowedOrigin(req.headers.origin as string | undefined)) {
      return deny(res, 403, 'forbidden', `Origin ${req.headers.origin ?? '<missing>'} not allowed.`);
    }
    const presented = req.headers['x-pcf-session'];
    if (typeof presented !== 'string' || !safeEqual(presented, SESSION_SECRET)) {
      return deny(res, 403, 'forbidden', 'Missing or invalid x-pcf-session header.');
    }
    next();
  };
}

/* -------------------------------------------------------------------------- */
/* HTML transform — inject <meta name="pcf-session">                           */
/* -------------------------------------------------------------------------- */

/** Vite plugin that:
 *   1. Mounts the security middleware on every request to `/__pcf/dv/*`.
 *   2. Injects `<meta name="pcf-session">` into every served HTML page so the
 *      browser-side fetch wrapper can read it.
 *
 *  Mount this BEFORE `dataverseProxy()` in the plugins array so the gate
 *  runs first. */
export function dataverseSecurity(): Plugin {
  return {
    name: 'pcf-dataverse-security',
    enforce: 'pre',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(dataverseSecurityMiddleware());
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'pcf-session', content: SESSION_SECRET },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export const __test__ = {
  isAllowedHost,
  isAllowedOrigin,
  safeEqual,
  META_TAG,
};
