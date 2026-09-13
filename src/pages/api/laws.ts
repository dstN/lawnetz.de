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
		const q = queryParam.trim().toLowerCase();
		const matches: LawEntry[] = [];
		const exactSlugMatches: LawEntry[] = [];
		const prefixSlugMatches: LawEntry[] = [];
		const otherMatches: LawEntry[] = [];

		for (const law of laws) {
			const slugLower = law.slug.toLowerCase();
			const titleLower = law.title.toLowerCase();

			if (slugLower === q) {
				exactSlugMatches.push(law);
			} else if (slugLower.startsWith(q)) {
				prefixSlugMatches.push(law);
			} else if (slugLower.includes(q) || titleLower.includes(q)) {
				otherMatches.push(law);
			}

			// Cap to 60 matches for lightning-fast performance
			if (exactSlugMatches.length + prefixSlugMatches.length + otherMatches.length >= 60) {
				break;
			}
		}

		matches.push(...exactSlugMatches, ...prefixSlugMatches, ...otherMatches);

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
