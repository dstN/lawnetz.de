/**
 * Terms a law defines for itself (WCAG 3.1.3 Unusual Words): the mechanism is
 * a list on each law's page of where its definitions are, plus the glossary.
 *
 * Two sources. Most newer laws bundle their definitions in a norm titled
 * "Begriffsbestimmungen" (in translations: "Definitions"), which the norm
 * titles give away. The big old codes (BGB, StGB, HGB) spread them over the
 * text; those come from glossary.json, checked against the law text by
 * tests/e2e/glossary.spec.ts.
 *
 * Deliberately no automatic linking of words in the law text: the same word
 * can mean something else a few norms later ("Unternehmer" in § 14 BGB and in
 * the contract for work, § 631 BGB), and a wrong link would mislead.
 */
import glossary from './glossary.json';

export type Language = 'de' | 'en';

export interface GlossaryEntry {
	term: string;
	law: string;
	norm: string;
	match: string;
}

export interface LawDefinition {
	term: string;
	normSlug: string;
	identifier: string;
}

const DEFINING_TITLE: Record<Language, RegExp> = {
	de: /begriffsbestimmung|^begriffe\b|legaldefinition/i,
	en: /\bdefinitions?\b/i,
};

export function glossaryEntries(language: Language): GlossaryEntry[] {
	return glossary[language];
}

export function lawDefinitions(
	lawSlug: string,
	norms: Array<{ normSlug: string; identifier: string; title: string }>,
	language: Language,
): LawDefinition[] {
	const identifierOf = new Map(norms.map((n) => [n.normSlug, n.identifier]));
	const curated = glossary[language]
		.filter((e) => e.law === lawSlug && identifierOf.has(e.norm))
		.map((e) => ({ term: e.term, normSlug: e.norm, identifier: identifierOf.get(e.norm) ?? e.norm }));
	const titled = norms
		.filter((n) => DEFINING_TITLE[language].test(n.title) && !curated.some((c) => c.normSlug === n.normSlug))
		.map((n) => ({ term: n.title, normSlug: n.normSlug, identifier: n.identifier }));
	return [...titled, ...curated];
}
