import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
const productionDemoModule = fileURLToPath(new URL('./src/productionDemoApi.ts', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '').trim();
  const demoMode = process.env.VITE_DEMO_MODE || env.VITE_DEMO_MODE || 'false';

  if (mode === 'production' && demoMode === 'true') {
    throw new Error('VITE_DEMO_MODE must not be enabled in a production build.');
  }

  if (mode === 'production' && apiBase.startsWith('/')) {
    if (apiBase.replace(/\/+$/, '') !== '/api') {
      throw new Error('A relative VITE_API_BASE_URL must be exactly /api for same-origin API routing.');
    }
  } else if (mode === 'production') {
    let parsed: URL;
    try {
      parsed = new URL(apiBase);
    } catch {
      throw new Error('Set VITE_API_BASE_URL to /api or to a deployed HTTPS API base URL ending in /api before building for production.');
    }

    const host = parsed.hostname.toLowerCase();
    const localHost = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]' || host === '0.0.0.0' || host === '[::]' || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (parsed.protocol !== 'https:' || localHost || parsed.pathname.replace(/\/+$/, '') !== '/api' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('VITE_API_BASE_URL must be a public HTTPS URL ending in /api, without credentials, query parameters, or fragments.');
    }
  }

  return {
    define: { 'import.meta.env.VITE_DEMO_MODE': JSON.stringify(demoMode) },
    resolve: { alias: mode === 'production' ? [{ find: './demoApi', replacement: productionDemoModule }] : [] },
    plugins: [react(), VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.jpg'],
      manifest: {
        name: 'Krushinath Sugar House',
        short_name: 'Sugar House',
        theme_color: '#14532d',
        background_color: '#f7faf7',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/logo.jpg', sizes: 'any', type: 'image/jpeg' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,jpg,svg}'] },
    })],
    server: { port: 5173 },
  };
});
