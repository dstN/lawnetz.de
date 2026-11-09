// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

const site = 'https://lawnetz.de';

export default defineConfig({
  site,
  output: 'server',
  trailingSlash: 'never',

  security: {
    checkOrigin: false,
  },

  adapter: node({
    mode: 'standalone',
  }),

  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'de',
        locales: { de: 'de-DE' },
      },
      // Law and norm pages come from the DB: src/pages/sitemap-recht-[page].xml.ts, 50k URLs per chunk.
      // ponytail: fixed 3 chunks = 150k URLs (2026-11: ~131k); add a 4th when the count nears that.
      customSitemaps: [0, 1, 2].map((i) => `${site}/sitemap-recht-${i}.xml`),
    }),
  ],

  build: {
    format: 'directory',
  },



  server: {
    port: 4321,
  },

});
