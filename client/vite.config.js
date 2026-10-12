import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_API_PROXY || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiProxyTarget
    }
  }
});
