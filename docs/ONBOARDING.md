# Brush Editor — Developer Onboarding

This document gives new developers a digestible map of the codebase: what the app does, how it’s structured, and where to look when you need to change something.

---

## What This App Is

**Brush Editor** (GBrush Editor) is a 3D level editor for building game levels. Users can:

- **Brush mode** — Place and edit box/cylinder brushes (walls, platforms), combine them with CSG (add/subtract/intersect), and manage lights.
- **Level Builder** — Define maze and arena volumes, then generate procedural mazes or arenas that become brushes.
- **Floor Plan** — Design 2D floor plans (SVG) that can drive level layout.
- **Skybox** — Adjust sky/sun and use lit materials with shadows.

Levels are saved as `.glvl` (encrypted JSON) or exported as GLB. The stack is **Vite + vanilla JS**, **Three.js** for 3D, and **three-bvh-csg** for constructive solid geometry.

---

## High-Level Architecture

- **Entry point:** `src/main.js` — sets up the scene, creates the editor model/view/controller, wires input and UI, and runs the render loop.
- **Three pillars under `src/`:**
  - **`lib/`** — Reusable utilities and subsystems: scene setup, materials, I/O, generators, input commands, floor-plan tool, etc.
  - **`ecs/`** — Lightweight entity/component layer: `EntityRegistry` and component helpers; brushes and other scene objects are registered here for lookup and grouping.
  - **`editor/`** — Editor UI state and wiring: `EditorModel` (selection, tool, mode), `EditorView` (scene list, panel visibility, brush tools), `EditorController` (button handlers that call into `main.js`).

`main.js` is intentionally the place where “game” logic and wiring live: brush/CSG logic, undo, serialization, and the large context object passed to the input handler and editor controller. The goal is to keep `lib/`, `ecs/`, and `editor/` as reusable or testable units while `main.js` composes them.

---

## Source Layout

```
src/
├── main.js                 # Bootstrap, scene, CSG, undo, I/O, input & editor wiring
├── index.html              # (if present) or root index at project root
├── design-system.css       # Design tokens / UI base
├── brush-editor-app.css    # App-specific layout and components
├── style.css               # Global styles
│
├── editor/                 # Editor UI state and presentation
│   ├── EditorModel.js      # selectedBrush, selectedLight, currentTool, editorMode; subscribe()
│   ├── EditorView.js       # Scene list, panel visibility, brush tools panel; init(options)
│   └── EditorController.js # Button click handlers; wire() binds to DOM
│
├── ecs/                    # Entity registry and component helpers
│   ├── EntityRegistry.js   # register(mesh), removeEntity(id), getEntity(id), getEntitiesInGroup, etc.
│   └── components.js      # COMPONENT, hasBrushComponent, getEntityId, setEntityId, brush/mesh getters/setters
│
└── lib/                    # Shared subsystems
    ├── scene-setup.js      # initScene() → viewport, scene, camera, renderer, orbitControls, transformControls
    ├── state.js            # Global state bag (scene, camera, renderer, etc.); setState()
    ├── input-commands.js   # Command pattern: createInputHandler(ctx) → setTransformMode, deleteSelected
    ├── materials.js        # Textures, brush materials, lit/unlit, shadows, maze/arena textures
    ├── glb-io.js           # loadGlbSceneFromFile, saveGlb (GLB import/export)
    ├── glvl-io.js          # Level format (.glvl) save/load (encrypted JSON)
    ├── export-glb.js       # Export modal and export pipeline
    ├── import-glb.js       # Import GLB into scene
    ├── ui-panels.js        # initUIPanels(), updateSceneList(), buildExportEntries()
    ├── toast.js            # showToast() for user feedback
    ├── maze-generator.js   # generateMaze() grid for procedural mazes
    ├── arena-generator.js  # generateArena() for arena layouts
    ├── floor-plan-tool.js  # mountFloorPlanTool() — 2D floor plan UI and integration
    ├── floor-plan-engine.js# generateFloorPlan, renderFloorPlanSvg (floor plan logic)
    ├── obj-io.js           # OBJ load (e.g. cone, box)
    ├── polyfills.js        # Polyfills if needed
    └── ...
```

---

## Core Concepts

### Brushes and the scene

- **Brushes** are Three.js meshes (boxes, cylinders, etc.) that the user can add, select, move, rotate, scale, and delete. They live in a `brushes` array in `main.js` and are added to the `scene`.
- **userData** on each mesh holds: `id`, `type`, `size`/`radius`/`height`, `csgOperation`, `isUserBrush`, `generatorGroup`, `subtype`, texture keys, etc. This drives CSG, serialization, and the scene list.
- **EntityRegistry** (`ecs/`) registers these meshes (and level-builder volumes, etc.) as entities so you can look up by id, group, or component. Many “add brush” paths in `main.js` call `entityRegistry.register(mesh)`.

### CSG (Constructive Solid Geometry)

- User brushes can be marked as **ADDITION**, **SUBTRACTION**, or **INTERSECTION**.
- **three-bvh-csg** (`Brush`, `Evaluator`) combines them into a single mesh (`csgResultMesh`). Non-user brushes (e.g. maze walls) can form the “base” that user brushes subtract from.
- When brushes or CSG options change, `updateCsgResult()` in `main.js` recomputes the result and updates the scene.

### Editor modes

- **brush** — Default: place and edit brushes, scene list, transform tools.
- **level-builder** — Maze/arena volumes; generate maze or arena; previews.
- **floor-plan** — 2D floor plan tool in a dedicated panel; viewport can be hidden.
- **skybox** — Sky/sun tweaks; lit materials and shadows.

Mode is stored in `EditorModel` (`editorMode`) and applied in `main.js` in `setEditorMode(mode)`, which toggles panel visibility, mounts the floor plan tool when entering floor-plan, and updates materials/sky.

### Selection and tools

- **EditorModel** holds `selectedBrush`, `selectedLight`, `currentTool` (translate/rotate/scale/select), and `editorMode`.
- **EditorView** updates the scene list and brush tools panel when the model changes (via `editorModel.subscribe()`).
- **TransformControls** (from Three.js addons) are attached to the selected brush or light; the **input handler** switches between orbit and transform based on tool and drag state.

---

## Data Flow (Summary)

1. **Input** — `createInputHandler(ctx)` in `lib/input-commands.js` binds pointer and keyboard events. It uses a **command pattern** (e.g. `SelectBrushCommand`, `DeleteSelectedCommand`, `SetTransformModeCommand`) and executes them with a context object supplied by `main.js` (selectBrush, setTransformMode, deleteSelected, undo, etc.).
2. **State** — Selection and tool live in **EditorModel**. The **brushes** array, **entityRegistry**, **lights**, **csgResultMesh**, and undo stack live in `main.js`. `lib/state.js` holds a small global bag (scene, camera, renderer, controls) for code that needs it.
3. **UI** — **EditorView** gets callbacks from `main.js` (e.g. `getBrushes`, `selectBrush`, `focusCameraOnObject`) and updates the DOM (scene list, CSG dropdown, panel visibility). **EditorController** wires toolbar buttons to actions (move/rotate/scale/delete, include in CSG, generate maze, save/load, export cancel) implemented in `main.js`.
4. **Subscriptions** — `editorModel.subscribe(() => { ... })` in `main.js` refreshes the scene list and brush tools panel whenever selection or tool changes.

So: **input → commands with context → main.js state + EditorModel → EditorView + panel visibility**. No direct UI logic inside the model; the view is passive and driven by callbacks and subscriptions.

---

## Key Modules (Where to Look)

| You want to…                     | Look at… |
|----------------------------------|----------|
| Change how the 3D view/camera/controls are set up | `lib/scene-setup.js` |
| Change keybindings or pointer behavior (select, move, undo, delete) | `lib/input-commands.js`, and the `createInputHandler` call in `main.js` |
| Add a new brush type or change how brushes are created | `main.js` (add box/cylinder/floor, maze/arena generation) and `ecs/EntityRegistry.js` + `ecs/components.js` |
| Change CSG (add/subtract/intersect) or when it runs | `main.js`: `updateCsgResult()`, `isCsgBrush()`, and where `updateCsgResult()` is called |
| Change scene list or brush tools panel behavior | `editor/EditorView.js`, and `initUIPanels` / `editorView.init()` in `main.js` |
| Wire a new toolbar or mode button | `editor/EditorController.js` (add handler in `wire()`), and `main.js` for the action and any `setEditorMode` / panel toggles |
| Change editor mode behavior (which panels show, what mounts) | `main.js`: `setEditorMode()` and the mode dropdown listener |
| Change level save/load (.glvl) or GLB export/import | `lib/glvl-io.js`, `lib/glb-io.js`, `lib/export-glb.js`, `lib/import-glb.js`; callers in `main.js` |
| Change materials, textures, or shadows | `lib/materials.js`; usage in `main.js` (e.g. when adding brushes, switching to skybox) |
| Change maze or arena generation | `lib/maze-generator.js`, `lib/arena-generator.js`; integration in `main.js` (generateMaze, generateArena, etc.) |
| Change the floor plan tool (2D UI, generation) | `lib/floor-plan-tool.js` (mounting and UI), `lib/floor-plan-engine.js` (generation/SVG) |

---

## Run and Build

```bash
npm install
npm run dev    # Vite dev server
npm run build  # Production build
npm run preview # Preview production build
```

Open the app in the browser and use the top mode selector (Brush / Level Builder / Floor Plan / Skybox) to switch contexts.

---

## Conventions and Rules

- **Three.js** — Prefer the official docs (see `.cursorrules`). Use `WebGLRenderer` by default; ESM imports and current manual patterns.
- **HCE (Human-Centered Engineering)** — User-facing async must have loading/error/success and recovery; no silent catches; destructive actions need confirm or undo; errors must be actionable. See `.cursorrules` for the full lint set.
- **Architecture (GAPR)** — Input produces intent/commands; avoid direct platform calls from “game” layer; prefer composition and event-driven communication. See `.cursorrules` for GAPR rules.
- **Clean code** — Naming, single responsibility, no magic numbers in domain logic, tests for new behavior. See `.cursorrules` for the clean-code contract.

The project’s **.cursorrules** file is the single source for Three.js, HCE, GAPR, and clean-code policies; this onboarding doc is a map of the codebase, not a replacement for those rules.

---

## Quick “First Change” Suggestions

1. **Change a toolbar button** — In `EditorController.wire()` add a listener and call an action you implement in `main.js`; pass that action in the `EditorController` constructor in `main.js`.
2. **Add a new brush subtype** — In `main.js`, find where brushes are created (e.g. add box, add cylinder, maze/arena generation), add your creation path, set `mesh.userData.subtype` (and any other userData), and call `entityRegistry.register(mesh)`. Ensure the brush is pushed to `brushes` if it should appear in the scene list and CSG.
3. **Change what the scene list shows** — Adjust `EditorView.updateSceneList()` (and optionally `buildExportEntries()` in `ui-panels.js` if export list should match).

Once you’re comfortable with `main.js` ↔ `editor/` ↔ `lib/` and where brushes/entities live, you can navigate the rest by following the imports and the table above.
