import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В разработке запросы /api проксируются на сервер (spec/tech/architecture.md, раздел 1).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
