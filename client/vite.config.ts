import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, resolve(root, '..'), '');
  return {
    root,
    plugins: [react()],
    server: { host: 'localhost', port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? 4000}` } },
    build: { outDir: resolve(root, '../dist/client'), emptyOutDir: true }
  };
});
