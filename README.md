# GBrush Editor

A 3D level editor for building game levels with box brushes and procedural mazes. Use it to design levels, save them as `.glvl` files, and load those files into your own game projects.

## Quick Start

```bash
npm install
npm run dev
```

Open the app in your browser and start building.

---

## How to Use

### Two Modes

- **Brush Editor** — Place and arrange individual box brushes (walls, platforms, obstacles).
- **Maze Generator** — Create procedural mazes with customizable dimensions and layout.

Switch between modes with the tabs at the top.

### Brush Editor

1. **Add Box** — Adds a 2×2×2 box at the origin. A new box is selected automatically.
2. **Select** — Click any brush in the viewport to select it (orange outline).
3. **Move** — With a brush selected, drag the gizmo arrows to translate.
4. **Rotate** — Drag the gizmo rings to rotate.
5. **Scale** — Drag the gizmo cubes to scale. When you release, the scale is baked into the geometry (textures stay correct).
6. **Delete** — Removes the selected brush.

**Controls:**
- **Orbit camera** — Left-drag in the viewport.
- **Undo** — `Ctrl+Z` (Windows/Linux) or `Cmd+Z` (Mac).
- **Delete** — `Delete` or `Backspace` removes the selected brush.

### Maze Generator

1. Adjust the sliders:
   - **Columns / Rows** — Maze size (5–30).
   - **Space between walls** — Distance between passages.
   - **Wall thickness / height** — Wall dimensions.
   - **Exit width** — Width of the maze exit(s) in cells.
   - **Center room size** — Size of the center room (Center → Out layout).
   - **Layout** — **Center → Out** (room in center, exit on edge) or **Out → Out** (corridor between opposite sides).

2. Click **Generate Maze** to create a new maze. Maze walls are added as brushes; any manually placed brushes you added before remain.

### Save & Load

- **Save** — Exports your level as an encrypted `.glvl` file (download).
- **Load** — Opens a file picker to load a `.glvl` file.

Levels are stored as JSON, encrypted with AES-GCM. Use the same default key (or your own) in your game to decrypt and load levels.

---

## Using in Your Game

Levels saved from GBrush Editor use this structure:

```json
{
  "version": 1,
  "brushes": [
    {
      "id": "uuid",
      "type": "box",
      "position": [x, y, z],
      "size": [width, height, depth],
      "rotation": [x, y, z]
    }
  ]
}
```

Load `.glvl` files in your game with the `glvl-io` module (or your own loader). See `src/lib/glvl-io.js` for the API and `src/lib/README.md` for usage details.

You can swap the default texture by changing the path in `main.js` (e.g. to textures in `public/textures/`). The editor uses Three.js—your game can use Three.js, Babylon, Unity, or any engine that can consume this data.

---

## Development

```bash
npm install
npm run dev
```

### E2E tests

Run end-to-end tests with Playwright. **First time (and after Playwright upgrades), install the browser:**

```bash
npm run test:e2e:install
```

Then run e2e tests:

```bash
npm run test:e2e
```

## Deploy to GitHub Pages

**One-time setup** (if you haven’t already):

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

**Deploy**

- **Automatic:** Push to the `main` branch. The workflow builds and deploys.
- **Manual:** **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

The site will be at `https://<your-username>.github.io/brush-editor/` (or your repo name).
