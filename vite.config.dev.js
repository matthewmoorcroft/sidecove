import { defineConfig } from 'vite';
import { createSidecoveConfig } from './vite-plugins/vite-plugin-sidecove-extension.js';

export default defineConfig(createSidecoveConfig({ isDev: true })); 