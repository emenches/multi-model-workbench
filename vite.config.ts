import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        claudeLoginTabs: fileURLToPath(new URL('./claude-login-tabs.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['refs/**', 'node_modules/**', 'dist/**'],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Keep the watcher out of cargo's build output (EBUSY on Windows) and vendored repos.
      ignored: ['**/src-tauri/**', '**/refs/**'],
    },
  },
});
