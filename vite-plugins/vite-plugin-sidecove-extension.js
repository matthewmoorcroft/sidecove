import { resolve } from 'path';
import fs from 'fs-extra';

// Extension source lives in src/; the HTML pages at its top level build to the root of dist/.
const srcDir = resolve(process.cwd(), 'src');

/**
 * Get shared input configuration for Sidecove
 */
function getExtensionInputs() {
  return {
    sidebar: resolve(srcDir, 'sidebar.html'),
    'tutorial-practice': resolve(srcDir, 'tutorial-practice.html'),
    options: resolve(srcDir, 'options.html'),
    onboarding: resolve(srcDir, 'onboarding.html'),
    'installation-onboarding': resolve(srcDir, 'installation-onboarding.html'),
    background: resolve(srcDir, 'background/background.js'),
    'sidebar-script': resolve(srcDir, 'sidebar/sidebar.js'),
    'options-script': resolve(srcDir, 'options/options.js'),
    'onboarding-script': resolve(srcDir, 'onboarding/onboarding.js'),
    'installation-onboarding-script': resolve(srcDir, 'onboarding/installation-onboarding.js'),
    offscreen: resolve(srcDir, 'offscreen.html'),
  };
}

/**
 * Get shared output configuration for Sidecove
 */
function getExtensionOutput(isDev = false) {
  return {
    entryFileNames: (chunkInfo) => {
      const mainScripts = ['background', 'sidebar-script', 'options-script', 'onboarding-script', 'installation-onboarding-script'];
      if (mainScripts.includes(chunkInfo.name)) {
        if (chunkInfo.name === 'sidebar-script') return 'sidebar.js';
        if (chunkInfo.name === 'options-script') return 'options.js';
        if (chunkInfo.name === 'onboarding-script') return 'onboarding.js';
        if (chunkInfo.name === 'installation-onboarding-script') return 'installation-onboarding.js';
        return `${chunkInfo.name}.js`;
      }
      return isDev ? '[name].js' : 'assets/[name]-[hash].js';
    },
    chunkFileNames: isDev ? '[name].js' : 'assets/[name]-[hash].js',
    assetFileNames: (assetInfo) => {
      if (assetInfo.name?.endsWith('.css')) {
        return '[name][extname]';
      }
      if (assetInfo.name?.endsWith('.html')) {
        return '[name][extname]';
      }
      return isDev ? '[name][extname]' : 'assets/[name]-[hash][extname]';
    }
  };
}

/**
 * Get Sidecove extension build plugins
 */
function getExtensionPlugins(isDev = false) {
  const outDir = isDev ? 'dist-dev' : 'dist';

  return [
    // Main extension build plugin
    {
      name: 'sidecove-extension-main',
      writeBundle: async () => {
        // Copy static files
        await fs.copy('manifest.json', `${outDir}/manifest.json`);

        if (await fs.pathExists('assets')) {
          await fs.copy('assets', `${outDir}/assets`);
        }

        if (await fs.pathExists('src/shared/styles.css')) {
          await fs.copy('src/shared/styles.css', `${outDir}/styles.css`);
        }

        if (await fs.pathExists('LICENSE')) {
          await fs.copy('LICENSE', `${outDir}/LICENSE`);
        }
        if (await fs.pathExists('README.md')) {
          await fs.copy('README.md', `${outDir}/README.md`);
        }
        if (await fs.pathExists('THIRD_PARTY_NOTICES.md')) {
          await fs.copy('THIRD_PARTY_NOTICES.md', `${outDir}/THIRD_PARTY_NOTICES.md`);
        }

        console.log(`✅ Main extension files built to ${outDir}/`);
        console.log(`🎉 Sidecove extension build complete!`);
      }
    }
  ];
}

/**
 * Create complete Vite configuration for Sidecove
 */
export function createSidecoveConfig(options = {}) {
  const { isDev = false } = options;
  const outDir = isDev ? 'dist-dev' : 'dist';

  const config = {
    root: srcDir,
    build: {
      outDir: resolve(process.cwd(), outDir),
      emptyOutDir: true,
      rollupOptions: {
        input: getExtensionInputs(),
        output: getExtensionOutput(isDev)
      },
      target: 'es2020',
      minify: !isDev,
      sourcemap: isDev
    },
    plugins: getExtensionPlugins(isDev),
    server: {
      port: 3000,
      open: false,
      ...(isDev && { hmr: false }) // Disable HMR for Chrome extension in dev mode
    },
    resolve: {
      alias: {
        '@': resolve(process.cwd(), './'),
      }
    }
  };

  // Add dev-specific options
  if (isDev) {
    config.mode = 'development';
    config.build.watch = {
      include: ['src/**/*.js', 'src/**/*.html', 'src/**/*.css', 'assets/**', 'manifest.json']
    };
  }

  return config;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createSidecoveConfig instead
 */
export function sidecoveExtensionPlugin(options = {}) {
  return getExtensionPlugins(options.isDev);
}
