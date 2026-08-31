import { defineConfig } from 'vite';

export default defineConfig({
  /* Every URL in the build is relative, so `dist/` runs from wherever it is
     served: the root of a static host, or `/<repo>/` on GitHub Pages, with no
     rebuild in between. */
  base: './',

  server: {
    open: true,
  },

  build: {
    outDir: 'dist',
    /* Hashed bundles go to `dist/bundle/`, which leaves `dist/assets/` — the
       SVGs copied straight out of `public/` — as the Figma exports alone. */
    assetsDir: 'bundle',
  },
});
