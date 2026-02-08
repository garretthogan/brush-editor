# glvl-io

Encrypted `.glvl` level file save/load module. Zero dependencies.

## Usage

```js
import { saveGlvl, loadGlvl } from './lib/glvl-io.js'

// Save any JSON-serializable data
await saveGlvl(myLevelData, { filename: 'level.glvl' })

// Load (opens file picker)
const data = await loadGlvl({ accept: '.glvl' })
if (data) {
  // Apply loaded data to your scene/state
}
```

## API

- **`saveGlvl(data, options?)`** — Encrypts and downloads. `options.filename` (default: `'level.glvl'`), `options.key` (optional 32-byte `Uint8Array`).

- **`loadGlvl(options?)`** — Opens file picker, decrypts, returns `Promise<object | null>`. `options.accept` (default: `'.glvl'`), `options.key` (optional).

## Requirements

- Web Crypto API (HTTPS or localhost)
- ES modules
