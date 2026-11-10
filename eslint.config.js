import path from 'node:path';
import js from '@eslint/js';
import globals from 'globals';

// Folder boundaries (see AGENTS.md): a context may import its own folder and src/shared/,
// shared/ imports no context, and contexts never import each other. The rule resolves each
// relative import (static, re-export or dynamic) to the src/ folder it lands in, so a feature
// subfolder that happens to share a context's name is not mistaken for that context.
const contexts = ['background', 'sidebar', 'options', 'onboarding', 'offscreen', 'content'];
const srcDir = path.resolve(import.meta.dirname, 'src');
const contextOf = file => {
    const [top] = path.relative(srcDir, file).split(path.sep);
    return contexts.includes(top) || top === 'shared' ? top : null;
};
const boundaries = {
    rules: {
        'import-boundaries': {
            meta: { type: 'problem', schema: [] },
            create(context) {
                const from = contextOf(context.filename);
                if (!from) return {};
                const check = node => {
                    const spec = node.source?.type === 'Literal' ? node.source.value : null;
                    if (typeof spec !== 'string' || !spec.startsWith('.')) return;
                    const to = contextOf(path.resolve(path.dirname(context.filename), spec));
                    if (!to || to === from || to === 'shared') return;
                    context.report({
                        node,
                        message: `src/${from}/ may not import src/${to}/: contexts import only their own folder and src/shared/ (see AGENTS.md).`
                    });
                };
                return {
                    ImportDeclaration: check,
                    ExportNamedDeclaration: check,
                    ExportAllDeclaration: check,
                    ImportExpression: check
                };
            }
        }
    }
};

// Older code that already had warnings when linting was added. New files get these as errors.
const legacy = [
    'src/background/auto-archive.js',
    'src/background/background.js',
    'src/shared/bookmark-utils.js',
    'src/shared/utils.js',
    'src/sidebar/dom-manager.js',
    'src/sidebar/sidebar.js',
    'src/sidebar/space-icons.js',
    'tests/e2e/**/*.test.js'
];

export default [
    {
        // ESLint does not read .gitignore; these are the ignored folders that can hold JavaScript.
        ignores: ['dist/', 'dist-dev/', 'node_modules/', 'coverage/', '.claude/', '.config/', '.vite/', 'test-results/']
    },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: { sidecove: boundaries },
        rules: { 'sidecove/import-boundaries': 'error' }
    },
    {
        files: legacy,
        rules: { 'no-unused-vars': 'warn', 'no-useless-assignment': 'warn', 'no-control-regex': 'warn' }
    },
    {
        // Pages: the side panel, settings, onboarding and offscreen documents have a DOM.
        files: ['src/sidebar/**/*.js', 'src/options/**/*.js', 'src/onboarding/**/*.js', 'src/offscreen/**/*.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.webextensions } }
    },
    {
        // The service worker has no DOM.
        files: ['src/background/**/*.js'],
        languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } }
    },
    {
        // Shared code runs in the service worker too. It may reach for the DOM inside functions
        // that only pages call, but never at import time (see AGENTS.md).
        files: ['src/shared/**/*.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions } }
    },
    {
        files: ['*.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        // Browser tests: Jest globals, and page callbacks that run inside the extension.
        files: ['tests/e2e/**/*.js', 'tests/manual/**/*.js'],
        languageOptions: { globals: { ...globals.jest, ...globals.browser, ...globals.webextensions } }
    },
    {
        files: ['tests/unit/**/*.js'],
        languageOptions: { globals: { ...globals.webextensions } }
    }
];
