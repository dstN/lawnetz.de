import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and, asc, sql } from 'drizzle-orm';
import * as schema from './schema';
import translationsData from '../data/translations.json';

// Environment variable retrieval helper
const getEnv = (key: string, fallback = ''): string => {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key] as string;
  }
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env?.[key]) {
    // @ts-ignore
    return import.meta.env[key];
  }
  return fallback;
};

const dbUrl = getEnv('DB_URL', '');
const host = getEnv('DB_HOST', 'localhost');
const port = Number(getEnv('DB_PORT', '3306'));
const user = getEnv('DB_USER', '');
const password = getEnv('DB_PASSWORD', '');
const database = getEnv('DB_NAME', 'lawnetz');

export const isDatabaseConfigured = (): boolean => {
  return Boolean(dbUrl || (user && database && database !== ''));
};

let pool: mysql.Pool | null = null;
let dbInstance: any = null;

if (isDatabaseConfigured()) {
  try {
    if (dbUrl) {
      pool = mysql.createPool(dbUrl);
    } else {
      pool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 10,
      });
    }
    dbInstance = drizzle(pool, { schema, mode: 'default' });
  } catch (err) {
    console.warn('[DB] Failed to initialize MySQL pool, falling back to local storage:', err);
  }
}

export const db = dbInstance;


// ==========================================================================
// Repository API — High Performance Data Access
// ==========================================================================

/**
 * Loads a slug → abbreviation map for all German laws.
 * Used on the /gesetze listing to show the official abbreviation
 * instead of the technical slug.
 */
export async function getAllLawAbbreviations(): Promise<Record<string, string>> {
  if (db) {
    try {
      const rows = await db
        .select({ slug: schema.laws.slug, abbreviation: schema.laws.abbreviation })
        .from(schema.laws)
        .where(eq(schema.laws.language, 'de'));
      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.slug] = row.abbreviation;
      }
      return map;
    } catch (err) {
      console.warn('[DB] Error fetching abbreviations:', err);
    }
  }
  return {};
}

export async function getLaw(slug: string, language: 'de' | 'en' = 'de'): Promise<schema.Law | null> {
  if (db) {
    try {
      const results = await db
        .select()
        .from(schema.laws)
        .where(and(eq(schema.laws.slug, slug), eq(schema.laws.language, language)))
        .limit(1);
      if (results.length > 0) return results[0];

      // Fallback: try matching revision suffix (e.g. arbst_ttv -> arbst_ttv_2004, bdsg -> bdsg_2018)
      const suffixed = await db
        .select()
        .from(schema.laws)
        .where(and(sql`${schema.laws.slug} LIKE ${slug + '_%'}`, eq(schema.laws.language, language)))
        .orderBy(sql`${schema.laws.slug} DESC`)
        .limit(1);
      if (suffixed.length > 0) return suffixed[0];
    } catch (err) {
      console.warn(`[DB] Error fetching law "${slug}":`, err);
    }
    return null;
  }

  return null;
}

export async function getNorm(lawSlug: string, normSlug: string): Promise<(schema.Norm & { slug: string }) | null> {
  const normId = `${lawSlug}:${normSlug}`;

  if (db) {
    try {
      const results = await db
        .select()
        .from(schema.norms)
        .where(eq(schema.norms.id, normId))
        .limit(1);
      if (results.length > 0) {
        return {
          ...results[0],
          slug: results[0].normSlug,
        };
      }

      // Check with resolved law slug if lawSlug is without year suffix (e.g. arbst_ttv -> arbst_ttv_2004)
      const resolvedLaw = await getLaw(lawSlug);
      if (resolvedLaw && resolvedLaw.slug !== lawSlug) {
        const suffixedNormId = `${resolvedLaw.slug}:${normSlug}`;
        const suffixedResults = await db
          .select()
          .from(schema.norms)
          .where(eq(schema.norms.id, suffixedNormId))
          .limit(1);
        if (suffixedResults.length > 0) {
          return {
            ...suffixedResults[0],
            slug: suffixedResults[0].normSlug,
          };
        }
      }
    } catch (err) {
      console.warn(`[DB] Error fetching norm "${normId}":`, err);
    }
    return null;
  }

  return null;
}

export async function getLawNorms(lawSlug: string): Promise<Array<{ normSlug: string; identifier: string; title: string; orderIndex: number }>> {
  if (db) {
    try {
      const results = await db
        .select({
          normSlug: schema.norms.normSlug,
          identifier: schema.norms.identifier,
          title: schema.norms.title,
          orderIndex: schema.norms.orderIndex,
        })
        .from(schema.norms)
        .where(eq(schema.norms.lawSlug, lawSlug))
        .orderBy(asc(schema.norms.orderIndex));
      if (results.length > 0) return results;
    } catch (err) {
      console.warn(`[DB] Error fetching norms for law "${lawSlug}":`, err);
    }
    return [];
  }

  return [];
}

/** What fetch-law yields per law, as far as the outline needs it */
interface OutlineSource {
  type: string;
  orderIndex?: number;
  levelCode?: string;
  designation?: string;
  title?: string;
}

let outlineTableMissing = false;

/**
 * Replaces a law's headings with those in `items` (fetch-law's order of
 * headings and norms). Failing here must not fail the norms' sync, so a
 * missing table (before `npm run db:push`) is only logged.
 */
export async function saveLawOutline(lawSlug: string, items: OutlineSource[]): Promise<void> {
  if (!db) return;
  const rows: Array<typeof schema.lawOutline.$inferInsert> = [];
  let pending: OutlineSource[] = [];
  for (const item of items) {
    if (item.type === 'structure') {
      pending.push(item);
    } else if (item.type === 'norm' && item.orderIndex !== undefined) {
      for (const heading of pending) {
        rows.push({
          lawSlug,
          position: rows.length,
          beforeNorm: item.orderIndex,
          // The XML parser reads "010" as the number 10; three digits a level.
          levelCode: heading.levelCode
            ? String(heading.levelCode).padStart(Math.ceil(String(heading.levelCode).length / 3) * 3, '0')
            : null,
          designation: heading.designation ?? null,
          title: heading.title ?? null,
        });
      }
      pending = [];
    }
  }
  try {
    await db.transaction(async (tx: typeof db) => {
      await tx.delete(schema.lawOutline).where(eq(schema.lawOutline.lawSlug, lawSlug));
      if (rows.length > 0) await tx.insert(schema.lawOutline).values(rows);
    });
  } catch (err) {
    // Once, not for each of 6,000 laws: most likely the table is missing.
    if (!outlineTableMissing) console.warn('[DB] Outlines not saved (run `npm run db:push`?):', err);
    outlineTableMissing = true;
  }
}

/** A law's headings in order; none until the table exists and the sync has filled it. */
export async function getLawOutline(lawSlug: string): Promise<schema.LawOutlineRow[]> {
  if (!db || outlineTableMissing) return [];
  try {
    return await db
      .select()
      .from(schema.lawOutline)
      .where(eq(schema.lawOutline.lawSlug, lawSlug))
      .orderBy(asc(schema.lawOutline.position));
  } catch (err) {
    // Most likely `npm run db:push` has not created the table yet: keep the flat list.
    outlineTableMissing = true;
    console.warn('[DB] law_outline unavailable, tables of contents stay flat:', err);
    return [];
  }
}

export interface AdjacentNormItem {
  normSlug: string;
  slug: string;
  identifier: string;
  title: string;
}

export async function getAdjacentNorms(
  lawSlug: string,
  currentNormSlugOrIndex: string | number,
  /** The law's norms, when the caller has loaded them already */
  lawNorms?: Awaited<ReturnType<typeof getLawNorms>>
): Promise<{ prev: AdjacentNormItem | null; next: AdjacentNormItem | null }> {
  const allNorms = lawNorms ?? (await getLawNorms(lawSlug));

  let currentIndex = -1;
  if (typeof currentNormSlugOrIndex === 'string') {
    currentIndex = allNorms.findIndex((n) => n.normSlug === currentNormSlugOrIndex);
  } else {
    currentIndex = allNorms.findIndex((n) => n.orderIndex === currentNormSlugOrIndex);
  }

  const formatItem = (n: typeof allNorms[0] | undefined): AdjacentNormItem | null => {
    if (!n) return null;
    return {
      normSlug: n.normSlug,
      slug: n.normSlug,
      identifier: n.identifier,
      title: n.title,
    };
  };

  return {
    prev: currentIndex > 0 ? formatItem(allNorms[currentIndex - 1]) : null,
    next: currentIndex >= 0 && currentIndex < allNorms.length - 1 ? formatItem(allNorms[currentIndex + 1]) : null,
  };
}

export async function hasTranslation(slug: string): Promise<string | null> {
  // Checks if an English translation exists for a German law
  const baseSlug = slug.replace(/^englisch_/, '');
  const entry = (translationsData as any[]).find(
    (t) => t.germanSlug === slug || t.germanSlug === baseSlug || t.germanSlug === baseSlug.replace(/_\d{4}$/, '')
  );
  if (entry) return entry.slug;

  const englishSlug = `englisch_${baseSlug}`;
  if (db) {
    try {
      const results = await db
        .select({ slug: schema.laws.slug })
        .from(schema.laws)
        .where(eq(schema.laws.slug, englishSlug))
        .limit(1);
      if (results.length > 0) return results[0].slug;
    } catch {}
  }
  return null;
}

/**
 * Law and norm pages for the sitemap, in a stable order so chunks don't overlap.
 * Leaves out laws without norms, "Zum Seitenanfang"-style navigation rows and
 * norms whose slug was truncated (their page can't resolve the id, so it 404s).
 */
export async function getSitemapEntries(offset: number, limit: number): Promise<Array<{ path: string; lastmod: Date }>> {
  if (!db) throw new Error('[DB] Sitemap needs the database');
  type Row = { language: string; law: string; norm: string | null; lastmod: Date | string };
  const [rows] = (await db.execute(sql`
    SELECT language, slug AS law, NULL AS norm, last_synced_at AS lastmod FROM laws WHERE norm_count > 0
    UNION ALL
    SELECT n.language, n.law_slug, n.norm_slug, l.last_synced_at FROM norms n JOIN laws l ON l.slug = n.law_slug
    WHERE n.id = CONCAT(n.law_slug, ':', n.norm_slug)
      AND LOWER(TRIM(n.identifier)) NOT IN ('contents', 'table of contents', 'inhaltsverzeichnis', 'seitenanfang', 'zum seitenanfang', 'translations')
    ORDER BY law, norm
    LIMIT ${limit} OFFSET ${offset}`)) as [Row[], unknown];
  return rows.map((r) => ({
    path: `${r.language === 'en' ? '/en' : ''}/${encodeURIComponent(r.law)}${r.norm ? `/${encodeURIComponent(r.norm)}` : ''}`,
    lastmod: new Date(r.lastmod),
  }));
}
