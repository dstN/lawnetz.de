import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and, asc, sql } from 'drizzle-orm';
import * as schema from './schema';
import fs from 'node:fs';
import path from 'node:path';
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
// Local Storage Fallback Cache
// ==========================================================================
const localCache = new Map<string, any>();

function loadLocalLaw(slug: string): any | null {
  if (localCache.has(slug)) return localCache.get(slug);
  const filePath = path.join(process.cwd(), 'src', 'data', 'laws', `${slug}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      localCache.set(slug, data);
      return data;
    } catch {
      return null;
    }
  }
  return null;
}

// ==========================================================================
// Repository API — High Performance Data Access
// ==========================================================================

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

  // Fallback to local files only if DB is not configured
  const local = loadLocalLaw(slug);
  if (local) {
    return {
      slug: local.slug,
      abbreviation: local.abbreviation || slug.toUpperCase(),
      title: local.title,
      language: 'de',
      normCount: local.norms ? local.norms.length : 0,
      sourceUrl: `https://www.gesetze-im-internet.de/${slug}/index.html`,
      lastSyncedAt: new Date(local.lastUpdated || Date.now()),
      createdAt: new Date(),
    };
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

  // Fallback to local files only if DB is not configured
  const local = loadLocalLaw(lawSlug);
  if (local && local.norms) {
    const foundIndex = local.norms.findIndex((n: any) => n.slug === normSlug);
    if (foundIndex !== -1) {
      const found = local.norms[foundIndex];
      return {
        id: normId,
        lawSlug,
        normSlug: found.slug,
        slug: found.slug,
        identifier: found.identifier,
        title: found.title,
        paragraphs: found.paragraphs,
        contentHtml: null,
        contentText: found.paragraphs ? found.paragraphs.map((p: any) => (typeof p === 'string' ? p : p.text || '')).join('\n') : '',
        orderIndex: found.orderIndex ?? foundIndex,
        language: 'de',
        createdAt: new Date(),
      };
    }
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

  // Fallback only if DB is not configured
  const local = loadLocalLaw(lawSlug);
  if (local && local.norms) {
    return local.norms.map((n: any, idx: number) => ({
      normSlug: n.slug,
      identifier: n.identifier,
      title: n.title,
      orderIndex: n.orderIndex ?? idx,
    }));
  }

  return [];
}

export interface AdjacentNormItem {
  normSlug: string;
  slug: string;
  identifier: string;
  title: string;
}

export async function getAdjacentNorms(
  lawSlug: string,
  currentNormSlugOrIndex: string | number
): Promise<{ prev: AdjacentNormItem | null; next: AdjacentNormItem | null }> {
  const allNorms = await getLawNorms(lawSlug);

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
