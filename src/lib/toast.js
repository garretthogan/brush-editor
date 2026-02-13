/**
 * toast — User feedback for actions and errors
 *
 * HCE: require-recovery-path, user-errors-actionable, cause-effect-proximity
 * Surfaces actionable feedback near the viewport.
 */

const TOAST_DURATION_MS = 4000
const TOAST_RECOVERY_DURATION_MS = 8000

/**
 * @typedef {'info' | 'success' | 'error' | 'undo'} ToastType
 */

/**
 * Show a toast message.
 * @param {string} message - User-facing message
 * @param {object} [options]
 * @param {ToastType} [options.type='info']
 * @param {string} [options.recoveryLabel] - Label for recovery action (e.g. "Undo", "Retry")
 * @param {() => void} [options.onRecovery] - Callback when recovery is clicked
 * @param {number} [options.durationMs] - How long to show (longer if recovery)
 */
export function showToast(message, options = {}) {
  const {
    type = 'info',
    recoveryLabel,
    onRecovery,
    durationMs = recoveryLabel ? TOAST_RECOVERY_DURATION_MS : TOAST_DURATION_MS,
  } = options

  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.setAttribute('role', 'status')
    container.setAttribute('aria-live', 'polite')
    document.body.appendChild(container)
  }

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.setAttribute('role', 'alert')

  const text = document.createElement('span')
  text.className = 'toast-message'
  text.textContent = message
  toast.appendChild(text)

  if (recoveryLabel && onRecovery) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'toast-recovery'
    btn.textContent = recoveryLabel
    btn.setAttribute('aria-label', `${recoveryLabel} – ${message}`)
    btn.addEventListener('click', () => {
      onRecovery()
      removeToast(toast)
    })
    toast.appendChild(btn)
  }

  container.appendChild(toast)

  const timer = setTimeout(() => removeToast(toast), durationMs)
  toast.dataset.clearTimer = String(timer)
}

function removeToast(toast) {
  const t = toast.dataset.clearTimer
  if (t) clearTimeout(Number(t))
  toast.classList.add('toast-exit')
  setTimeout(() => toast.remove(), 200)
}
