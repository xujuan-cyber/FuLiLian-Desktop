import shared from '../../eslint.config.shared.mjs'
import globals from 'globals'

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
    files: ['src/**/*.{ts,tsx}'],
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
  }
]
