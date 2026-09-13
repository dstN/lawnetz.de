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
