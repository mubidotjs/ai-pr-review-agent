import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No Cloudflare plugin or remote bindings on the Node build path.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/node/client' },
});
