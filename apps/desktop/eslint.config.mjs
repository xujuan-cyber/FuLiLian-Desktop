import shared from '../../eslint.config.shared.mjs'
import globals from 'globals'

// ── step 17 · P12 — bare-z-index fence ──────────────────────────────────────
// DESIGN.md: an app-wide surface picks a rung (a styles.css `--z-*` consumed as
// `z-(--z-…)`), never an ad-hoc literal. This fence blocks NEW surface-level
// literals (`z-50`, `z-[70]`, `zIndex: 9999`) while grandfathering the local
// stacking that §2.2(c) of the P12 brief keeps on plain `z-10`/`z-20`.
//
// WHY A DISTINCT RULE NAME, NOT `no-restricted-syntax`: an ESLint v9 flat config
// block REPLACES a same-named rule from an earlier block over the same file — it
// does NOT merge selector arrays. A second `no-restricted-syntax` block over
// `src/**` would silently disable the ref-mirror fence defined above (the
// override trap MEMORY §7 records, which the icon fence works around with
// `ignores`). A unique rule name cannot collide, so both fences coexist.
const SURFACE_Z_CLASS = /\bz-(?:4[5-9]|[5-9]\d|\d{3,})\b/ // z-45…z-99, z-100+
const ARBITRARY_Z_CLASS = /z-\[\d+\]/
const BARE_Z_INDEX_MESSAGE =
  'App-wide surfaces use a z-index rung (`z-(--z-…)` from styles.css), not a bare literal. Local stacking inside a component stays on plain z-10/z-20.'

const bareZIndexPlugin = {
  rules: {
    'no-bare-z-index': {
      create(context) {
        const report = node => context.report({ message: BARE_Z_INDEX_MESSAGE, node })

        const checkClassString = (node, value) => {
          if (typeof value === 'string' && (SURFACE_Z_CLASS.test(value) || ARBITRARY_Z_CLASS.test(value))) {
            report(node)
          }
        }

        return {
          Literal(node) {
            checkClassString(node, node.value)
          },
          Property(node) {
            const key = node.key
            if (!key || (key.name !== 'zIndex' && key.value !== 'zIndex')) {
              return
            }
            const value = node.value
            if (!value || value.type !== 'Literal') {
              return
            }
            let numeric = null
            if (typeof value.value === 'number') {
              numeric = value.value
            } else if (typeof value.value === 'string' && /^\d+$/.test(value.value)) {
              numeric = Number(value.value)
            }
            if (numeric !== null && numeric >= 10) {
              report(value)
            }
          },
          TemplateElement(node) {
            checkClassString(node, node.value && node.value.raw)
          }
        }
      },
      meta: { schema: [], type: 'problem' }
    }
  }
}

export default [
  ...shared,
  {
    // Desktop is an Electron renderer — it legitimately uses browser globals
    // (window, document, etc). Re-add them here; the shared config omits
    // globals.browser so terminal-only workspaces (ui-tui) don't get them.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    // THE PLUGIN FENCE: plugins speak @fulilian/plugin-sdk (+ react), never `@/…`
    // internals — the same isolation a runtime-fetched published plugin gets,
    // enforced on bundled ones so the SDK surface stays honest and sufficient.
    files: ['src/plugins/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '../*', '@fulilian/shared'],
              message: 'Plugins import only @fulilian/plugin-sdk (and react). Missing something? Add it to the SDK.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.test.tsx'],
    rules: {
      'no-restricted-globals': ['warn', 'document']
    }
  },
  {
    // Ban mirroring reactive values into refs via useEffect — the "atom-mirrored
    // ref" antipattern. A ref synced from a nanostores atom via useEffect lags the
    // atom by one render, which creates stale-read bugs in callbacks that read the
    // ref (cancelRun sent session.interrupt to the wrong session; steerPrompt,
    // restoreToMessage, editMessage all had closure-priority stale reads). The fix
    // is to read $atom.get() directly in callbacks instead. This rule catches the
    // mirroring effect at lint time so the pattern can't reappear. Legitimate
    // non-atom ref writes inside useEffect (DOM instance refs, mount flags, request
    // tokens, prop mirrors) get an eslint-disable-next-line with a comment.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // useEffect(() => { someRef.current = value }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="AssignmentExpression"][body.left.type="MemberExpression"][body.left.property.name="current"]',
          message:
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // useEffect(() => { someRef.current = value; ... }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(AssignmentExpression[left.type="MemberExpression"][left.property.name="current"])',
          message:
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // useEffect(() => { setMutableRef(ref, value) }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(CallExpression[callee.name="setMutableRef"])',
          message:
            'Do not mirror reactive values into refs via useEffect (setMutableRef included). Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // {contribution.render()} anywhere inside JSX — calling a render
          // callback inline makes its hooks belong to the HOST component, so
          // loading/replacing a plugin changes the host's hook count → React
          // #310 (#80560, crashed every Windows user with a desktop plugin).
          // Mount it as a child instead: <ContribRender render={c.render} />.
          selector: 'JSXExpressionContainer CallExpression[callee.property.name="render"]',
          message:
            'Do not call render() callbacks inline in JSX — the callback\u2019s hooks become the host\u2019s and plugin load/replace changes the host hook count (React #310). Mount it as a component: <ContribRender render={...} /> from @/contrib/react/boundary.'
        }
      ]
    }
  },
  {
    // Icon single-source fence (step 16 · T17, 清单 B3): business icons come from
    // @/lib/icons (Tabler). Third-party icon sets may not be newly imported —
    // 渐进收敛，存量用到哪换到哪，不专项清零 (see overrides below).
    // ⚠ 必须 ignores src/plugins/**：本块与上方 plugin-fence 块同名规则
    // no-restricted-imports，扁平配置下后者覆盖前者，若本块命中插件文件会把
    // plugins fence（禁 @/* / ../* / @fulilian/shared）静默关闭。插件走 plugin-sdk，
    // 不适用业务图标规则，故排除之。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/plugins/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@vscode/codicons',
              message: '业务图标走 @/lib/icons（Tabler 出口）。titlebar Codicon 用 class 名，不 import 此包。'
            },
            {
              name: '@icons-pack/react-simple-icons',
              message: '业务图标走 @/lib/icons（Tabler 出口）；品牌 logo 场景需先申报豁免（见 eslint overrides 存量清单）。'
            },
            {
              name: '@nous-research/ui',
              message: '自研 ui/ 已覆盖；不新建引用（清单 B3 渐进收敛）。'
            }
          ]
        }
      ]
    }
  },
  {
    // 存量豁免 (step 16 · T17, 清单 B3): 唯一 JS/TS 存量 = @icons-pack/react-simple-icons
    // 的 3 个品牌 logo 文件（品牌 logo 无 Tabler 等价物，不进本轮渐进范围）。
    // 迁移到哪一天清哪个文件，就从本清单删一行。
    // @vscode/codicons 与 @nous-research/ui 的存量只在 src/styles.css 的 CSS @import/url()
    // （ESLint 不解析 CSS）⇒ 组件层零存量，无需豁免。
    files: [
      'src/app/messaging/platform-icon.tsx',
      'src/lib/brand-icon.ts',
      'src/lib/mcp-brands.tsx'
    ],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    // step 17 · P12 — bare-z-index fence (see the note above the plugin).
    // Excludes the §2.2(c) local-stacking files (existing bare z-50 / zIndex:60
    // that stay plain by the DESIGN.md policy) and the §2.2(d) injected-string
    // files (values live in non-app documents where rung tokens are unreachable).
    // Everything else under src must express a surface via `z-(--z-…)`.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      // §2.2(c) — local stacking, grandfathered.
      'src/app/chat/chat-swap-overlay.tsx',
      'src/app/chat/composer/completion-drawer.tsx',
      'src/app/right-sidebar/terminal/instance.tsx',
      'src/components/assistant-ui/thread/timeline.tsx',
      'src/components/pane-shell/tree/renderer/edit-bar.tsx',
      'src/components/pane-shell/tree/renderer/tree-group.tsx',
      'src/components/pet/floating-pet.tsx',
      // §2.2(d) — injected into non-app documents (CSS strings); unreachable.
      'src/lib/drag-ghost.ts',
      'src/lib/preview-act/watch-in-page.ts',
      'src/lib/tour/spotlight-blur.ts'
    ],
    plugins: { fulilian: bareZIndexPlugin },
    rules: { 'fulilian/no-bare-z-index': 'error' }
  }
]
