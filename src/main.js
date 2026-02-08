import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { saveGlvl, loadGlvl } from './lib/glvl-io.js'
import { generateMaze as generateMazeGrid } from './lib/maze-generator.js'

const GRID_COLOR = 0x333333
const OUTLINE_COLOR = 0xff8800

const textureLoader = new THREE.TextureLoader()
const defaultTexture = textureLoader.load('/textures/Dark/texture_05.png')
defaultTexture.wrapS = defaultTexture.wrapT = THREE.RepeatWrapping

// --- Scene Setup ---
const viewport = document.getElementById('viewport')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1a)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
camera.position.set(8, 8, 8)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(viewport.clientWidth, viewport.clientHeight)
renderer.shadowMap.enabled = false
viewport.appendChild(renderer.domElement)

// Lighting
const ambient = new THREE.AmbientLight(0x404040, 1)
scene.add(ambient)
const dirLight = new THREE.DirectionalLight(0xffffff, 1)
dirLight.position.set(10, 15, 10)
dirLight.castShadow = false
scene.add(dirLight)

// Grid helper - render first, don't write depth, so grid lines don't show through meshes
const grid = new THREE.GridHelper(20, 20, GRID_COLOR, GRID_COLOR)
grid.position.y = -0.01
grid.renderOrder = -1
grid.material.depthWrite = false
scene.add(grid)

// --- Controls ---
const orbitControls = new OrbitControls(camera, renderer.domElement)
orbitControls.enableDamping = true
orbitControls.dampingFactor = 0.05

const transformControls = new TransformControls(camera, renderer.domElement)
transformControls.setSize(0.4)
scene.add(transformControls.getHelper()) // Helper must be in scene for gizmo to render

transformControls.addEventListener('dragging-changed', (e) => {
  orbitControls.enabled = !e.value
  if (e.value) {
    pushUndoState()
  }
  if (!e.value && selectedBrush && transformControls.getMode() === 'scale') {
    bakeScaleIntoGeometry(selectedBrush)
  }
})

// --- Brush State ---
const brushes = []
let selectedBrush = null

// --- Undo Stack ---
const MAX_UNDO = 50
const undoStack = []

function pushUndoState() {
  const state = serializeLevel()
  if (undoStack.length >= MAX_UNDO) undoStack.shift()
  undoStack.push(JSON.stringify(state))
}

function undo() {
  if (undoStack.length === 0) return
  const state = JSON.parse(undoStack.pop())
  deserializeLevel(state)
}

// Scale box UVs per face so texture tiles without stretching. Keeps default UV axes (lines align with edges).
function setBoxUVs(geometry, sx, sy, sz) {
  const uv = geometry.attributes.uv
  if (!uv) return
  // Face dimensions (width, height) per buildPlane order: px, nx, py, ny, pz, nz
  const faceDims = [
    [sz, sy], [sz, sy],   // px, nx: depth×height
    [sx, sz], [sx, sz],   // py, ny: width×depth
    [sx, sy], [sx, sy],   // pz, nz: width×height
  ]
  for (let f = 0; f < 6; f++) {
    const [w, h] = faceDims[f]
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      const uVal = uv.getX(i)
      const vVal = uv.getY(i)
      // Default UVs: u 0→1, v 1→0. Scale to (0,w) and (0,h) for tiling.
      uv.setXY(i, uVal * w, vVal * h)
    }
  }
  uv.needsUpdate = true
}

function createBrushMesh(size = [2, 2, 2], position = [0, 1, 0], depthBias = 0) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  setBoxUVs(geometry, size[0], size[1], size[2])
  const texture = defaultTexture.clone()
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: depthBias,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.isBrush = true
  mesh.userData.size = [...size]
  return mesh
}

function addBoxBrush() {
  pushUndoState()
  const size = [2, 2, 2]
  const position = [0, 1, 0]
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  scene.add(mesh)
  brushes.push(mesh)
  selectBrush(mesh)
}

function addBrushMesh(size, position) {
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  scene.add(mesh)
  brushes.push(mesh)
  return mesh
}

function getMazeControls() {
  return {
    cols: parseInt(document.getElementById('maze-cols').value, 10),
    rows: parseInt(document.getElementById('maze-rows').value, 10),
    spaceBetweenWalls: parseFloat(document.getElementById('maze-space').value),
    wallThickness: parseFloat(document.getElementById('maze-thickness').value),
    wallHeight: parseFloat(document.getElementById('maze-height').value),
    exitWidth: parseInt(document.getElementById('maze-exit-width').value, 10),
    centerRoomSize: parseInt(document.getElementById('maze-center-size').value, 10),
    layout: document.querySelector('input[name="maze-layout"]:checked').value,
  }
}

function mazeGridToMeshes(grid, cols, rows, spaceBetweenWalls, wallThickness, wallHeight) {
  const w = cols * 2 + 1
  const h = rows * 2 + 1
  const unitSize = spaceBetweenWalls
  const segmentLength = unitSize * 2
  const ox = ((w - 1) / 2) * unitSize
  const oz = ((h - 1) / 2) * unitSize

  const isOuterCorner = (x, z) =>
    (x === 0 && z === 0) || (x === w - 1 && z === 0) || (x === 0 && z === h - 1) || (x === w - 1 && z === h - 1)
  const onBoundary = (x, z) => x === 0 || x === w - 1 || z === 0 || z === h - 1

  for (let x = 0; x < w; x++) {
    for (let z = 0; z < h; z++) {
      if (grid[x][z] !== 1) continue
      const horz = x % 2 === 0
      const vert = z % 2 === 0
      if (horz && vert && !isOuterCorner(x, z) && !onBoundary(x, z)) continue
      const px = x * unitSize - ox
      const pz = z * unitSize - oz
      let sx, sz
      if (horz && vert) {
        sx = wallThickness
        sz = wallThickness
      } else if (onBoundary(x, z)) {
        sx = (x === 0 || x === w - 1) ? wallThickness : segmentLength
        sz = (x === 0 || x === w - 1) ? segmentLength : wallThickness
      } else {
        sx = horz ? wallThickness : segmentLength
        sz = horz ? segmentLength : wallThickness
      }
      addBrushMesh([sx, wallHeight, sz], [px, wallHeight / 2, pz])
    }
  }
}

function generateMaze() {
  pushUndoState()
  // Clear only maze-generated brushes, keep user-added brushes
  const toKeep = brushes.filter((m) => m.userData.isUserBrush)
  const toRemove = brushes.filter((m) => !m.userData.isUserBrush)
  toRemove.forEach((m) => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.map?.dispose()
    m.material.dispose()
  })
  brushes.length = 0
  brushes.push(...toKeep)
  selectBrush(selectedBrush && brushes.includes(selectedBrush) ? selectedBrush : null)

  const ctrl = getMazeControls()
  const { grid, cols, rows } = generateMazeGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    exitWidth: ctrl.exitWidth,
    centerRoomSize: ctrl.centerRoomSize,
    layout: ctrl.layout,
  })

  mazeGridToMeshes(
    grid,
    cols,
    rows,
    ctrl.spaceBetweenWalls,
    ctrl.wallThickness,
    ctrl.wallHeight
  )

  selectBrush(null)
}

function addOutline(mesh) {
  if (mesh.userData.outline) return
  const outlineGeom = mesh.geometry.clone()
  const outlineMat = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: THREE.BackSide,
  })
  const outline = new THREE.Mesh(outlineGeom, outlineMat)
  outline.scale.setScalar(1.02)
  mesh.add(outline)
  mesh.userData.outline = outline
}

function removeOutline(mesh) {
  const outline = mesh?.userData?.outline
  if (outline) {
    mesh.remove(outline)
    outline.geometry.dispose()
    outline.material.dispose()
    mesh.userData.outline = null
  }
}

function selectBrush(mesh) {
  removeOutline(selectedBrush)
  selectedBrush = mesh
  if (mesh) {
    addOutline(mesh)
    transformControls.attach(mesh)
  } else {
    transformControls.detach()
  }
}

function deleteSelected() {
  if (!selectedBrush) return
  pushUndoState()
  const idx = brushes.indexOf(selectedBrush)
  if (idx !== -1) brushes.splice(idx, 1)
  removeOutline(selectedBrush)
  scene.remove(selectedBrush)
  selectedBrush.geometry.dispose()
  selectedBrush.material.map?.dispose()
  selectedBrush.material.dispose()
  selectBrush(null)
}

// Raycast for click selection
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function onPointerClick(event) {
  const rect = viewport.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(brushes)

  if (intersects.length > 0) {
    selectBrush(intersects[0].object)
  } else {
    selectBrush(null)
  }
}

// Mode switching
function setTransformMode(mode) {
  transformControls.setMode(mode)
  if (selectedBrush) {
    transformControls.attach(selectedBrush)
  }
}

function bakeScaleIntoGeometry(mesh) {
  const s = mesh.scale
  const base = mesh.userData.size
  mesh.userData.size = [base[0] * s.x, base[1] * s.y, base[2] * s.z]
  mesh.geometry.dispose()
  const [sx, sy, sz] = mesh.userData.size
  mesh.geometry = new THREE.BoxGeometry(sx, sy, sz)
  setBoxUVs(mesh.geometry, sx, sy, sz)
  mesh.scale.set(1, 1, 1)
  const outline = mesh.userData.outline
  if (outline) {
    outline.geometry.dispose()
    outline.geometry = mesh.geometry.clone()
  }
}

// --- Level serialization (app-specific) ---
function serializeLevel() {
  return {
    version: 1,
    brushes: brushes.map((m) => ({
      id: m.userData.id,
      type: 'box',
      position: m.position.toArray(),
      size: [...m.userData.size],
      rotation: m.rotation.toArray().slice(0, 3),
    })),
  }
}

function deserializeLevel(data) {
  if (!data?.brushes) return

  brushes.forEach((m) => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.map?.dispose()
    m.material.dispose()
  })
  brushes.length = 0

  data.brushes.forEach((b) => {
    const mesh = createBrushMesh(b.size, b.position, brushes.length * 4)
    mesh.userData.id = b.id || crypto.randomUUID()
    mesh.position.fromArray(b.position)
    if (b.rotation) mesh.rotation.fromArray(b.rotation)
    scene.add(mesh)
    brushes.push(mesh)
  })
  selectBrush(null)
}

async function saveLevel() {
  await saveGlvl(serializeLevel(), { filename: 'level.glvl' })
}

async function loadLevel() {
  const data = await loadGlvl({ accept: '.glvl' })
  if (data) {
    pushUndoState()
    deserializeLevel(data)
  }
}

// --- Mode tabs ---
let editorMode = 'brush'
const brushControls = document.getElementById('brush-controls')
const mazeControls = document.getElementById('maze-controls')

function setEditorMode(mode) {
  editorMode = mode
  document.querySelectorAll('#mode-tabs .tab').forEach((t) => t.classList.remove('active'))
  document.getElementById(`tab-${mode}`).classList.add('active')
  brushControls.classList.toggle('hidden', mode !== 'brush')
  mazeControls.classList.toggle('hidden', mode !== 'maze')
}

document.getElementById('tab-brush').addEventListener('click', () => setEditorMode('brush'))
document.getElementById('tab-maze').addEventListener('click', () => setEditorMode('maze'))

// --- Collapsible panels ---
document.querySelectorAll('.panel-header').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panel = btn.closest('.panel')
    panel.classList.toggle('collapsed')
  })
})

// --- Maze slider value display ---
document.getElementById('maze-cols').addEventListener('input', (e) => {
  document.getElementById('maze-cols-value').textContent = e.target.value
})
document.getElementById('maze-rows').addEventListener('input', (e) => {
  document.getElementById('maze-rows-value').textContent = e.target.value
})
document.getElementById('maze-space').addEventListener('input', (e) => {
  document.getElementById('maze-space-value').textContent = e.target.value
})
document.getElementById('maze-thickness').addEventListener('input', (e) => {
  document.getElementById('maze-thickness-value').textContent = e.target.value
})
document.getElementById('maze-height').addEventListener('input', (e) => {
  document.getElementById('maze-height-value').textContent = e.target.value
})
document.getElementById('maze-exit-width').addEventListener('input', (e) => {
  document.getElementById('maze-exit-width-value').textContent = e.target.value
})
document.getElementById('maze-center-size').addEventListener('input', (e) => {
  document.getElementById('maze-center-size-value').textContent = e.target.value
})

// Show/hide center room size when layout changes
function updateCenterRoomVisibility() {
  const centerOut = document.querySelector('input[name="maze-layout"]:checked').value === 'center-out'
  document.getElementById('center-room-row').classList.toggle('hidden', !centerOut)
}
document.querySelectorAll('input[name="maze-layout"]').forEach((radio) => {
  radio.addEventListener('change', updateCenterRoomVisibility)
})
updateCenterRoomVisibility()

// --- Toolbar ---
document.getElementById('btn-add-box').addEventListener('click', addBoxBrush)
document.getElementById('btn-select').addEventListener('click', () => setTransformMode('translate'))
document.getElementById('btn-move').addEventListener('click', () => setTransformMode('translate'))
document.getElementById('btn-rotate').addEventListener('click', () => setTransformMode('rotate'))
document.getElementById('btn-scale').addEventListener('click', () => setTransformMode('scale'))
document.getElementById('btn-delete').addEventListener('click', deleteSelected)
document.getElementById('btn-generate-maze').addEventListener('click', generateMaze)
document.getElementById('btn-save').addEventListener('click', saveLevel)
document.getElementById('btn-load').addEventListener('click', loadLevel)

viewport.addEventListener('click', onPointerClick)

document.addEventListener('keydown', (e) => {
  const active = document.activeElement
  const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')

  if (!inInput) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
    }
  }
})

// --- Resize ---
const resizeObserver = new ResizeObserver(() => {
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
})
resizeObserver.observe(viewport)

// --- Loop ---
function animate() {
  requestAnimationFrame(animate)
  orbitControls.update()
  renderer.render(scene, camera)
}
animate()
