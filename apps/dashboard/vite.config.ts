import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // After `manualChunks` splits the four heavy vendor libs into
    // their own bundles, the main `index-*.js` chunk lands at
    // ~617 KB (~173 KB gzipped) — comfortably under Render's HTTP/2
    // budget for a SPA but still a hair over Vite's default 500 KB
    // warning. Bump the threshold so a clean build log reflects
    // the intentional bundle shape. Revisit if the main chunk grows
    // past ~800 KB, at which point dynamic-importing the LandingPage
    // is the next step.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own chunks so the main
        // `index-*.js` bundle stays lean. The LandingPage pulls in
        // framer-motion + gsap as marketing animation libs, and
        // phosphor-icons ships ~300 KB of SVG paths; bucketing them
        // separately lets the browser cache the rarely-changing
        // vendor bundles across deploys instead of re-downloading
        // them every time the app code changes.
        //
        // The `react` bucket groups React + React DOM + React Router
        // because they always load together and make a coherent
        // cache unit. `remotion` goes in its own bucket because the
        // `@remotion/player` surface on the asset preview pages is
        // gated by route and rarely invalidated.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion', 'gsap'],
          icons: ['@phosphor-icons/react'],
          remotion: ['@remotion/player'],
        },
      },
    },
  },
});
