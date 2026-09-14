import { defineConfig } from 'vite';

// base: './' keeps the built output runnable from any static path (NFR-1).
export default defineConfig({
    base: './'
});
