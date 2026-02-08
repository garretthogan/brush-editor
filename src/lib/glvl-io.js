/**
 * glvl-io — Encrypted .glvl level file save/load
 *
 * Standalone module with no dependencies. Uses Web Crypto API (AES-GCM).
 * Works with any JSON-serializable data.
 *
 * Usage:
 *   import { saveGlvl, loadGlvl } from './lib/glvl-io.js'
 *
 *   // Save
 *   await saveGlvl(levelData, { filename: 'level.glvl' })
 *
 *   // Load (opens file picker, returns Promise<data | null>)
 *   const data = await loadGlvl({ accept: '.glvl' })
 *   if (data) applyLoadedData(data)
 */

const DEFAULT_KEY = new Uint8Array([
  0x67, 0x6c, 0x76, 0x6c, 0x2d, 0x65, 0x64, 0x69,
  0x74, 0x6f, 0x72, 0x2d, 0x6b, 0x65, 0x79, 0x21,
  0x31, 0x39, 0x37, 0x34, 0x32, 0x30, 0x31, 0x37,
  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
])

let _cryptoKey = null

async function getKey(keyBytes = DEFAULT_KEY) {
  if (_cryptoKey) return _cryptoKey
  _cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
  return _cryptoKey
}

/**
 * Save data to an encrypted .glvl file (triggers download).
 * @param {object} data - Any JSON-serializable object
 * @param {object} [options]
 * @param {string} [options.filename='level.glvl']
 * @param {Uint8Array} [options.key] - 32-byte key (uses default if omitted)
 */
export async function saveGlvl(data, options = {}) {
  const { filename = 'level.glvl', key: keyBytes } = options
  const json = JSON.stringify(data)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await getKey(keyBytes)
  const encoded = new TextEncoder().encode(json)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )
  const blob = new Blob([iv, ciphertext], { type: 'application/octet-stream' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Load data from an encrypted .glvl file given a File object.
 * @param {File} file - The .glvl file to decrypt
 * @param {object} [options]
 * @param {Uint8Array} [options.key] - 32-byte key (uses default if omitted)
 * @returns {Promise<object|null>} Parsed data, or null if failed
 */
export async function loadGlvlFromFile(file, options = {}) {
  const { key: keyBytes } = options
  try {
    const buffer = await file.arrayBuffer()
    const iv = buffer.slice(0, 12)
    const ciphertext = buffer.slice(12)
    const key = await getKey(keyBytes)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )
    const json = new TextDecoder().decode(decrypted)
    return JSON.parse(json)
  } catch (err) {
    console.error('Failed to load .glvl file:', err)
    return null
  }
}

/**
 * Load data from an encrypted .glvl file (opens file picker).
 * @param {object} [options]
 * @param {string} [options.accept='.glvl']
 * @param {Uint8Array} [options.key] - 32-byte key (uses default if omitted)
 * @returns {Promise<object|null>} Parsed data, or null if cancelled/failed
 */
export function loadGlvl(options = {}) {
  const { accept = '.glvl', key: keyBytes } = options

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      document.body.removeChild(input)
      if (!file) {
        resolve(null)
        return
      }

      try {
        const data = await loadGlvlFromFile(file, { key: keyBytes })
        resolve(data)
      } catch (err) {
        console.error('Failed to load .glvl file:', err)
        resolve(null)
      }
    })

    document.body.appendChild(input)
    input.click()
  })
}
