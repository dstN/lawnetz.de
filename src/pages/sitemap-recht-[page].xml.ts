/**
 * Sitemap chunks for all law and norm pages (~131k URLs, read from the DB).
 * Listed in sitemap-index.xml via `customSitemaps` in astro.config.ts.
 */
import type { APIRoute } from 'astro';
import { getSitemapEntries } from '../db/index';

const SITEMAP_CHUNK_SIZE = 50_000; // protocol maximum per file

export const GET: APIRoute = async ({ params, site }) => {
	if (!/^\d+$/.test(params.page ?? '')) return new Response(null, { status: 404 });
	const entries = await getSitemapEntries(Number(params.page) * SITEMAP_CHUNK_SIZE, SITEMAP_CHUNK_SIZE);
	if (entries.length === 0) return new Response(null, { status: 404 });

	const urls = entries
		.map((e) => `<url><loc>${new URL(e.path, site)}</loc><lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod></url>`)
		.join('\n');
	return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
	});
};
