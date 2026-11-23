import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '').trim();

  if (mode === 'production') {
    let parsed: URL;
    try {
      parsed = new URL(apiBase);
    } catch {
      throw new Error('Set VITE_API_BASE_URL to the deployed HTTPS API base URL ending in /api before building for production.');
    }

    const host = parsed.hostname.toLowerCase();
    const localHost = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]' || host === '0.0.0.0' || host === '[::]' || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (parsed.protocol !== 'https:' || localHost || parsed.pathname.replace(/\/+$/, '') !== '/api' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error('VITE_API_BASE_URL must be a public HTTPS URL ending in /api, without credentials, query parameters, or fragments.');
    }
  }

  return {
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
