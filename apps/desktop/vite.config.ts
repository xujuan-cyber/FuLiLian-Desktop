import { defineConfig, type Plugin } from 'vite'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'

/** React Compiler preset scoped to modules that can actually contain
 *  components/hooks (JSX syntax or a react-ish import). The preset's default
 *  code filter matches any PascalCase/use* declaration — effectively every TS
 *  module — which made the babel pass parse all ~1.5k source files when only
 *  ~750 are React-bearing. */
function compilerPreset() {
  const preset = reactCompilerPreset()
  preset.rolldown.filter.code = /\/>|<\/|from\s*['"][^'"]*react/
  return preset
}
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'

// `hgui` symlinks a worktree's node_modules to the main checkout. Vite realpaths
// those before enforcing server.fs.allow, so codicon/font assets resolve outside
// the worktree root and 404. Whitelist the real node_modules locations.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const fsAllow = [
  ...new Set(
    [
      path.resolve(__dirname, '../..'),
      real(path.resolve(__dirname, 'node_modules')),
      real(path.resolve(__dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

// React refuses to run when `react` and `react-dom` come from two different
// installed copies ("Minified React error #527" — a blank window, since it
// throws before the first paint). Both packages are pinned to one version in
// this workspace's package.json, but npm hoists whatever *it* considers
// compatible to the monorepo root: a root dependency whose react peer is a
// loose range (e.g. `^18 || ^19`) pulls the newest react up there, while
// react-dom stays at the pinned one. `^19.2.7` accepts `19.2.8`, so npm never
// warns. Resolving from this workspace instead of a hardcoded root path yields
// the versions declared here — npm nests a copy under the workspace exactly
// when the hoisted one differs, so the pair can only ever match.
const requireFromApp = createRequire(path.join(__dirname, 'vite.config.ts'))
const reactDir = path.dirname(requireFromApp.resolve('react/package.json'))
const reactDomDir = path.dirname(requireFromApp.resolve('react-dom/package.json'))

// The dev-only render/state churn counters (src/debug) must be imported
// STATICALLY above react-dom — react-dom captures the devtools hook at module
// init, so a dynamic import lands too late and observes zero commits. A static
// side-effect import can't be tree-shaken, so instead the whole graph is
// aliased out of any non-dev build. `command === 'serve'` covers `vite dev`;
// the perf harness opts a production build back in with VITE_PERF_PROBE=1.
const debugEntry = (command: string, env: Record<string, string>) =>
  command === 'serve' || env.VITE_PERF_PROBE === '1'
    ? path.resolve(__dirname, './src/debug/dev-only.ts')
    : path.resolve(__dirname, './src/debug/dev-only.noop.ts')

// T-F3 (frontend iteration): the E2E store diagnostics bridge follows the
// same swap-out discipline as dev-only. Store files import it statically and
// can't be trusted to tree-shake, so any build that did not opt in with
// FULILIAN_DESKTOP_E2E_STORE_BRIDGE=1 gets the noop module instead — the
// real bridge (`src/app/diagnostics/store-bridge.ts`) never enters the
// module graph. The `define` below additionally bakes the switch as a
// compile-time boolean so the guarded registration calls (and their
// snapshot closures) dead-code-eliminate from the shipped entry.
const bridgeEntry = (env: Record<string, string>) =>
  env.FULILIAN_DESKTOP_E2E_STORE_BRIDGE === '1'
    ? path.resolve(__dirname, './src/app/diagnostics/store-bridge.ts')
    : path.resolve(__dirname, './src/app/diagnostics/store-bridge.noop.ts')

// The emoji picker (frimousse) fetches `<emojibaseUrl>/<locale>/data.json` at
// runtime. Its default is a CDN; Electron must work offline, so serve the
// bundled emojibase-data package at a stable local path instead — middleware
// in dev, emitted assets in the build. Only the files a locale actually needs.
const emojibaseDir =
  real(path.resolve(__dirname, 'node_modules/emojibase-data')) ??
  real(path.resolve(__dirname, '../../node_modules/emojibase-data'))

const EMOJIBASE_PATH = /^[a-z-]+\/(data|messages|shortcodes\/emojibase)\.json$/

const emojibaseAssets = () => ({
  name: 'fulilian:emojibase-assets',
  configureServer(server: {
    middlewares: { use: (route: string, handler: (req: any, res: any, next: () => void) => void) => void }
  }) {
    server.middlewares.use('/emojibase', (req, res, next) => {
      const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
      if (!emojibaseDir || !EMOJIBASE_PATH.test(rel)) return next()
      fs.readFile(path.join(emojibaseDir, rel), (err: unknown, buf: Buffer) => {
        if (err) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.end(buf)
      })
    })
  },
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
    if (!emojibaseDir) return
    for (const rel of ['en/data.json', 'en/messages.json', 'en/shortcodes/emojibase.json']) {
      this.emitFile({
        type: 'asset',
        fileName: `emojibase/${rel}`,
        source: fs.readFileSync(path.join(emojibaseDir, rel))
      })
    }
  }
})

// P9 (step 17): the shell's text face arrives ~1 MB after the bundle because
// nothing hints it. `@font-face` lives in the bundled CSS, which the browser
// only parses once the entry module graph is executing, so with
// `font-display: swap` every cold start paints fallback metrics and then
// reflows. One `<link rel="preload">` for the face the FIRST FRAME actually
// uses — body sans at weight 400 — starts that fetch alongside the script.
// Only that one: the bold face and the two mono faces are not on the
// first-paint path, and preloading all four (~4 MB) would merely contend with
// the entry script for bandwidth. The link is appended to the END of <head>,
// so it cannot reorder the P13 `boot:html-parse` inline script at the top.
const FIRST_FRAME_FONTS = [/FulilianSans-Regular[^/]*\.woff2$/]

const fontPreload = (): Plugin => ({
  name: 'fulilian:font-preload',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const bundle = ctx.bundle

      if (!bundle) {
        return html
      }

      return FIRST_FRAME_FONTS.flatMap(pattern => {
        const asset = Object.values(bundle).find(entry => entry.type === 'asset' && pattern.test(entry.fileName))

        return asset
          ? [
              {
                tag: 'link',
                attrs: {
                  rel: 'preload',
                  as: 'font',
                  type: 'font/woff2',
                  href: `./${asset.fileName}`,
                  crossorigin: ''
                },
                injectTo: 'head' as const
              }
            ]
          : []
      })
    }
  }
})

// P5 (step 17): single-source the first-launch pre-paint colors. The two
// fallback hexes and the theme-color meta in index.html used to be hand-written
// copies of what chromeBackground() paints at runtime — they drifted silently
// and made the very first launch flash the previous skin. The plugin below
// imports the SAME pure module context.tsx paints with (themes/chrome-
// background.ts ← themes/presets.ts, whose DEFAULT_SKIN_NAME is the only
// hand-edited source left) and replaces the `__FULILIAN_PREPAINT_*__` tokens in
// index.html with the generated candidates. Tokens left unreplaced are invalid
// CSS colors, so a file served without this transform falls back to the UA
// default instead of a stale skin. Runs in dev and build alike.
import { DEFAULT_PREPAINT_BACKGROUND } from './src/themes/chrome-background'

const prepaintColors = (): Plugin => ({
  name: 'fulilian:prepaint-colors',
  transformIndexHtml(html: string) {
    const { light, dark } = DEFAULT_PREPAINT_BACKGROUND

    // split/join (not String.replace) so both occurrences of the dark token —
    // the meta and the inline script — are replaced, and so a `$`-bearing
    // replacement could never be read as a replace pattern.
    return html
      .split('__FULILIAN_PREPAINT_DARK__')
      .join(dark)
      .split('__FULILIAN_PREPAINT_LIGHT__')
      .join(light)
  }
})

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __FULILIAN_E2E_STORE_BRIDGE__: JSON.stringify(process.env.FULILIAN_DESKTOP_E2E_STORE_BRIDGE === '1')
  },
  plugins: [react(), babel({ presets: [compilerPreset()] }), tailwindcss(), emojibaseAssets(), fontPreload(), prepaintColors()],
  css: {
    // Pin an explicit (empty) PostCSS config. Tailwind is handled entirely by
    // `@tailwindcss/vite`, so the renderer needs no PostCSS plugins — and
    // without this, Vite's `postcss-load-config` walks UP the filesystem
    // looking for a stray `postcss.config.*` / `tailwind.config.*`. The desktop
    // build runs from inside the user's home tree (e.g.
    // `C:\Users\<name>\AppData\Local\fulilian\fulilian-agent\apps\desktop`), so an
    // unrelated Tailwind v3 config higher up the tree gets picked up and
    // reprocesses our v4 stylesheet, failing the build with
    // "`@layer base` is used but no matching `@tailwind base` directive is
    // present." Pinning the config makes the build hermetic.
    postcss: { plugins: [] }
  },
  build: {
    // The renderer intentionally ships FEW chunks (not one, not thousands):
    //   · `codeSplitting: false` (the old setup) inlines every `lazy()` /
    //     dynamic import into the entry, so heavyweight lazy-only deps
    //     (mermaid, shiki grammars, katex) are parsed + evaluated on every
    //     cold start even though nothing rendered them. By the time the
    //     bundle hit ~28 MB that eval was ~1s of launch on an M-series.
    //   · Default splitting emits a chunk per shiki grammar/theme — thousands
    //     of files, which electron-builder OOMs scanning (#38888).
    // `codeSplitting` (the current name for the old `advancedChunks` option —
    // rolldown renamed it, warning on the former) is the middle ground:
    // heavyweight libraries merge into a handful of named vendor chunks loaded
    // on first use, app-level dynamic imports stay lazy, and the file count
    // stays in the tens.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Shared foundations FIRST (first match wins): an unmatched
            // module shared by the entry and a heavy chunk gets merged INTO
            // the heavy chunk, and the entry then statically imports 19 MB of
            // shiki just to reach react/hast utils — putting the heavy chunk
            // right back on the boot path.
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            {
              name: 'vendor-md',
              test: /node_modules[\\/](property-information|hast-util-[^\\/]+|mdast-util-[^\\/]+|micromark[^\\/]*|unist-util-[^\\/]+|vfile[^\\/]*|unified|stringify-entities|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|devlop|style-to-js|style-to-object)[\\/]/
            },
            // G1 (first-frame diet): the two vendor-util members that the boot
            // graph genuinely needs get their OWN groups, so the rest of that
            // bucket stops riding into `modulepreload` with them.
            //
            // Measured before this split: `vendor-util` was 133,258 B on the
            // preload list, reached by 8 first-frame chunks, yet the boot graph
            // only imports two members —
            //   · `clsx`      via src/lib/utils.ts (`cn()`), used by every
            //                 primitive, so it must stay on the boot path;
            //   · `dompurify` via src/lib/local-preview.ts (+ preview-artifact /
            //                 svg-embed), the only sanitizer on the boot path.
            // Everything else in that bucket (lodash-es, es-toolkit, uuid,
            // dayjs, d3-*, stylis) is lazy-only; it was pulled in purely by
            // group membership. Splitting it out is a pure grouping change —
            // no module moves between eager and lazy.
            { name: 'vendor-micro', test: /node_modules[\\/](clsx|tailwind-merge)[\\/]/ },
            { name: 'vendor-dompurify', test: /node_modules[\\/]dompurify[\\/]/ },
            // Lazy-only utility libraries: same group as before, minus the two
            // members above. No `$initial` tag, so this chunk only ships with
            // the lazy views that import it.
            {
              name: 'vendor-util',
              test: /node_modules[\\/](lodash-es|es-toolkit|uuid|dayjs|d3-array|d3-color|d3-force|d3-interpolate|d3-time[^\\/]*|stylis)[\\/]/
            },
            // One chunk per heavyweight, lazy-only library family.
            // @streamdown/code lives WITH shiki because it statically imports
            // the full shiki bundle.
            {
              name: 'mermaid',
              test: /node_modules[\\/](mermaid|cytoscape|dagre|khroma|elkjs|d3|d3-[^\\/]+|@mermaid-js)[\\/]/
            },
            {
              name: 'shiki',
              test: /node_modules[\\/](shiki|@shikijs|react-shiki|@streamdown[\\/]code|oniguruma-to-es|oniguruma-parser|regex(-[^\\/]+)?)[\\/]/
            },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ },
            // P10 (fluency): katex-memo is a small app lib shared by two LAZY
            // chunks (markdown-text, preview-file). Left to the automatic
            // splitter it merged into the shared small-module chunk that also
            // carries contrib/react/boundary ($initial) — and the chunk's
            // whole import closure (katex, ~250 KB) went onto the boot preload
            // list. Pin it to its own group so it loads only with its lazy
            // consumers.
            { name: 'katex-memo', test: /katex-memo/ },
            // G1 (second lever) — EVALUATED AND REJECTED, kept as a note so
            // nobody re-runs the experiment blind.
            //
            // The idea was to collapse the 88 sub-5 KB app chunks into one
            // `app-shell` group to cut file round-trips on the `file://` path:
            //
            //   { name: 'app-shell', test: /[\\/]apps[\\/]desktop[\\/]src[\\/]/,
            //     tags: ['$initial'], maxModuleSize: 8192 }
            //
            // Measured (HEAD 318a6bb + vendor split): preload links 126 → 5,
            // but the entry chunk emptied out (2,005,467 → 702 B) and its whole
            // first-frame graph reappeared as ONE 3.44 MB `app-shell` chunk.
            // `maxModuleSize` does NOT bound the group's total size — lowering
            // it to 1024 still produced 3.43 MB. So the option does not merge
            // "the small chunks"; it renames the entry and forfeits parallel
            // parse. Net: byte total flat (−51 KB), single-blob regression.
            // Rejected on structure, not on bytes.
            // P9 (step 17): collapse the swarm of tiny shared chunks the
            // automatic splitter emits — one per tabler icon, one per radix
            // primitive — into a single `vendor-shared` chunk. Only modules
            // the FIRST-FRAME graph already pulls are eligible (the `$initial`
            // tag), and only small ones (`maxModuleSize`): heavyweight vendor
            // stays where it is, so this shrinks the entry's declared
            // `modulepreload` list (~100 links for a few hundred KB of
            // modules) without moving bulk onto — or off — the boot path.
            {
              name: 'vendor-shared',
              test: /node_modules[\\/]/,
              tags: ['$initial'],
              maxModuleSize: 24576
            }
          ]
        }
      }
    }
  },
  // driver.js only enters the graph through the tour's DYNAMIC import chain
  // (lib/tour/run-tour.ts), so the dep scanner never sees it at startup. Left
  // alone, first use registers it as a missing dep at runtime — which (a)
  // esbuild-prebundles the `?raw` IIFE import as a JS module, breaking the
  // raw-text transform ("does not provide an export named 'default'"), and
  // (b) triggers Vite's "new dependencies optimized" full page reload mid-
  // session. It's pure ESM with no CJS deps, so serving it unoptimized is
  // free. Query and bare forms all listed — exclusion matches exact ids.
  optimizeDeps: {
    exclude: [
      'driver.js',
      'driver.js/dist/driver.js.iife.js',
      'driver.js/dist/driver.js.iife.js?raw',
      'driver.js/dist/driver.css?raw'
    ]
  },
  resolve: {
    alias: {
      // Must sit ABOVE the bare `@` key: object aliases match in order and
      // `@` would otherwise swallow the more specific id first.
      '@/app/diagnostics/store-bridge': bridgeEntry(process.env as Record<string, string>),
      '@/debug/dev-only': debugEntry(command, process.env as Record<string, string>),
      '@': path.resolve(__dirname, './src'),
      '@fulilian/plugin-sdk': path.resolve(__dirname, './src/sdk/index.ts'),
      '@fulilian/shared/billing': path.resolve(__dirname, '../shared/src/billing-types.ts'),
      '@fulilian/shared': path.resolve(__dirname, '../shared/src'),
      // The tour tool's preview surface injects driver.js's prebuilt IIFE into
      // the pane's guest page as raw source; the package's exports map doesn't
      // expose that dist file (nor ./package.json), so resolve the main entry
      // (dist/driver.js.cjs) and point at its sibling. Both keys on purpose:
      // alias matching is exact, and the id reaches it with the `?raw` query
      // still attached in dev but stripped in some build paths.
      'driver.js/dist/driver.js.iife.js?raw': `${path.join(
        path.dirname(requireFromApp.resolve('driver.js')),
        'driver.js.iife.js'
      )}?raw`,
      'driver.js/dist/driver.js.iife.js': path.join(
        path.dirname(requireFromApp.resolve('driver.js')),
        'driver.js.iife.js'
      ),
      react: reactDir,
      'react-dom': reactDomDir,
      'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
      'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom', 'react-router']
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      allow: fsAllow
    },
    // N-5 (dev renderer): in dev every module is transformed on demand, so the
    // first open of a lazy page (Settings above all) triggers a cascade of
    // hundreds of per-module transforms while the user stares at the skeleton
    // — the production build prefetches page chunks instead (see
    // src/app/prefetch-page-chunks.ts), but dev had no equivalent. `warmup`
    // runs the same transform pass in the background right after server start,
    // so by the time the user reaches for Settings the graph is hot. Scoped to
    // the page-level dirs whose FIRST navigation is user-visible; their shared
    // imports (components/ui, lib, store) overlap the boot graph, which the
    // chat surface transforms anyway, so the residual cold cost after this is
    // small. Files are transformed, nothing is evaluated — no side effects.
    warmup: {
      clientFiles: [
        './src/app/settings/**',
        './src/app/overlays/**',
        './src/app/skills/**',
        './src/app/right-sidebar/**'
      ]
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
}))
