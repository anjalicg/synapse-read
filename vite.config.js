import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
    plugins: [react()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                sidepanel: resolve(__dirname, 'sidepanel.html'),
                background: resolve(__dirname, 'src/background.js'),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === 'background'
                        ? 'background.js'
                        : 'assets/[name]-[hash].js';
                },
            },
        },
    },
});