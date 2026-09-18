import type { APIRoute } from 'astro';
import tocData from '@data/toc.json';

interface LawEntry {
	title: string;
	slug: string;
	xmlUrl: string;
	firstLetter: string;
}

const laws = tocData.laws as LawEntry[];

// Pre-group laws by letter in memory for O(1) lookups
const alphabet = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const lawsByLetter = new Map<string, LawEntry[]>();
alphabet.forEach((l) => lawsByLetter.set(l, []));

for (const law of laws) {
	const char = law.firstLetter?.toUpperCase() || '#';
	const key = lawsByLetter.has(char) ? char : '#';
	lawsByLetter.get(key)!.push(law);
}

export const GET: APIRoute = async ({ url }) => {
	const letterParam = url.searchParams.get('letter') || url.searchParams.get('buchstabe');
	const queryParam = url.searchParams.get('q');

	// 1. Search Query
	if (queryParam && queryParam.trim().length > 0) {
		const rawQ = queryParam.trim();
		const q = rawQ.toLowerCase();
		const qClean = q.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
		const searchTokens = qClean.split(' ').filter((t) => t.length > 0);

		const exactSlugMatches: LawEntry[] = [];
		const prefixSlugMatches: LawEntry[] = [];
		const tokenMatches: LawEntry[] = [];

		for (const law of laws) {
			const slugLower = law.slug.toLowerCase();
			const slugNormalized = slugLower.replace(/_/g, ' ');
			const titleLower = law.title.toLowerCase();

			if (slugLower === q || slugNormalized === qClean) {
				exactSlugMatches.push(law);
			} else if (slugLower.startsWith(q) || slugNormalized.startsWith(qClean)) {
				prefixSlugMatches.push(law);
			} else {
				const matchesAll = searchTokens.every(
					(token) => slugLower.includes(token) || slugNormalized.includes(token) || titleLower.includes(token)
				);
				if (matchesAll) {
					tokenMatches.push(law);
				}
			}

			// Cap to 60 matches for lightning-fast performance
			if (exactSlugMatches.length + prefixSlugMatches.length + tokenMatches.length >= 60) {
				break;
			}
		}

		const matches = [...exactSlugMatches, ...prefixSlugMatches, ...tokenMatches];

		return new Response(
			JSON.stringify({
				query: queryParam,
				count: matches.length,
				laws: matches,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600, s-maxage=86400',
				},
			}
		);
	}

	// 2. Letter Query
	if (letterParam) {
		let key = letterParam.trim().toUpperCase();
		if (key === '0' || key === '0-9' || key === 'ZIFFERN' || key === '%23') {
			key = '#';
		}
		if (!lawsByLetter.has(key)) {
			key = '#';
		}

		const results = lawsByLetter.get(key) || [];

		return new Response(
			JSON.stringify({
				letter: key,
				count: results.length,
				laws: results,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600, s-maxage=86400',
				},
			}
		);
	}

	// 3. Overview / Counts
	const letterCounts: Record<string, number> = {};
	alphabet.forEach((l) => {
		letterCounts[l] = lawsByLetter.get(l)?.length || 0;
	});

	return new Response(
		JSON.stringify({
			totalCount: laws.length,
			letterCounts,
		}),
		{
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=3600, s-maxage=86400',
			},
		}
	);
};
