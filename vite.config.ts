import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Serve `/scenes/` -> `/scenes/index.html` in dev & preview so it matches Cloudflare Workers Static Assets. */
function scenesDirectoryIndexPlugin(): Plugin {
  const rewrite = (
    req: { url?: string },
    _res: unknown,
    next: () => void
  ) => {
    if (req.url && /^\/scenes\/?(?:\?|$)/.test(req.url)) {
      const qIdx = req.url.indexOf('?');
      const qs = qIdx >= 0 ? req.url.slice(qIdx) : '';
      req.url = `/scenes/index.html${qs}`;
    }
    next();
  };
  return {
    name: 'scenes-directory-index',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), scenesDirectoryIndexPlugin()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
});
