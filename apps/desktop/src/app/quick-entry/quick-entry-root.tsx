import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { QuickCaptureApp } from '@/app/quick-capture/quick-capture-app'
import { ErrorBoundary } from '@/components/error-boundary'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'

/**
 * Boot the Quick Capture window (step 16 · T7: the former Quick Entry window,
 * same shell and global chord, capture surface instead of a fire-and-forget
 * composer). Loaded by the same bundle as the main app but via `?win=quick`,
 * so it shares CSS/theme tokens while mounting a minimal capture surface (no
 * app shell, no gateway, no router).
 *
 * The index.html boot script paints an OPAQUE themed background to avoid a
 * flash in normal windows; this window is a floating card on a transparent
 * backdrop, so force the host layers see-through (same trick as the pet
 * overlay). The I18nProvider resolves the machine's display language the same
 * way Settings does and falls back to English when the config source is
 * unreachable — the capture window must never block on it.
 */
export function mountQuickEntry(): void {
  const style = document.createElement('style')
  style.textContent = 'html,body,#root{background:transparent !important;}'
  document.head.appendChild(style)

  const root = document.getElementById('root')

  if (!root) {
    return
  }

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary label="quick-capture">
        <I18nProvider>
          <ThemeProvider>
            <QuickCaptureApp />
          </ThemeProvider>
        </I18nProvider>
      </ErrorBoundary>
    </StrictMode>
  )
}
