import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.VITE_DEV_PORT || 5173),
      strictPort: true,
      proxy: {
        // Same-origin /api calls in dev, so there's no CORS friction and no hard-coded backend URL in code.
        '/api': { target: env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:5000', changeOrigin: true },
      },
    },
  };
});
