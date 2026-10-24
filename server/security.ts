import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type express from 'express';

const uiPort = 5173;

export function allowedHosts(port: number) {
  return new Set(['127.0.0.1', 'localhost'].flatMap((host) => [`${host}:${port}`, `${host}:${uiPort}`]));
}

export function allowedOrigins(port: number) {
  return new Set([...allowedHosts(port)].map((host) => 'http://' + host));
}

const envToken = process.env.COMMAND_DECK_TOKEN && process.env.COMMAND_DECK_TOKEN.length >= 32 ? process.env.COMMAND_DECK_TOKEN : null;

/**
 * The API token. COMMAND_DECK_TOKEN wins; otherwise the server loads (or creates) a token file in
 * its data folder so local clients such as the MCP server can authenticate without setup.
 * Until then a random in-memory token is used (tests, or a server that never stores one).
 */
let apiToken = envToken ?? crypto.randomBytes(32).toString('base64url');

export const tokenFileName = 'api-token';

export async function useStoredApiToken(dataDir: string) {
  if (envToken) return;
  const file = path.join(dataDir, tokenFileName);
  const existing = (await fs.readFile(file, 'utf8').catch(() => '')).trim();
  if (existing.length >= 32) {
    apiToken = existing;
    return;
  }
  await fs.mkdir(dataDir, { recursive: true });
  // 0o600 restricts the file on POSIX; on Windows it inherits the user-only ACL of the profile folder.
  await fs.writeFile(file, apiToken + '\n', { encoding: 'utf8', mode: 0o600 });
}

function tokenMatches(presented: string) {
  const a = Buffer.from(presented);
  const b = Buffer.from(apiToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rejects DNS-rebinding (foreign Host) and cross-site (foreign Origin) requests before any route runs. */
export function requestGuard(port: number): express.RequestHandler {
  const hosts = allowedHosts(port);
  const origins = allowedOrigins(port);
  return (req, res, next) => {
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {res.locals.securityDenial='host_rejected';return res.status(421).json({ error: 'Untrusted host.' });}
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {res.locals.securityDenial='origin_rejected';return res.status(403).json({ error: 'Untrusted request origin.' });}
    // Page navigations may arrive from other sites (e.g. a link in an alert); API calls may not.
    const site = req.headers['sec-fetch-site'];
    if (req.path.startsWith('/api/') && site && site !== 'same-origin' && site !== 'none') {
      res.locals.securityDenial='origin_rejected';return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }
    next();
  };
}

/** Requires `Authorization: Bearer <token>` on every API route except the public allowlist. */
export function requireToken(publicPaths: Set<string>): express.RequestHandler {
  let failureWindow=0,failures=0;
  return (req, res, next) => {
    if (publicPaths.has(req.path)) return next();
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !tokenMatches(presented)) {
      const now=Date.now();if(now-failureWindow>=60000){failureWindow=now;failures=0;}
      if(++failures>20){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((failureWindow+60000-now)/1000))));return res.status(429).json({error:'Too many invalid session attempts. Wait before retrying.'});}
      return res.status(401).json({ error: 'Command Deck session required.' });
    }
    next();
  };
}

/**
 * The browser obtains its token here. The request guard has already rejected foreign hosts and
 * origins; this additionally requires a same-origin browser fetch so other sites cannot read it.
 */
export const sessionHandler: express.RequestHandler = (req, res) => {
  if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ error: 'Sessions are issued to the Command Deck UI only.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: apiToken });
};

export const securityHeaders: express.RequestHandler = (req, res, next) => {
  if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src https: http://127.0.0.1:8790",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
};

/** Allows one call per key per window; used for endpoints that spend provider API quota or spawn processes. */
export function cooldown(windowMs: number) {
  const last = new Map<string, number>();
  return (key: string) => {
    const now = Date.now();
    const previous = last.get(key) ?? 0;
    if (now - previous < windowMs) return Math.ceil((windowMs - (now - previous)) / 1000);
    last.set(key, now);
    return 0;
  };
}

