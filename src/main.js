import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { saveGlvl, loadGlvlFromFile } from './lib/glvl-io.js'
import { loadGlbFromFile } from './lib/glb-io.js'
import { generateMaze as generateMazeGrid } from './lib/maze-generator.js'
import { createInputHandler } from './lib/input-commands.js'

const GRID_COLOR = 0x333333
const OUTLINE_COLOR = 0xff8800

// Only textures at palette root (excludes Fixtures). Format: { palette, file }
const TEXTURE_POOL = [
  { palette: 'Dark', file: 'texture_01.png' },
  { palette: 'Dark', file: 'texture_13.png' },
  { palette: 'Green', file: 'texture_02.png' },
  { palette: 'Light', file: 'texture_02.png' },
  { palette: 'Orange', file: 'texture_02.png' },
  { palette: 'Purple', file: 'texture_02.png' },
  { palette: 'Red', file: 'texture_02.png' },
]

const textureLoader = new THREE.TextureLoader()
const baseUrl = import.meta.env.BASE_URL

function getTextureUrl(index) {
  const { palette, file } = TEXTURE_POOL[index]
  return `${baseUrl}textures/${palette}/${file}`
}

function loadTextureForSpawn() {
  const select = document.getElementById('texture-select')
  const value = select?.value
  const index = value === 'random' || value === ''
    ? Math.floor(Math.random() * TEXTURE_POOL.length)
    : Math.max(0, Math.min(parseInt(value, 10) || 0, TEXTURE_POOL.length - 1))
  const url = getTextureUrl(index)
  const tex = textureLoader.load(url)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- Scene Setup ---
const viewport = document.getElementById('viewport')
let pickRectElement = viewport
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1a)

// Sky (Preetham model) - added as mesh so it can be toggled or edited
const sky = new Sky()
sky.scale.setScalar(450000)
scene.add(sky)
const sun = new THREE.Vector3()

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
camera.position.set(8, 8, 8)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(viewport.clientWidth, viewport.clientHeight)
renderer.shadowMap.enabled = false
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.5
viewport.appendChild(renderer.domElement)
pickRectElement = renderer.domElement

const pickDebug = document.getElementById('pick-debug')
function reportPick({ brush, lightEntry, target }) {
  if (!pickDebug) return
  const targetLabel = target
    ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`
    : 'none'
  const brushLabel = brush
    ? `${brush.userData?.type ?? 'brush'}:${brush.userData?.id ?? 'no-id'}`
    : 'none'
  const lightLabel = lightEntry ? `${lightEntry.type}` : 'none'
  const gizmoLabel = transformControls?.object ? 'attached' : 'detached'
  const gizmoVisible = transformControlsHelper?.visible ? 'visible' : 'hidden'
  const gizmoEnabled = transformControls?.enabled ? 'enabled' : 'disabled'
  pickDebug.textContent =
    `target: ${targetLabel}\n` +
    `brush: ${brushLabel}\n` +
    `light: ${lightLabel}\n` +
    `gizmo: ${gizmoLabel} / ${gizmoEnabled} / ${gizmoVisible}`
  pickDebug.classList.remove('hidden')
}

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
transformControls.enabled = false
const transformControlsHelper = transformControls.getHelper()
transformControlsHelper.visible = false
transformControlsHelper.traverse((child) => {
  child.frustumCulled = false
  if (child.material) {
    child.material.depthTest = false
  }
  child.renderOrder = 1000
})
scene.add(transformControlsHelper) // Helper must be in scene for gizmo to render

// --- Brush State ---
const brushes = []
let selectedBrush = null
let currentTool = 'select'

// --- Light State ---
const lights = [] // { light, helper, type: 'point'|'spot'|'directional'|'ambient' }
let selectedLight = null

const LIGHT_HELPER_COLOR = 0xffdd88
const POINT_LIGHT_HELPER_RADIUS = 0.2
const SPOT_LIGHT_CONE_LENGTH = 1.2
const SPOT_LIGHT_CONE_RADIUS = 0.35
const DIRECTIONAL_LIGHT_DISC_SIZE = 0.4

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

// Scale cylinder UVs so texture tiles without stretching. Side: u = circumference, v = height. Caps: radial scale by diameter.
function setCylinderUVs(geometry, radius, height, radialSegments = 16, heightSegments = 1) {
  const uv = geometry.attributes.uv
  if (!uv) return
  const circumference = 2 * Math.PI * radius
  const torsoCount = (radialSegments + 1) * (heightSegments + 1)
  // Side (torso)
  for (let i = 0; i < torsoCount; i++) {
    const uVal = uv.getX(i)
    const vVal = uv.getY(i)
    uv.setXY(i, uVal * circumference, vVal * height)
  }
  // Caps (top and bottom): radial UVs centered at (0.5, 0.5), scale by 2*radius for tiling
  const capScale = 2 * radius
  const capVertexCount = radialSegments + (radialSegments + 1) // per cap
  for (let cap = 0; cap < 2; cap++) {
    const start = torsoCount + cap * (2 * radialSegments + 1)
    const end = start + 2 * radialSegments + 1
    for (let i = start; i < end; i++) {
      const uVal = uv.getX(i)
      const vVal = uv.getY(i)
      uv.setXY(i, 0.5 + (uVal - 0.5) * capScale, 0.5 + (vVal - 0.5) * capScale)
    }
  }
  uv.needsUpdate = true
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
  const texture = loadTextureForSpawn()
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
  mesh.userData.type = 'box'
  mesh.userData.size = [...size]
  return mesh
}

function createCylinderMesh(radius = 1, height = 2, position = [0, 1, 0], depthBias = 0) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16, 1)
  setCylinderUVs(geometry, radius, height, 16, 1)
  const texture = loadTextureForSpawn()
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
  mesh.userData.type = 'cylinder'
  mesh.userData.radius = radius
  mesh.userData.height = height
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
  setCurrentTool('translate')
  setTransformMode('translate')
}

function addCylinderBrush() {
  pushUndoState()
  const radius = 1
  const height = 2
  const position = [0, 1, 0]
  const mesh = createCylinderMesh(radius, height, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  scene.add(mesh)
  brushes.push(mesh)
  selectBrush(mesh)
  setCurrentTool('translate')
  setTransformMode('translate')
}

function addBrushMesh(size, position) {
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  scene.add(mesh)
  brushes.push(mesh)
  return mesh
}

// --- Light helpers (visual only; do not cast or receive shadow) ---
function createPointLightHelper(light) {
  const geometry = new THREE.SphereGeometry(POINT_LIGHT_HELPER_RADIUS, 12, 8)
  const material = new THREE.MeshBasicMaterial({
    color: light.color.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function createSpotLightHelper(light) {
  const geometry = new THREE.CylinderGeometry(0, SPOT_LIGHT_CONE_RADIUS, SPOT_LIGHT_CONE_LENGTH, 12)
  const material = new THREE.MeshBasicMaterial({
    color: light.color.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = -SPOT_LIGHT_CONE_LENGTH / 2
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function createDirectionalLightHelper(light) {
  const geometry = new THREE.CircleGeometry(DIRECTIONAL_LIGHT_DISC_SIZE, 16)
  const material = new THREE.MeshBasicMaterial({
    color: light.color.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function addPointLight() {
  pushUndoState()
  const light = new THREE.PointLight(0xffffff, 1, 20, 0.5)
  light.position.set(0, 5, 0)
  light.castShadow = false
  const helper = createPointLightHelper(light)
  light.add(helper)
  scene.add(light)
  const entry = { light, helper, type: 'point' }
  helper.userData.lightEntry = entry
  lights.push(entry)
  selectBrush(null)
  selectLight(entry)
  setCurrentTool('translate')
  setTransformMode('translate')
}

function addSpotLight() {
  pushUndoState()
  const light = new THREE.SpotLight(0xffffff, 2, 25, Math.PI / 6, 0.5, 1)
  light.position.set(0, 8, 4)
  light.target.position.set(0, 0, 0)
  scene.add(light.target)
  light.castShadow = false
  const helper = createSpotLightHelper(light)
  light.add(helper)
  scene.add(light)
  const entry = { light, helper, type: 'spot' }
  helper.userData.lightEntry = entry
  lights.push(entry)
  selectBrush(null)
  selectLight(entry)
  setCurrentTool('translate')
  setTransformMode('translate')
}

function addDirectionalLight() {
  pushUndoState()
  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.position.set(5, 10, 5)
  light.target.position.set(0, 0, 0)
  scene.add(light.target)
  light.castShadow = false
  const helper = createDirectionalLightHelper(light)
  light.add(helper)
  scene.add(light)
  const entry = { light, helper, type: 'directional' }
  helper.userData.lightEntry = entry
  lights.push(entry)
  selectBrush(null)
  selectLight(entry)
  setCurrentTool('translate')
  setTransformMode('translate')
}

function addAmbientLight() {
  pushUndoState()
  const light = new THREE.AmbientLight(0x404040, 0.5)
  scene.add(light)
  const entry = { light, helper: null, type: 'ambient' }
  lights.push(entry)
  selectBrush(null)
  selectLight(entry)
}

function getLightHelpers() {
  return lights.filter((e) => e.helper).map((e) => e.helper)
}

function pickLight(event) {
  const rect = pickRectElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const helperList = getLightHelpers()
  const intersects = raycaster.intersectObjects(helperList, true)
  if (intersects.length === 0) return null
  const obj = intersects[0].object
  return obj.userData.lightEntry ?? null
}

function selectLight(entry) {
  selectedLight = entry
  if (!entry && selectedBrush) return
  if (selectedBrush) {
    removeOutline(selectedBrush)
    selectedBrush = null
    transformControls.detach()
  }
  if (entry) {
    if (entry.type !== 'ambient') {
      transformControls.enabled = true
      transformControls.attach(entry.light)
      transformControlsHelper.visible = true
    } else {
      transformControls.detach()
      transformControls.enabled = false
      transformControlsHelper.visible = false
    }
  } else {
    transformControls.detach()
    transformControls.enabled = false
    transformControlsHelper.visible = false
  }
}

function deleteSelectedLight() {
  if (!selectedLight) return
  pushUndoState()
  const entry = selectedLight
  const idx = lights.indexOf(entry)
  if (idx !== -1) lights.splice(idx, 1)
  if (entry.light.target) scene.remove(entry.light.target)
  scene.remove(entry.light)
  if (entry.helper) {
    entry.helper.geometry.dispose()
    entry.helper.material.dispose()
  }
  selectLight(null)
}

function updateSpotLightHelpers() {
  lights.forEach((entry) => {
    if (entry.type !== 'spot' || !entry.helper) return
    const light = entry.light
    entry.helper.lookAt(light.target.position)
    entry.helper.rotateX(-Math.PI / 2)
  })
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
    layout: document.getElementById('maze-start-from-center').checked ? 'center-out' : 'out-out',
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
  outline.userData.isOutline = true
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
  if (selectedLight) {
    selectedLight = null
    transformControls.detach()
  }
  if (mesh) {
    addOutline(mesh)
    transformControls.enabled = true
    transformControls.attach(mesh)
    transformControlsHelper.visible = true
  } else {
    transformControls.detach()
    transformControls.enabled = false
    transformControlsHelper.visible = false
  }
}

function cloneBrush(mesh) {
  const position = mesh.position.toArray()
  const rotation = mesh.rotation.toArray().slice(0, 3)
  let clone
  if (mesh.userData.type === 'cylinder') {
    clone = createCylinderMesh(mesh.userData.radius, mesh.userData.height, position, brushes.length * 4)
  } else if (mesh.userData.type === 'imported') {
    clone = mesh.clone()
    clone.geometry = mesh.geometry.clone()
    clone.material = mesh.material.clone()
    if (clone.material.map) clone.material.map = clone.material.map.clone()
    clone.userData = { ...mesh.userData, id: crypto.randomUUID(), outline: null }
    clone.scale.copy(mesh.scale)
  } else {
    clone = createBrushMesh([...mesh.userData.size], position, brushes.length * 4)
  }
  clone.userData.id = clone.userData.id ?? crypto.randomUUID()
  clone.userData.isUserBrush = true
  clone.position.fromArray(position)
  clone.rotation.fromArray(rotation)
  scene.add(clone)
  brushes.push(clone)
  return clone
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

function findBrushFromObject(obj) {
  let current = obj
  while (current) {
    if (current.userData?.isBrush) return current
    current = current.parent
  }
  return null
}

function pickBrush(event) {
  const rect = pickRectElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(brushes, true)
  for (const hit of intersects) {
    const brush = findBrushFromObject(hit.object)
    if (brush) return brush
  }
  if (selectedBrush && transformControls.enabled) {
    const gizmoHits = raycaster.intersectObjects([transformControlsHelper], true)
    if (gizmoHits.length > 0) return selectedBrush
  }
  return null
}


// Mode switching
function setTransformMode(mode) {
  transformControls.setMode(mode)
  if (selectedBrush) {
    transformControls.enabled = true
    transformControls.attach(selectedBrush)
  } else if (selectedLight && selectedLight.type !== 'ambient') {
    transformControls.enabled = true
    transformControls.attach(selectedLight.light)
  } else {
    transformControls.detach()
    transformControls.enabled = false
  }
}

function setCurrentTool(tool) {
  currentTool = tool
}

function getCurrentTool() {
  return currentTool
}

function bakeScaleIntoGeometry(mesh) {
  const s = mesh.scale
  const outline = mesh.userData.outline

  if (mesh.userData.type === 'imported') {
    mesh.geometry.scale(s.x, s.y, s.z)
    mesh.scale.set(1, 1, 1)
    if (outline) {
      outline.geometry.dispose()
      outline.geometry = mesh.geometry.clone()
    }
  } else if (mesh.userData.type === 'cylinder') {
    const r = mesh.userData.radius
    const h = mesh.userData.height
    mesh.userData.radius = r * Math.max(s.x, s.z)
    mesh.userData.height = h * s.y
    mesh.geometry.dispose()
    mesh.geometry = new THREE.CylinderGeometry(
      mesh.userData.radius,
      mesh.userData.radius,
      mesh.userData.height,
      16,
      1
    )
    setCylinderUVs(mesh.geometry, mesh.userData.radius, mesh.userData.height, 16, 1)
    mesh.scale.set(1, 1, 1)
    if (outline) {
      outline.geometry.dispose()
      outline.geometry = mesh.geometry.clone()
    }
  } else {
    const base = mesh.userData.size
    mesh.userData.size = [base[0] * s.x, base[1] * s.y, base[2] * s.z]
    mesh.geometry.dispose()
    const [sx, sy, sz] = mesh.userData.size
    mesh.geometry = new THREE.BoxGeometry(sx, sy, sz)
    setBoxUVs(mesh.geometry, sx, sy, sz)
    mesh.scale.set(1, 1, 1)
    if (outline) {
      outline.geometry.dispose()
      outline.geometry = mesh.geometry.clone()
    }
  }
}

// --- Level serialization (app-specific) ---
function getSkyboxState() {
  return {
    turbidity: parseFloat(document.getElementById('sky-turbidity')?.value ?? '10'),
    rayleigh: parseFloat(document.getElementById('sky-rayleigh')?.value ?? '3'),
    mieCoefficient: parseFloat(document.getElementById('sky-mie')?.value ?? '0.005'),
    mieDirectionalG: parseFloat(document.getElementById('sky-mie-g')?.value ?? '0.7'),
    elevation: parseFloat(document.getElementById('sky-elevation')?.value ?? '2'),
    azimuth: parseFloat(document.getElementById('sky-azimuth')?.value ?? '180'),
    exposure: parseFloat(document.getElementById('sky-exposure')?.value ?? '0.5'),
    sunIntensity: parseFloat(document.getElementById('sun-intensity')?.value ?? '1'),
    sunColor: document.getElementById('sun-color')?.value ?? '#ffffff',
  }
}

function setSkyboxState(state) {
  if (!state || typeof state !== 'object') return
  const set = (id, value) => {
    const el = document.getElementById(id)
    if (!el) return
    el.value = value
    const valueEl = document.getElementById(`${id}-value`)
    if (valueEl) valueEl.textContent = value
  }
  if (state.turbidity != null) set('sky-turbidity', state.turbidity)
  if (state.rayleigh != null) set('sky-rayleigh', state.rayleigh)
  if (state.mieCoefficient != null) set('sky-mie', state.mieCoefficient)
  if (state.mieDirectionalG != null) set('sky-mie-g', state.mieDirectionalG)
  if (state.elevation != null) set('sky-elevation', state.elevation)
  if (state.azimuth != null) set('sky-azimuth', state.azimuth)
  if (state.exposure != null) set('sky-exposure', state.exposure)
  if (state.sunIntensity != null) set('sun-intensity', state.sunIntensity)
  if (state.sunColor != null) {
    const colorEl = document.getElementById('sun-color')
    if (colorEl) colorEl.value = state.sunColor
  }
  applySkyParams()
}

function serializeLevel() {
  return {
    version: 1,
    brushes: brushes
      .filter((m) => m.userData.type !== 'imported')
      .map((m) => {
      const base = {
        id: m.userData.id,
        type: m.userData.type || 'box',
        position: m.position.toArray(),
        rotation: m.rotation.toArray().slice(0, 3),
      }
      if (base.type === 'cylinder') {
        base.radius = m.userData.radius
        base.height = m.userData.height
      } else {
        base.size = [...m.userData.size]
      }
      return base
    }),
    skybox: getSkyboxState(),
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
    let mesh
    if (b.type === 'cylinder') {
      mesh = createCylinderMesh(b.radius ?? 1, b.height ?? 2, b.position ?? [0, 1, 0], brushes.length * 4)
    } else {
      mesh = createBrushMesh(b.size ?? [2, 2, 2], b.position ?? [0, 1, 0], brushes.length * 4)
    }
    mesh.userData.id = b.id || crypto.randomUUID()
    mesh.position.fromArray(b.position ?? [0, 1, 0])
    if (b.rotation) mesh.rotation.fromArray(b.rotation)
    scene.add(mesh)
    brushes.push(mesh)
  })
  if (data.skybox) setSkyboxState(data.skybox)
  selectBrush(null)
}

async function saveLevel() {
  await saveGlvl(serializeLevel(), { filename: 'level.glvl' })
}

function addImportedMeshes(meshes) {
  if (!meshes || meshes.length === 0) return
  pushUndoState()
  meshes.forEach((mesh) => {
    const tex = loadTextureForSpawn()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((mat) => {
      if (mat && mat.map !== undefined) mat.map = tex
    })
    mesh.userData.isBrush = true
    mesh.userData.type = 'imported'
    mesh.userData.id = crypto.randomUUID()
    mesh.userData.isUserBrush = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    scene.add(mesh)
    brushes.push(mesh)
  })
  selectBrush(null)
}

function loadLevelFromFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.glvl,.gltf,.glb'
  input.style.display = 'none'
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || [])
    document.body.removeChild(input)
    if (files.length === 0) return
    const first = files[0]
    const ext = first.name.split('.').pop()?.toLowerCase()
    if (ext === 'glvl') {
      const data = await loadGlvlFromFile(first)
      if (data) {
        pushUndoState()
        deserializeLevel(data)
      }
    } else if (ext === 'glb' || ext === 'gltf') {
      const meshes = await loadGlbFromFile(first)
      addImportedMeshes(meshes)
    }
  })
  document.body.appendChild(input)
  input.click()
}

// --- Mode tabs ---
let editorMode = 'brush'
const brushControls = document.getElementById('brush-controls')
const mazeControls = document.getElementById('maze-controls')
const skyboxControls = document.getElementById('skybox-controls')

function applySkyParams() {
  const turbidity = parseFloat(document.getElementById('sky-turbidity').value)
  const rayleigh = parseFloat(document.getElementById('sky-rayleigh').value)
  const mieCoefficient = parseFloat(document.getElementById('sky-mie').value)
  const mieDirectionalG = parseFloat(document.getElementById('sky-mie-g').value)
  const elevation = parseFloat(document.getElementById('sky-elevation').value)
  const azimuth = parseFloat(document.getElementById('sky-azimuth').value)
  const exposure = parseFloat(document.getElementById('sky-exposure').value)

  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = turbidity
  uniforms.rayleigh.value = rayleigh
  uniforms.mieCoefficient.value = mieCoefficient
  uniforms.mieDirectionalG.value = mieDirectionalG

  const phi = THREE.MathUtils.degToRad(90 - elevation)
  const theta = THREE.MathUtils.degToRad(azimuth)
  sun.setFromSphericalCoords(1, phi, theta)
  uniforms.sunPosition.value.copy(sun)

  // Match directional light to sun (light shines from position toward origin)
  dirLight.position.copy(sun).multiplyScalar(500)
  const sunIntensity = parseFloat(document.getElementById('sun-intensity')?.value ?? '1')
  const sunColorHex = document.getElementById('sun-color')?.value ?? '#ffffff'
  dirLight.intensity = sunIntensity
  dirLight.color.set(sunColorHex)

  renderer.toneMappingExposure = exposure
}

function setEditorMode(mode) {
  editorMode = mode
  document.querySelectorAll('#mode-tabs .tab').forEach((t) => t.classList.remove('active'))
  document.getElementById(`tab-${mode}`).classList.add('active')
  brushControls.classList.toggle('hidden', mode !== 'brush')
  mazeControls.classList.toggle('hidden', mode !== 'maze')
  skyboxControls.classList.toggle('hidden', mode !== 'skybox')
}

document.getElementById('tab-brush').addEventListener('click', () => setEditorMode('brush'))
document.getElementById('tab-maze').addEventListener('click', () => setEditorMode('maze'))
document.getElementById('tab-skybox').addEventListener('click', () => setEditorMode('skybox'))

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

// Skybox slider value display and apply
function bindSkySlider(id, valueId) {
  const input = document.getElementById(id)
  const valueEl = document.getElementById(valueId)
  if (!input || !valueEl) return
  input.addEventListener('input', (e) => {
    valueEl.textContent = e.target.value
    applySkyParams()
  })
}
bindSkySlider('sky-turbidity', 'sky-turbidity-value')
bindSkySlider('sky-rayleigh', 'sky-rayleigh-value')
bindSkySlider('sky-mie', 'sky-mie-value')
bindSkySlider('sky-mie-g', 'sky-mie-g-value')
bindSkySlider('sky-elevation', 'sky-elevation-value')
bindSkySlider('sky-azimuth', 'sky-azimuth-value')
bindSkySlider('sky-exposure', 'sky-exposure-value')
bindSkySlider('sun-intensity', 'sun-intensity-value')
const sunColorInput = document.getElementById('sun-color')
if (sunColorInput) sunColorInput.addEventListener('input', applySkyParams)
applySkyParams()

// Show/hide center room size when layout changes
function updateCenterRoomVisibility() {
  const centerOut = document.getElementById('maze-start-from-center').checked
  document.getElementById('center-room-row').classList.toggle('hidden', !centerOut)
}
document.getElementById('maze-start-from-center').addEventListener('change', updateCenterRoomVisibility)
updateCenterRoomVisibility()

// --- Input (command pattern) ---
const inputHandler = createInputHandler({
  viewport,
  canvas: renderer.domElement,
  camera,
  brushes,
  get selectedBrush() {
    return selectedBrush
  },
  selectBrush,
  setTransformMode,
  setCurrentTool,
  getCurrentTool,
  deleteSelected,
  cloneBrush,
  pushUndoState,
  undo,
  transformControls,
  orbitControls,
  bakeScaleIntoGeometry,
  pickBrush,
  pickLight,
  reportPick,
  get selectedLight() {
    return selectedLight
  },
  selectLight,
  deleteSelectedLight,
})

// --- Texture dropdown ---
const textureSelect = document.getElementById('texture-select')
const randomOpt = document.createElement('option')
randomOpt.value = 'random'
randomOpt.textContent = 'Random'
textureSelect.appendChild(randomOpt)
TEXTURE_POOL.forEach(({ palette, file }, i) => {
  const opt = document.createElement('option')
  opt.value = String(i)
  opt.textContent = `${palette} / ${file.replace('.png', '')}`
  textureSelect.appendChild(opt)
})

// --- Toolbar ---
document.getElementById('btn-add-box').addEventListener('click', addBoxBrush)
document.getElementById('btn-add-cylinder').addEventListener('click', addCylinderBrush)
document.getElementById('btn-add-point-light')?.addEventListener('click', addPointLight)
document.getElementById('btn-add-spot-light')?.addEventListener('click', addSpotLight)
document.getElementById('btn-add-directional-light')?.addEventListener('click', addDirectionalLight)
document.getElementById('btn-add-ambient-light')?.addEventListener('click', addAmbientLight)
document.getElementById('btn-move').addEventListener('click', () => inputHandler.setTransformMode('translate'))
document.getElementById('btn-rotate').addEventListener('click', () => inputHandler.setTransformMode('rotate'))
document.getElementById('btn-scale').addEventListener('click', () => inputHandler.setTransformMode('scale'))
document.getElementById('btn-delete').addEventListener('click', () => inputHandler.deleteSelected())
document.getElementById('btn-generate-maze').addEventListener('click', generateMaze)
document.getElementById('btn-save').addEventListener('click', () => saveLevel())
document.getElementById('btn-load').addEventListener('click', () => loadLevelFromFile())

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
  transformControlsHelper.updateMatrixWorld()
  updateSpotLightHelpers()
  renderer.render(scene, camera)
}
animate()
