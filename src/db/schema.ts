import {
  mysqlTable,
  int,
  varchar,
  text,
  mediumtext,
  timestamp,
  json,
  index,
} from 'drizzle-orm/mysql-core';

// ==========================================================================
// Laws — Metadata for all German & English translated laws
// ==========================================================================

export const laws = mysqlTable(
  'laws',
  {
    slug: varchar('slug', { length: 128 }).primaryKey(),
    abbreviation: varchar('abbreviation', { length: 64 }).notNull(),
    title: text('title').notNull(),
    language: varchar('language', { length: 8 }).default('de').notNull(), // 'de' | 'en'
    normCount: int('norm_count').default(0).notNull(),
    sourceUrl: varchar('source_url', { length: 512 }),
    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_laws_abbreviation').on(table.abbreviation),
    index('idx_laws_language').on(table.language),
  ]
);

// ==========================================================================
// Norms — Individual articles and sections (§§)
// ==========================================================================

export const norms = mysqlTable(
  'norms',
  {
    id: varchar('id', { length: 255 }).primaryKey(), // e.g. "bgb:__138"
    lawSlug: varchar('law_slug', { length: 128 }).notNull(),
    normSlug: varchar('norm_slug', { length: 128 }).notNull(),
    identifier: varchar('identifier', { length: 128 }).notNull(), // e.g. "§ 138"
    title: text('title').notNull(),
    paragraphs: json('paragraphs').$type<Array<{ number: string | null; text: string }>>().notNull(),
    contentHtml: mediumtext('content_html'), // Pre-rendered semantic HTML with Gesetzesrand
    contentText: mediumtext('content_text'), // Plain text for search indexing
    orderIndex: int('order_index').default(0).notNull(),
    language: varchar('language', { length: 8 }).default('de').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_norms_law_slug').on(table.lawSlug),
    index('idx_norms_norm_slug').on(table.normSlug),
    index('idx_norms_identifier').on(table.identifier),
    index('idx_norms_order').on(table.lawSlug, table.orderIndex),
  ]
);

// ==========================================================================
// Law Outline — Buch / Abschnitt / Titel headings between the norms
// ==========================================================================
// GII's XML carries them as norms without a number; each row sits before the
// first norm it covers. They are the law's section headings (WCAG 2.4.10).

export const lawOutline = mysqlTable(
  'law_outline',
  {
    id: int('id').primaryKey().autoincrement(),
    lawSlug: varchar('law_slug', { length: 128 }).notNull(),
    position: int('position').notNull(), // order among the law's headings
    beforeNorm: int('before_norm').notNull(), // orderIndex of the first norm below the heading
    levelCode: varchar('level_code', { length: 64 }), // gliederungskennzahl, three digits a level
    designation: text('designation'), // e.g. "Buch 1"
    title: text('title'), // e.g. "Allgemeiner Teil"
  },
  (table) => [index('idx_law_outline_law').on(table.lawSlug, table.position)]
);

// ==========================================================================
// Law Sync State — what the sync knows about each law's file at GII
// ==========================================================================
// One row per German law: ETag and Last-Modified of its xml.zip at the last
// check, so scripts/sync-core.ts downloads only what changed.

export const lawSyncState = mysqlTable('law_sync_state', {
  slug: varchar('slug', { length: 128 }).primaryKey(),
  etag: varchar('etag', { length: 255 }),
  lastModified: varchar('last_modified', { length: 64 }),
  status: varchar('status', { length: 16 }), // 'ok' | 'not_found' | 'error'
  checkedAt: timestamp('checked_at').notNull(),
});

// ==========================================================================
// Sync Logs — Audit trail of daily delta crawls
// ==========================================================================

export const syncLogs = mysqlTable('sync_logs', {
  id: int('id').primaryKey().autoincrement(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  lawsChecked: int('laws_checked').default(0).notNull(),
  lawsUpdated: int('laws_updated').default(0).notNull(),
  status: varchar('status', { length: 32 }).notNull(), // 'success' | 'failed' | 'partial'
  durationMs: int('duration_ms').default(0).notNull(),
  details: json('details'),
});

export type Law = typeof laws.$inferSelect;
export type NewLaw = typeof laws.$inferInsert;
export type Norm = typeof norms.$inferSelect;
export type NewNorm = typeof norms.$inferInsert;
export type SyncLog = typeof syncLogs.$inferSelect;
export type LawOutlineRow = typeof lawOutline.$inferSelect;
export type LawSyncState = typeof lawSyncState.$inferSelect;
