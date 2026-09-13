// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://www.lawnetz.de',
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
    }),
  ],

  build: {
    format: 'directory',
  },



  server: {
    port: 4321,
  },

});
