/**
 * middleware.ts
 *
 * URL Normalization & SEO:
 * 1. Strips .html extensions (gesetze-im-internet.de compatibility)
 * 2. Strips trailing slashes from pathnames to maintain canonical URLs
 * 3. 301 permanent redirects for clean, consistent routing
 */

import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async ({ request, redirect }, next) => {
  const url = new URL(request.url);
  let path = url.pathname;
  let shouldRedirect = false;

  // Strip .html extension
  if (path.endsWith('.html')) {
    path = path.replace(/\.html$/, '');
    shouldRedirect = true;
  }

  // Strip trailing slash (except root '/')
  if (path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '');
    shouldRedirect = true;
  }

  if (shouldRedirect) {
    const newURL = path + url.search + url.hash;
    return redirect(newURL, 301);
  }

  const response = await next();

  // Strict Privacy & Security Headers (100% GDPR-compliant, zero third-party leakage)
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
  );

  return response;
});
