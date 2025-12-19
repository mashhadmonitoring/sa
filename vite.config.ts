
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for assets to work on GitHub Pages subfolders
  define: {
    // This allows process.env.API_KEY to be available in the browser after build.
    // Ensure the API_KEY environment variable is set during the build process (e.g. in GitHub Actions secrets).
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
