import { defineConfig } from 'vite';
import { localApiPlugin } from './tools/local-api.ts';

export default defineConfig({
  plugins: [localApiPlugin()],
});
