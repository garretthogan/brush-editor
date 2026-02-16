import './lib/polyfills.js'
import './style.css'
import './tui.css'
import * as THREE from 'three'
import { initScene } from './lib/scene-setup.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { loadGlbSceneFromFile, saveGlb } from './lib/glb-io.js'
import { initUIPanels, updateSceneList } from './lib/ui-panels.js'
import { initExportSystem, openExportModal } from './lib/export-glb.js'
import { createImportSystem } from './lib/import-glb.js'
import { setState } from './lib/state.js'
import { showToast } from './lib/toast.js'
import { mountFloorPlanTool } from './lib/floor-plan-tool.js'
import {
  TEXTURE_POOL,
  TEXTURE_INDEX,
  applyArenaBaseTexture,
  applyArenaObstacleTexture,
  applyMazeFloorTexture,
  applyMazeWallTexture,
  applyTextureIndex,
  createBrushMaterial,
  getSelectedTextureIndex,
  initMaterialSystem,
  loadTextureForSpawn,
  resolveBrushTexture,
  resolveBrushTextureInfo,
  updateBrushMaterials,
  updateShadowState,
} from './lib/materials.js'
import { generateMaze as generateMazeGrid } from './lib/maze-generator.js'
import { generateArena as generateArenaGrid } from './lib/arena-generator.js'
import { createInputHandler } from './lib/input-commands.js'

const GRID_COLOR = 0x333333
const OUTLINE_COLOR = 0xff8800
/** 1 scene unit = 1 meter = this many cm. Length controls use cm; divide by this to get units. */
const CM_PER_UNIT = 100
let useLitMaterials = false
const baseUrl = import.meta.env.BASE_URL

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// --- Scene Setup ---
const {
  viewport,
  pickRectElement,
  scene,
  sky,
  sun,
  camera,
  renderer,
  maxAnisotropy,
  orbitControls,
  transformControls,
  transformControlsHelper,
} = initScene({ gridColor: GRID_COLOR })

// Lighting
const ambient = new THREE.AmbientLight(0x404040, 1)
scene.add(ambient)
const dirLight = new THREE.DirectionalLight(0xffffff, 1)
dirLight.position.set(10, 15, 10)
dirLight.castShadow = false
scene.add(dirLight)
const baseLightEntries = [
  { light: ambient, helper: null, type: 'ambient', isDefault: true, label: 'ambient_light' },
  { light: dirLight, helper: null, type: 'directional', isDefault: true, label: 'sun_directional' },
]

// Grid helper - render first, don't write depth, so grid lines don't show through meshes
const grid = new THREE.GridHelper(20, 20, GRID_COLOR, GRID_COLOR)
grid.position.y = -0.01
grid.renderOrder = -1
grid.material.depthWrite = false
scene.add(grid)

setState({
  scene,
  camera,
  renderer,
  orbitControls,
  transformControls,
})

let isTransformDragging = false

transformControls.addEventListener('dragging-changed', (e) => {
  isTransformDragging = e.value
  if (!selectedLight || !e.value) return
  const mode = transformControls.getMode()
  if (mode === 'scale' && (selectedLight.type === 'point' || selectedLight.type === 'spot')) {
    lightTransformState.baseDistance = selectedLight.light.distance ?? 0
  }
})

transformControls.addEventListener('mouseDown', () => {
  if (!selectedLight) return
  const mode = transformControls.getMode()
  if (mode === 'scale' && (selectedLight.type === 'point' || selectedLight.type === 'spot')) {
    lightTransformState.baseDistance = selectedLight.light.distance ?? 0
  }
})

transformControls.addEventListener('change', () => {
  if (!selectedLight) return
  if (!isTransformDragging) return
  const mode = transformControls.getMode()
  if (mode === 'rotate') {
    updateLightDirectionFromRotation(selectedLight)
  } else if (mode === 'scale') {
    applyLightScaleToDistance(selectedLight)
  }
})

// --- Brush State ---
const brushes = []
let selectedBrush = null
let currentTool = 'select'
let arenaPreview = null
let mazePreview = null
let lastArenaWallHeightCm = 300
let lastMazeState = null
let lastArenaState = null
let lastMazeArenaState = null
let lastMazePlacement = null
let lastArenaPlacement = null
let lastMazeArenaPlacement = null
let lastMazeBrushes = []
let lastArenaBrushes = []
let lastMazeArenaBrushes = []
let lastLevelBuilderGeneratedBrushes = []
let lastLevelBuilderGeneratedType = null
let activeGenerationCollector = null
let activeGenerationGroup = null
let mazeGenerationCount = 0
let arenaGenerationCount = 0
let lastMazeGroupId = null
let lastArenaGroupId = null
let lastMazeArenaGroupId = null

const LEVEL_BUILDER_VOLUME_TYPES = new Set(['maze', 'maze-arena', 'arena'])

function isLevelBuilderVolume(mesh) {
  return Boolean(mesh?.userData?.isLevelBuilderVolume) && LEVEL_BUILDER_VOLUME_TYPES.has(mesh.userData.levelBuilderType)
}

function getSelectedLevelBuilderVolume(type = null) {
  if (!isLevelBuilderVolume(selectedBrush)) return null
  if (type && selectedBrush.userData.levelBuilderType !== type) return null
  return selectedBrush
}

function getLevelBuilderVolumes(type = null) {
  return brushes.filter((brush) => {
    if (!isLevelBuilderVolume(brush)) return false
    return type ? brush.userData.levelBuilderType === type : true
  })
}

function getPrimaryLevelBuilderVolume(type) {
  const selected = getSelectedLevelBuilderVolume(type)
  if (selected) return selected
  return getLevelBuilderVolumes(type)[0] ?? null
}

function removeLevelBuilderVolume(mesh) {
  if (!isLevelBuilderVolume(mesh)) return
  const idx = brushes.indexOf(mesh)
  if (idx !== -1) brushes.splice(idx, 1)
  if (selectedBrush === mesh) selectBrush(null)
  removeOutline(mesh)
  scene.remove(mesh)
  mesh.geometry?.dispose?.()
  mesh.material?.dispose?.()
}

function updateLevelBuilderTypeSelect(type) {
  const levelBuilderTypeSelect = document.getElementById('level-builder-type')
  if (!levelBuilderTypeSelect) return
  if (LEVEL_BUILDER_VOLUME_TYPES.has(type)) levelBuilderTypeSelect.value = type
}

function getRequestedLevelBuilderType() {
  const selectedType = getSelectedLevelBuilderVolume()?.userData?.levelBuilderType
  if (selectedType && LEVEL_BUILDER_VOLUME_TYPES.has(selectedType)) return selectedType
  const levelBuilderTypeSelect = document.getElementById('level-builder-type')
  const requestedType = levelBuilderTypeSelect?.value
  if (requestedType && LEVEL_BUILDER_VOLUME_TYPES.has(requestedType)) return requestedType
  return 'maze'
}


function beginGenerationCollector() {
  activeGenerationCollector = []
  return activeGenerationCollector
}

function endGenerationCollector() {
  const collected = activeGenerationCollector ?? []
  activeGenerationCollector = null
  activeGenerationGroup = null
  return collected
}

function shortId(id) {
  return String(id ?? '').slice(0, 8) || 'no-id'
}

function setLastLevelBuilderGeneratedEntities(type, brushesList) {
  lastLevelBuilderGeneratedType = type
  lastLevelBuilderGeneratedBrushes = Array.isArray(brushesList) ? [...brushesList] : []
  renderLevelBuilderEntitiesList()
}

function getLastLevelBuilderGeneratedEntities() {
  return lastLevelBuilderGeneratedBrushes.filter((mesh) => mesh?.parent && brushes.includes(mesh))
}

function updateIterateButtons() {
  const mazeBtn = document.getElementById('btn-iterate-maze')
  if (mazeBtn) mazeBtn.disabled = !lastMazeState
  const arenaBtn = document.getElementById('btn-iterate-arena')
  if (arenaBtn) arenaBtn.disabled = !lastArenaState
  const mazeArenaBtn = document.getElementById('btn-iterate-maze-arena')
  if (mazeArenaBtn) mazeArenaBtn.disabled = !lastMazeArenaState
}


function updateMazePreviewVisibility() {
  const checkbox = document.getElementById('maze-preview-visible')
  if (checkbox) checkbox.checked = true
  getLevelBuilderVolumes('maze').forEach((mesh) => {
    mesh.visible = true
  })
  getLevelBuilderVolumes('maze-arena').forEach((mesh) => {
    mesh.visible = true
  })
}

function updateArenaPreviewVisibility() {
  const checkbox = document.getElementById('arena-preview-visible')
  if (checkbox) checkbox.checked = true
  getLevelBuilderVolumes('arena').forEach((mesh) => {
    mesh.visible = true
  })
}

// --- Light State ---
const lights = [] // { light, helper, type: 'point'|'spot'|'directional'|'ambient' }
let selectedLight = null

initMaterialSystem({
  baseUrl,
  maxAnisotropy,
  renderer,
  lights,
  dirLight,
  brushes,
})

setState({
  brushes,
  lights,
})

const LIGHT_HELPER_COLOR = 0xffdd88
const POINT_LIGHT_HELPER_RADIUS = 0.2
const AMBIENT_LIGHT_HELPER_SIZE = 0.35
const SPOT_LIGHT_CONE_LENGTH = 1.2
const SPOT_LIGHT_CONE_RADIUS = 0.35
const DIRECTIONAL_LIGHT_HELPER_RADIUS = 0.18
const DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH = 0.9
const DIRECTIONAL_LIGHT_HELPER_CONE_RADIUS = 0.25
const LIGHT_BASE_DIRECTION = new THREE.Vector3(0, -1, 0)
const lightTransformState = {
  baseDistance: null,
}

// --- Undo Stack ---
const MAX_UNDO = 50
const undoStack = []

function pushUndoState() {
  const state = serializeLevel()
  if (undoStack.length >= MAX_UNDO) undoStack.shift()
  undoStack.push(JSON.stringify(state))
}

function undo() {
  if (rampCreatorState.active && rampUndoStack.length > 0) {
    undoRampPoint()
    return
  }
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

function createBrushMesh(size = [2, 2, 2], position = [0, 1, 0], depthBias = 0, textureInfo = null) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  setBoxUVs(geometry, size[0], size[1], size[2])
  const resolvedInfo = resolveBrushTextureInfo(textureInfo)
  const texture = resolveBrushTexture(resolvedInfo)
  const material = createBrushMaterial(texture, depthBias, useLitMaterials)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'box'
  mesh.userData.size = [...size]
  if (resolvedInfo.key) mesh.userData.textureKey = resolvedInfo.key
  if (typeof resolvedInfo.index === 'number') mesh.userData.textureIndex = resolvedInfo.index
  return mesh
}

function createCylinderMesh(radius = 1, height = 2, position = [0, 1, 0], depthBias = 0, textureInfo = null) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16, 1)
  setCylinderUVs(geometry, radius, height, 16, 1)
  const resolvedInfo = resolveBrushTextureInfo(textureInfo)
  const texture = resolveBrushTexture(resolvedInfo)
  const material = createBrushMaterial(texture, depthBias, useLitMaterials)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'cylinder'
  mesh.userData.radius = radius
  mesh.userData.height = height
  if (resolvedInfo.key) mesh.userData.textureKey = resolvedInfo.key
  if (typeof resolvedInfo.index === 'number') mesh.userData.textureIndex = resolvedInfo.index
  return mesh
}

function addFloorBrush() {
  pushUndoState()
  const size = [10, 0.2, 10]
  const position = [0, 0.1, 0]
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  mesh.userData.subtype = 'floor'
  scene.add(mesh)
  brushes.push(mesh)
  selectBrush(mesh)
  setCurrentTool('translate')
  setTransformMode('translate')
  focusCameraOnObject(mesh)
  updateSceneList()
}

function addWallBrush() {
  pushUndoState()
  const size = [10, 4, 0.2]
  const position = [0, 2, 0]
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  mesh.userData.subtype = 'wall'
  scene.add(mesh)
  brushes.push(mesh)
  selectBrush(mesh)
  setCurrentTool('translate')
  setTransformMode('translate')
  focusCameraOnObject(mesh)
  updateSceneList()
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
  focusCameraOnObject(mesh)
  updateSceneList()
}

/** Player height in brush-editor units (1 unit = 1 m). Matches occult-shooter PLAYER_HEIGHT_CM (175 cm). */
const PLAYER_HEIGHT_UNITS = 1.75
/** Approximate human shoulder width in units (~50 cm). */
const PLAYER_RADIUS_UNITS = 0.25

function createPlayerStartMesh(position = [0, 0, 0]) {
  const coneGeom = new THREE.ConeGeometry(PLAYER_RADIUS_UNITS, PLAYER_HEIGHT_UNITS, 12)
  const material = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.9,
  })
  const mesh = new THREE.Mesh(coneGeom, material)
  mesh.name = 'player_start'
  mesh.position.set(...position)
  mesh.userData.isBrush = true
  mesh.userData.type = 'player_start'
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function addPlayerStartMarker() {
  pushUndoState()
  const mesh = createPlayerStartMesh([0, 0, 0])
  scene.add(mesh)
  brushes.push(mesh)
  selectBrush(mesh)
  setCurrentTool('translate')
  setTransformMode('translate')
  focusCameraOnObject(mesh)
  updateSceneList()
}

// --- Ramp creator tool (four-point selection: two per end) ---
const rampCreatorState = { active: false, pointA: null, pointB: null, pointC: null, pointD: null }
const rampUndoStack = []
const rampPointMarkers = []
let rampPreviewMesh = null
let rampCursorPreview = null
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const groundIntersect = new THREE.Vector3()

const RAMP_MARKER_COLORS = { A: 0x00ff00, B: 0x00cc00, C: 0xff8800, D: 0xff6600 }
function addRampPointMarker(point, label) {
  const geometry = new THREE.SphereGeometry(0.15, 16, 12)
  const material = new THREE.MeshBasicMaterial({
    color: RAMP_MARKER_COLORS[label] ?? 0xffffff,
    transparent: true,
    opacity: 0.9,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(point[0], point[1], point[2])
  mesh.userData.rampMarker = true
  mesh.userData.markerLabel = label
  scene.add(mesh)
  rampPointMarkers.push(mesh)
  return mesh
}

function clearRampPointMarkers() {
  rampPointMarkers.forEach((m) => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.dispose()
  })
  rampPointMarkers.length = 0
}

function computeRampParams(pointA, pointB, rampWidth, scale = 1) {
  const a = new THREE.Vector3(pointA[0], pointA[1], pointA[2])
  const b = new THREE.Vector3(pointB[0], pointB[1], pointB[2])
  const dy = b.y - a.y
  const lowEnd = dy >= 0 ? a : b
  const highEnd = dy >= 0 ? b : a
  const dir = new THREE.Vector3().subVectors(highEnd, lowEnd)
  const rampRun = Math.max(0.01, Math.sqrt(dir.x * dir.x + dir.z * dir.z))
  const rampRise = Math.max(0.01, dir.y)
  const slopeAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(rampRise, rampRun))

  const s = Math.max(0.5, Math.min(2, scale))

  return {
    rampWidth: rampWidth * s,
    rampRun: rampRun * s,
    effectiveRise: rampRise * s,
    posX: lowEnd.x,
    posY: lowEnd.y,
    posZ: lowEnd.z,
    rotY: Math.atan2(dir.x, dir.z),
    slopeAngleDeg,
  }
}

function computeRampParamsFrom4Points(pointA, pointB, pointC, pointD, scale = 1) {
  const a = new THREE.Vector3(pointA[0], pointA[1], pointA[2])
  const b = new THREE.Vector3(pointB[0], pointB[1], pointB[2])
  const c = new THREE.Vector3(pointC[0], pointC[1], pointC[2])
  const d = new THREE.Vector3(pointD[0], pointD[1], pointD[2])

  const lowCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const highCenter = new THREE.Vector3().addVectors(c, d).multiplyScalar(0.5)

  const rampDir = new THREE.Vector3().subVectors(highCenter, lowCenter)
  const rampRun = Math.max(0.01, Math.sqrt(rampDir.x * rampDir.x + rampDir.z * rampDir.z))
  const rampRise = Math.max(0.01, rampDir.y)
  const slopeAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(rampRise, rampRun))

  const lowEdgeLen = a.distanceTo(b)
  const highEdgeLen = c.distanceTo(d)
  const rampWidth = Math.max(0.01, (lowEdgeLen + highEdgeLen) * 0.5)

  const s = Math.max(0.5, Math.min(2, scale))

  const rotY = Math.atan2(rampDir.x, rampDir.z)

  return {
    rampWidth: rampWidth * s,
    rampRun: rampRun * s,
    effectiveRise: rampRise * s,
    posX: lowCenter.x,
    posY: lowCenter.y,
    posZ: lowCenter.z,
    rotY,
    slopeAngleDeg,
  }
}

function updateRampPreview() {
  if (rampPreviewMesh) {
    scene.remove(rampPreviewMesh)
    rampPreviewMesh.geometry.dispose()
    rampPreviewMesh.material.dispose()
    rampPreviewMesh = null
  }
  if (!rampCreatorState.pointA || !rampCreatorState.pointB || !rampCreatorState.pointC || !rampCreatorState.pointD) return
  const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
  const geometry = createRampGeometryFrom4Points(
    rampCreatorState.pointA,
    rampCreatorState.pointB,
    rampCreatorState.pointC,
    rampCreatorState.pointD,
    rampScale
  )
  const material = new THREE.MeshBasicMaterial({
    color: 0x4a9eff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  rampPreviewMesh = new THREE.Mesh(geometry, material)
  rampPreviewMesh.userData.rampPreview = true
  rampPreviewMesh.renderOrder = -1
  scene.add(rampPreviewMesh)
}

function clearRampPreview() {
  if (rampPreviewMesh) {
    scene.remove(rampPreviewMesh)
    rampPreviewMesh.geometry.dispose()
    rampPreviewMesh.material.dispose()
    rampPreviewMesh = null
  }
}

function getRampSnapSizeCm() {
  const el = document.getElementById('ramp-snap-size')
  if (!el) return 0
  const v = parseFloat(el.value)
  return Number.isFinite(v) && v >= 0 ? v : 0
}

function snapPointToGrid(point, gridSizeCm) {
  if (!gridSizeCm || gridSizeCm <= 0) return point
  const step = gridSizeCm / CM_PER_UNIT
  return [
    Math.round(point[0] / step) * step,
    Math.round(point[1] / step) * step,
    Math.round(point[2] / step) * step,
  ]
}

function pickPoint3DFromCoords(clientX, clientY) {
  const rect = pickRectElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  let pt = null
  const intersects = raycaster.intersectObjects(brushes, true)
  for (const hit of intersects) {
    if (hit.object.userData?.rampMarker) continue
    const brush = findBrushFromObject(hit.object)
    if (brush && brush.userData?.type !== 'ramp') {
      pt = hit.point.toArray()
      break
    }
  }

  if (!pt && raycaster.ray.intersectPlane(groundPlane, groundIntersect)) {
    pt = groundIntersect.toArray()
  }
  if (pt && rampCreatorState.active) {
    const snapCm = getRampSnapSizeCm()
    if (snapCm > 0) pt = snapPointToGrid(pt, snapCm)
  }
  return pt
}

function pickPoint3D(event) {
  return pickPoint3DFromCoords(event.clientX, event.clientY)
}

function ensureRampCursorPreview() {
  if (rampCursorPreview) return rampCursorPreview
  const geometry = new THREE.SphereGeometry(0.12, 12, 8)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
  })
  rampCursorPreview = new THREE.Mesh(geometry, material)
  rampCursorPreview.visible = false
  rampCursorPreview.userData.rampCursorPreview = true
  rampCursorPreview.renderOrder = 10
  rampCursorPreview.material.depthWrite = false
  scene.add(rampCursorPreview)
  return rampCursorPreview
}

function updateRampCursorPreview(clientX, clientY) {
  if (!rampCreatorState.active) return
  const preview = ensureRampCursorPreview()
  const rect = pickRectElement.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    preview.visible = false
    return
  }
  const pt = pickPoint3DFromCoords(clientX, clientY)
  if (pt) {
    preview.position.set(pt[0], pt[1], pt[2])
    preview.visible = true
  } else {
    preview.visible = false
  }
}

function hideRampCursorPreview() {
  if (rampCursorPreview) rampCursorPreview.visible = false
}

function startRampCreator() {
  setEditorMode('brush')
  selectBrush(null)
  rampCreatorState.active = true
  rampCreatorState.pointA = null
  rampCreatorState.pointB = null
  rampCreatorState.pointC = null
  rampCreatorState.pointD = null
  document.getElementById('ramp-creator-panel')?.classList.remove('hidden')
  document.getElementById('panel-brush-tools')?.closest('.panel')?.classList.remove('collapsed')
  updateRampCreatorStatus()
  document.getElementById('btn-ramp-place').disabled = true
  showToast('Click first point of low end (e.g. left corner).', { type: 'info' })
}

function undoRampPoint() {
  if (rampUndoStack.length === 0) return
  const prev = rampUndoStack.pop()
  rampCreatorState.pointA = prev.pointA
  rampCreatorState.pointB = prev.pointB
  rampCreatorState.pointC = prev.pointC
  rampCreatorState.pointD = prev.pointD
  clearRampPointMarkers()
  if (prev.pointA) addRampPointMarker(prev.pointA, 'A')
  if (prev.pointB) addRampPointMarker(prev.pointB, 'B')
  if (prev.pointC) addRampPointMarker(prev.pointC, 'C')
  if (prev.pointD) addRampPointMarker(prev.pointD, 'D')
  updateRampPreview()
  updateRampCreatorStatus()
  document.getElementById('btn-ramp-place').disabled = !prev.pointA || !prev.pointB || !prev.pointC || !prev.pointD
  showToast(prev.pointD ? 'Removed point D.' : prev.pointC ? 'Removed point C.' : prev.pointB ? 'Removed point B.' : 'Removed point A.', { type: 'info' })
}

function cancelRampCreator() {
  rampCreatorState.active = false
  rampCreatorState.pointA = null
  rampCreatorState.pointB = null
  rampCreatorState.pointC = null
  rampCreatorState.pointD = null
  rampUndoStack.length = 0
  clearRampPointMarkers()
  clearRampPreview()
  hideRampCursorPreview()
  document.getElementById('ramp-creator-panel')?.classList.add('hidden')
}

function updateRampCreatorStatus() {
  const status = document.getElementById('ramp-creator-status')
  if (!status) return
  const { pointA, pointB, pointC, pointD } = rampCreatorState
  if (!pointA) {
    status.textContent = '1/4: Click first point of low end'
  } else if (!pointB) {
    status.textContent = '2/4: Click second point of low end'
  } else if (!pointC) {
    status.textContent = '3/4: Click first point of high end'
  } else if (!pointD) {
    status.textContent = '4/4: Click second point of high end'
  } else {
    const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
    const a = new THREE.Vector3(pointA[0], pointA[1], pointA[2])
    const b = new THREE.Vector3(pointB[0], pointB[1], pointB[2])
    const c = new THREE.Vector3(pointC[0], pointC[1], pointC[2])
    const d = new THREE.Vector3(pointD[0], pointD[1], pointD[2])
    const lowCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
    const highCenter = new THREE.Vector3().addVectors(c, d).multiplyScalar(0.5)
    const rampDir = new THREE.Vector3().subVectors(highCenter, lowCenter)
    const rampRun = Math.sqrt(rampDir.x * rampDir.x + rampDir.z * rampDir.z)
    const rampRise = rampDir.y
    const slopeAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(rampRise, rampRun))
    const runM = (rampRun * CM_PER_UNIT / 100).toFixed(1)
    const riseM = (rampRise * CM_PER_UNIT / 100).toFixed(1)
    const lowW = a.distanceTo(b) * CM_PER_UNIT / 100
    const highW = c.distanceTo(d) * CM_PER_UNIT / 100
    status.textContent = `Preview: ${lowW.toFixed(1)}–${highW.toFixed(1)}m × ${runM}m run × ${riseM}m rise, ${slopeAngleDeg.toFixed(1)}° slope. Place Ramp.`
  }
}

function handleRampCreatorPick(event) {
  if (event.button !== 0) return
  if (viewport && !viewport.contains(event.target)) return
  const pt = pickPoint3D(event)
  if (!pt) {
    showToast('Click on the floor, a wall, or the ground to place a point.', { type: 'info' })
    return
  }
  const { pointA, pointB, pointC, pointD } = rampCreatorState
  if (!pointA) {
    rampUndoStack.push({ pointA: null, pointB: null, pointC: null, pointD: null })
    rampCreatorState.pointA = pt
    addRampPointMarker(pt, 'A')
    showToast('Low end point 1 (green). Click second point of low end.', { type: 'success' })
  } else if (!pointB) {
    rampUndoStack.push({ pointA: [...pointA], pointB: null, pointC: null, pointD: null })
    rampCreatorState.pointB = pt
    addRampPointMarker(pt, 'B')
    showToast('Low end complete. Click first point of high end (orange). Undo to remove last point.', { type: 'success' })
  } else if (!pointC) {
    rampUndoStack.push({ pointA: [...pointA], pointB: [...pointB], pointC: null, pointD: null })
    rampCreatorState.pointC = pt
    addRampPointMarker(pt, 'C')
    showToast('High end point 1. Click second point of high end. Undo to remove last point.', { type: 'success' })
  } else if (!pointD) {
    rampUndoStack.push({ pointA: [...pointA], pointB: [...pointB], pointC: [...pointC], pointD: null })
    rampCreatorState.pointD = pt
    addRampPointMarker(pt, 'D')
    updateRampPreview()
    showToast('All 4 points set. Adjust scale or click Place Ramp. Undo to remove last point.', { type: 'success' })
  } else {
    rampCreatorState.pointA = pt
    rampCreatorState.pointB = null
    rampCreatorState.pointC = null
    rampCreatorState.pointD = null
    clearRampPointMarkers()
    clearRampPreview()
    addRampPointMarker(pt, 'A')
    showToast('Reset. Click first point of low end.', { type: 'info' })
  }
  updateRampCreatorStatus()
  const allFour = rampCreatorState.pointA && rampCreatorState.pointB && rampCreatorState.pointC && rampCreatorState.pointD
  document.getElementById('btn-ramp-place').disabled = !allFour
}

function placeRampFromCreator() {
  const { pointA, pointB, pointC, pointD } = rampCreatorState
  if (!pointA || !pointB || !pointC || !pointD) return
  const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
  pushUndoState()
  addRampBrushFrom4Points(pointA, pointB, pointC, pointD, rampScale)
  const mesh = brushes[brushes.length - 1]
  selectBrush(mesh)
  setCurrentTool('translate')
  setTransformMode('translate')
  focusCameraOnObject(mesh)
  cancelRampCreator()
  showToast('Ramp placed.', { type: 'success' })
}

function isRampCreatorActive() {
  return rampCreatorState.active
}

function addBrushMesh(size, position) {
  const mesh = createBrushMesh(size, position, brushes.length * 4)
  mesh.userData.id = crypto.randomUUID()
  scene.add(mesh)
  brushes.push(mesh)
  updateSceneList()
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
  const group = new THREE.Group()
  const sphereGeom = new THREE.SphereGeometry(DIRECTIONAL_LIGHT_HELPER_RADIUS, 12, 8)
  const coneGeom = new THREE.CylinderGeometry(0, DIRECTIONAL_LIGHT_HELPER_CONE_RADIUS, DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH, 12)
  const material = new THREE.MeshBasicMaterial({
    color: light.color.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const sphere = new THREE.Mesh(sphereGeom, material)
  const cone = new THREE.Mesh(coneGeom, material)
  cone.position.y = -DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH / 2
  sphere.castShadow = false
  sphere.receiveShadow = false
  cone.castShadow = false
  cone.receiveShadow = false
  group.add(sphere)
  group.add(cone)
  return group
}

function createAmbientLightHelper(light) {
  const geometry = new THREE.PlaneGeometry(AMBIENT_LIGHT_HELPER_SIZE, AMBIENT_LIGHT_HELPER_SIZE)
  const material = new THREE.MeshBasicMaterial({
    color: light.color.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function updateLightHelperColor(entry) {
  if (!entry?.helper) return
  entry.helper.traverse((child) => {
    if (child.material?.color) {
      child.material.color.copy(entry.light.color)
    }
  })
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
  focusCameraOnObject(light)
  updateSceneList()
  updateShadowState(useLitMaterials)
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
  focusCameraOnObject(light)
  updateSceneList()
  updateShadowState(useLitMaterials)
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
  focusCameraOnObject(light)
  updateSceneList()
  updateShadowState(useLitMaterials)
}

function addAmbientLight() {
  pushUndoState()
  const light = new THREE.AmbientLight(0x404040, 0.5)
  light.position.set(0, 3, 0)
  const helper = createAmbientLightHelper(light)
  light.add(helper)
  scene.add(light)
  const entry = { light, helper, type: 'ambient' }
  helper.userData.lightEntry = entry
  lights.push(entry)
  selectBrush(null)
  selectLight(entry)
  focusCameraOnObject(light)
  updateSceneList()
  updateShadowState(useLitMaterials)
}

function addImportedLight(light) {
  if (!light || !light.isLight) return
  const type = light.isPointLight
    ? 'point'
    : light.isSpotLight
      ? 'spot'
      : light.isDirectionalLight
        ? 'directional'
        : light.isAmbientLight
          ? 'ambient'
          : null
  if (!type) return
  let helper = null
  if (type === 'point') helper = createPointLightHelper(light)
  if (type === 'spot') helper = createSpotLightHelper(light)
  if (type === 'directional') helper = createDirectionalLightHelper(light)
  if (type === 'ambient') helper = createAmbientLightHelper(light)
  if (helper) {
    light.add(helper)
  }
  if (light.parent) light.parent.remove(light)
  scene.add(light)
  const entry = { light, helper, type }
  if (helper) helper.userData.lightEntry = entry
  lights.push(entry)
  updateLightControls()
  updateSceneList()
  updateShadowState(useLitMaterials)
}

function getLightHelpers() {
  return lights
    .filter((e) => e.helper && e.helper.isObject3D)
    .map((e) => e.helper)
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
  if (!entry && selectedBrush) {
    updateLightControls()
    return
  }
  if (selectedBrush) {
    removeOutline(selectedBrush)
    selectedBrush = null
    transformControls.detach()
  }
  if (entry) {
    if (!entry.light || !entry.light.isObject3D) {
      transformControls.detach()
      transformControls.enabled = false
      transformControlsHelper.visible = false
      selectedLight = null
      updateLightControls()
      return
    }
    if (entry.type !== 'ambient') {
      const allowedModes = new Set(['translate', 'rotate', 'scale'])
      let mode = allowedModes.has(currentTool) ? currentTool : 'translate'
      if (entry.type === 'directional' && mode === 'scale') mode = 'translate'
      transformControls.setMode(mode)
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
  updateLightControls()
  renderLevelBuilderEntitiesList()
}

function focusCameraOnObject(object) {
  if (!object || !camera || !orbitControls) return
  const box = new THREE.Box3().setFromObject(object)
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    const distance = Math.max(2, radius * 3)
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    orbitControls.target.copy(center)
    camera.position.copy(center).addScaledVector(dir, -distance)
    orbitControls.update()
  } else if (object.position) {
    orbitControls.target.copy(object.position)
    orbitControls.update()
  }
}

initUIPanels({
  brushes,
  lights,
  baseLightEntries,
  selectBrush,
  selectLight,
  focusCameraOnObject,
})
initExportSystem({ saveGlb })

function updateLightControls() {
  const empty = document.getElementById('light-controls-empty')
  const groupPoint = document.getElementById('light-controls-point')
  const groupSpot = document.getElementById('light-controls-spot')
  const groupAmbient = document.getElementById('light-controls-ambient')
  const groupDirectional = document.getElementById('light-controls-directional')
  if (!empty || !groupPoint || !groupSpot || !groupAmbient || !groupDirectional) return

  const groups = [groupPoint, groupSpot, groupAmbient, groupDirectional]
  const hideAll = () => groups.forEach((g) => g.classList.add('hidden'))
  const showGroup = (group) => {
    hideAll()
    empty.classList.add('hidden')
    group.classList.remove('hidden')
  }

  if (!selectedLight) {
    hideAll()
    empty.classList.remove('hidden')
    return
  }

  const light = selectedLight.light
  const colorHex = `#${light.color.getHexString()}`

  if (selectedLight.type === 'point') {
    showGroup(groupPoint)
    document.getElementById('point-light-color').value = colorHex
    const intensity = light.intensity ?? 1
    const radius = light.distance ?? 0
    document.getElementById('point-light-intensity').value = intensity
    document.getElementById('point-light-intensity-value').textContent = intensity
    document.getElementById('point-light-radius').value = radius
    document.getElementById('point-light-radius-value').textContent = radius
  } else if (selectedLight.type === 'spot') {
    showGroup(groupSpot)
    document.getElementById('spot-light-color').value = colorHex
    const intensity = light.intensity ?? 1
    const radius = light.distance ?? 0
    const angleDeg = Math.round(THREE.MathUtils.radToDeg(light.angle ?? Math.PI / 6))
    document.getElementById('spot-light-intensity').value = intensity
    document.getElementById('spot-light-intensity-value').textContent = intensity
    document.getElementById('spot-light-radius').value = radius
    document.getElementById('spot-light-radius-value').textContent = radius
    document.getElementById('spot-light-angle').value = angleDeg
    document.getElementById('spot-light-angle-value').textContent = angleDeg
  } else if (selectedLight.type === 'ambient') {
    showGroup(groupAmbient)
    document.getElementById('ambient-light-color').value = colorHex
    const intensity = light.intensity ?? 0.5
    document.getElementById('ambient-light-intensity').value = intensity
    document.getElementById('ambient-light-intensity-value').textContent = intensity
  } else if (selectedLight.type === 'directional') {
    showGroup(groupDirectional)
    document.getElementById('directional-light-color').value = colorHex
    const intensity = light.intensity ?? 1
    document.getElementById('directional-light-intensity').value = intensity
    document.getElementById('directional-light-intensity-value').textContent = intensity
    const dir = light.target.position.clone().sub(light.position)
    if (dir.lengthSq() === 0) dir.set(0, -1, 0)
    dir.normalize()
    document.getElementById('directional-light-dir-x').value = dir.x.toFixed(2)
    document.getElementById('directional-light-dir-y').value = dir.y.toFixed(2)
    document.getElementById('directional-light-dir-z').value = dir.z.toFixed(2)
  }
}

function deleteSelectedLight() {
  if (!selectedLight) return
  if (selectedLight.isDefault) return
  pushUndoState()
  const entry = selectedLight
  const idx = lights.indexOf(entry)
  if (idx !== -1) lights.splice(idx, 1)
  if (entry.light.target) scene.remove(entry.light.target)
  scene.remove(entry.light)
  if (entry.helper) {
    entry.helper.traverse((child) => {
      child.geometry?.dispose()
      if (child.material && child.material.dispose) child.material.dispose()
    })
  }
  selectLight(null)
  updateSceneList()
  showToast('Light removed.', {
    type: 'undo',
    recoveryLabel: 'Undo',
    onRecovery: undo,
  })
}

function updateSpotLightHelpers() {
  lights.forEach((entry) => {
    if (entry.type !== 'spot' || !entry.helper) return
    const light = entry.light
    entry.helper.lookAt(light.target.position)
    entry.helper.rotateX(-Math.PI / 2)
  })
}

function updateDirectionalLightHelpers() {
  lights.forEach((entry) => {
    if (entry.type !== 'directional' || !entry.helper) return
    const light = entry.light
    entry.helper.lookAt(light.target.position)
    entry.helper.rotateX(-Math.PI / 2)
  })
}

function updateLightDirectionFromRotation(entry) {
  if (!entry || (entry.type !== 'spot' && entry.type !== 'directional')) return
  const light = entry.light
  const dir = LIGHT_BASE_DIRECTION.clone().applyQuaternion(light.quaternion)
  light.target.position.copy(light.position).add(dir)
  updateSpotLightHelpers()
  updateDirectionalLightHelpers()
  updateLightControls()
}

function applyLightScaleToDistance(entry) {
  if (!entry || (entry.type !== 'point' && entry.type !== 'spot')) return
  const light = entry.light
  const base = lightTransformState.baseDistance ?? light.distance ?? 0
  const scale = Math.max(light.scale.x, light.scale.y, light.scale.z)
  light.distance = Math.max(0, base * scale)
  light.scale.set(1, 1, 1)
  updateLightControls()
}

function getMazeControls() {
  const flatFloorSizeCm = parseFloat(document.getElementById('maze-flat-floor-size')?.value ?? '20')
  const wallHeightCm = Math.max(20, parseFloat(document.getElementById('maze-height')?.value ?? '200') || 200)
  return {
    cols: parseInt(document.getElementById('maze-cols').value, 10),
    rows: parseInt(document.getElementById('maze-rows').value, 10),
    spaceBetweenWalls: parseFloat(document.getElementById('maze-space').value) / CM_PER_UNIT,
    wallThickness: parseFloat(document.getElementById('maze-thickness').value) / CM_PER_UNIT,
    wallHeight: wallHeightCm / CM_PER_UNIT,
    exitWidth: parseInt(document.getElementById('maze-exit-width').value, 10),
    centerRoomSize: parseInt(document.getElementById('maze-center-size').value, 10),
    layout: document.getElementById('maze-start-from-center').checked ? 'center-out' : 'out-out',
    roomCount: parseInt(document.getElementById('maze-room-count')?.value ?? '0', 10) || 0,
    flatFloorSizeCm,
    flatFloorSize: flatFloorSizeCm / CM_PER_UNIT,
  }
}

function getMazeArenaControls() {
  return {
    cols: parseInt(document.getElementById('maze-arena-cols')?.value ?? '12', 10),
    rows: parseInt(document.getElementById('maze-arena-rows')?.value ?? '12', 10),
    arenaCount: parseInt(document.getElementById('maze-arena-arena-count')?.value ?? '4', 10),
    spaceBetweenWalls: parseFloat(document.getElementById('maze-arena-space')?.value ?? '200') / CM_PER_UNIT,
    wallThickness: parseFloat(document.getElementById('maze-arena-thickness')?.value ?? '15') / CM_PER_UNIT,
    wallHeight: parseFloat(document.getElementById('maze-arena-height')?.value ?? '200') / CM_PER_UNIT,
    density: parseFloat(document.getElementById('maze-arena-density')?.value ?? '0.25'),
    buildingCount: parseInt(document.getElementById('maze-arena-buildings')?.value ?? '2', 10),
  }
}

function getArenaControls() {
  const wallHeightCm = parseFloat(document.getElementById('arena-height').value)
  const obstacleCm = parseFloat(document.getElementById('arena-obstacle-height').value)
  const wallHeight = wallHeightCm / CM_PER_UNIT
  const obstacleHeight = Math.min(obstacleCm, wallHeightCm) / CM_PER_UNIT
  return {
    cols: parseInt(document.getElementById('arena-cols').value, 10),
    rows: parseInt(document.getElementById('arena-rows').value, 10),
    tileSize: parseFloat(document.getElementById('arena-tile').value) / CM_PER_UNIT,
    wallHeight,
    wallHeightCm,
    obstacleHeight,
    density: parseFloat(document.getElementById('arena-density').value),
    buildingCount: parseInt(document.getElementById('arena-buildings').value, 10),
    smoothingPasses: parseInt(document.getElementById('arena-smoothing').value, 10),
    corridorWidth: parseInt(document.getElementById('arena-corridor').value, 10),
    exitWidth: parseInt(document.getElementById('arena-exit-width').value, 10),
    candidates: parseInt(document.getElementById('arena-candidates').value, 10),
  }
}

function mazeGridToMeshes(grid, cols, rows, spaceBetweenWalls, wallThickness, wallHeight, offset = [0, 0, 0], rotation = null) {
  const w = cols * 2 + 1
  const h = rows * 2 + 1
  const unitSize = spaceBetweenWalls
  const segmentLength = unitSize * 2
  const ox = ((w - 1) / 2) * unitSize
  const oz = ((h - 1) / 2) * unitSize
  const [offX, offY, offZ] = offset

  const isOuterCorner = (x, z) =>
    (x === 0 && z === 0) || (x === w - 1 && z === 0) || (x === 0 && z === h - 1) || (x === w - 1 && z === h - 1)
  const onBoundary = (x, z) => x === 0 || x === w - 1 || z === 0 || z === h - 1

  for (let x = 0; x < w; x++) {
    for (let z = 0; z < h; z++) {
      if (grid[x][z] !== 1) continue
      const horz = x % 2 === 0
      const vert = z % 2 === 0
      if (horz && vert && !isOuterCorner(x, z) && !onBoundary(x, z)) continue
      const localX = x * unitSize - ox
      const localZ = z * unitSize - oz
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
      const rotated = rotateArenaPoint(localX, localZ, rotation)
      const px = rotated.x + offX
      const pz = rotated.z + offZ
      addMazeBrushMesh([sx, wallHeight, sz], [px, wallHeight / 2 + offY, pz], rotation)
    }
  }
}

function rotateArenaPoint(x, z, rotation) {
  if (!rotation) return { x, z }
  const vec = new THREE.Vector3(x, 0, z)
  vec.applyEuler(rotation)
  return { x: vec.x, z: vec.z }
}

function addMazeBrushMesh(size, position, rotation) {
  const mesh = addBrushMesh(size, position)
  applyMazeWallTexture(mesh)
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'maze'
  mesh.userData.subtype = 'maze-wall'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  mesh.name = activeGenerationGroup
    ? `${activeGenerationGroup}_maze-wall_${String(mesh.userData.id ?? '').slice(0, 8) || 'no-id'}`
    : `maze-wall_${String(mesh.userData.id ?? '').slice(0, 8) || 'no-id'}`
  if (rotation) mesh.rotation.copy(rotation)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function addMazeFloorCell(size, position, rotation) {
  const mesh = addBrushMesh(size, position)
  applyMazeFloorTexture(mesh)
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'maze'
  mesh.userData.subtype = 'maze-floor'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  mesh.name = activeGenerationGroup
    ? `${activeGenerationGroup}_maze-floor_${String(mesh.userData.id ?? '').slice(0, 8) || 'no-id'}`
    : `maze-floor_${String(mesh.userData.id ?? '').slice(0, 8) || 'no-id'}`
  if (rotation) mesh.rotation.copy(rotation)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function createWedgeGeometry(rampWidth, rampRise, rampRun) {
  const w = rampWidth / 2
  const r = rampRun / 2
  const h = rampRise

  const slopeLen = Math.sqrt(rampRun * rampRun + rampRise * rampRise)

  const positions = []
  const uvs = []

  positions.push(-w, 0, -r, w, 0, -r, w, 0, r, -w, 0, -r, w, 0, r, -w, 0, r)
  uvs.push(0, 0, rampWidth, 0, rampWidth, rampRun, 0, 0, rampWidth, rampRun, 0, rampRun)

  positions.push(-w, 0, -r, -w, 0, r, -w, h, r)
  uvs.push(0, 0, rampRun, 0, rampRun, rampRise)

  positions.push(w, 0, -r, w, h, r, w, 0, r)
  uvs.push(0, 0, rampRun, rampRise, rampRun, 0)

  positions.push(-w, 0, -r, w, 0, -r, w, h, r, -w, 0, -r, w, h, r, -w, h, r)
  uvs.push(0, 0, rampWidth, 0, rampWidth, slopeLen, 0, 0, rampWidth, slopeLen, 0, slopeLen)

  positions.push(w, 0, r, -w, 0, r, -w, h, r, w, 0, r, -w, h, r, w, h, r)
  uvs.push(0, 0, rampWidth, 0, rampWidth, rampRise, 0, 0, rampWidth, rampRise, 0, rampRise)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()

  return geometry
}

function segmentsIntersectInXZ(ax, az, bx, bz, cx, cz, dx, dz) {
  const denom = (dx - cx) * (bz - az) - (dz - cz) * (bx - ax)
  if (Math.abs(denom) < 1e-10) return false
  const t = ((ax - cx) * (dz - cz) - (az - cz) * (dx - cx)) / denom
  const u = ((ax - cx) * (bz - az) - (az - cz) * (bx - ax)) / denom
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6
}

function createRampGeometryFrom4Points(pointA, pointB, pointC, pointD, scale = 1) {
  const a = new THREE.Vector3(pointA[0], pointA[1], pointA[2])
  const b = new THREE.Vector3(pointB[0], pointB[1], pointB[2])
  const c = new THREE.Vector3(pointC[0], pointC[1], pointC[2])
  const d = new THREE.Vector3(pointD[0], pointD[1], pointD[2])

  const centroid = new THREE.Vector3().addVectors(a, b).add(c).add(d).divideScalar(4)
  const s = Math.max(0.5, Math.min(2, scale))
  if (s !== 1) {
    a.sub(centroid).multiplyScalar(s).add(centroid)
    b.sub(centroid).multiplyScalar(s).add(centroid)
    c.sub(centroid).multiplyScalar(s).add(centroid)
    d.sub(centroid).multiplyScalar(s).add(centroid)
  }

  const slopeNormal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a))
  if (slopeNormal.lengthSq() < 1e-10) {
    slopeNormal.subVectors(d, a).cross(new THREE.Vector3().subVectors(b, a))
  }
  slopeNormal.normalize()

  const projectOntoPlane = (p) => {
    const v = new THREE.Vector3().subVectors(p, centroid)
    const dot = v.dot(slopeNormal)
    return new THREE.Vector3(
      p.x - slopeNormal.x * dot,
      p.y - slopeNormal.y * dot,
      p.z - slopeNormal.z * dot
    )
  }

  const aProj = projectOntoPlane(a)
  const bProj = projectOntoPlane(b)
  const cProj = projectOntoPlane(c)
  const dProj = projectOntoPlane(d)

  const acBdCross = segmentsIntersectInXZ(
    aProj.x, aProj.z, cProj.x, cProj.z,
    bProj.x, bProj.z, dProj.x, dProj.z
  )

  let p0, p1, p2, p3
  if (acBdCross) {
    p0 = aProj
    p1 = bProj
    p2 = cProj
    p3 = dProj
  } else {
    p0 = aProj
    p1 = bProj
    p2 = dProj
    p3 = cProj
  }

  const minY = Math.min(a.y, b.y, c.y, d.y)
  const p0_ = new THREE.Vector3(p0.x, minY, p0.z)
  const p1_ = new THREE.Vector3(p1.x, minY, p1.z)
  const p2_ = new THREE.Vector3(p2.x, minY, p2.z)
  const p3_ = new THREE.Vector3(p3.x, minY, p3.z)

  const baseW = (p0_.distanceTo(p1_) + p2_.distanceTo(p3_)) * 0.5
  const baseD = (p0_.distanceTo(p3_) + p1_.distanceTo(p2_)) * 0.5
  const slopeW = (p0.distanceTo(p1) + p2.distanceTo(p3)) * 0.5
  const slopeLen = (p0.distanceTo(p3) + p1.distanceTo(p2)) * 0.5
  const side0H = p0.distanceTo(p3)
  const side1H = p1.distanceTo(p2)
  const lowW = p0_.distanceTo(p1_)
  const highW = p2_.distanceTo(p3_)
  const lowRise = Math.max(0.01, (p0.y + p1.y) * 0.5 - minY)
  const highRise = Math.max(0.01, (p2.y + p3.y) * 0.5 - minY)

  const positions = []
  const uvs = []
  const pushQuad = (v0, v1, v2, v3, w, h) => {
    positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
    positions.push(v0.x, v0.y, v0.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z)
    uvs.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h)
  }

  pushQuad(p0_, p3_, p2_, p1_, baseW, baseD)
  pushQuad(p0, p1, p2, p3, slopeW, slopeLen)
  pushQuad(p0_, p0, p3, p3_, baseD, side0H)
  pushQuad(p1_, p1, p2, p2_, baseD, side1H)
  pushQuad(p0_, p1_, p1, p0, lowW, lowRise)
  pushQuad(p3_, p2_, p2, p3, highW, highRise)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

function createRampMeshFromParams(size, position, rotation) {
  const [rampWidth, rampRise, rampRun] = size
  const geometry = createWedgeGeometry(rampWidth, rampRise, rampRun)
  geometry.translate(0, 0, rampRun / 2)
  const texture = resolveBrushTexture(resolveBrushTextureInfo({ key: 'maze' }))
  const material = createBrushMaterial(texture, brushes.length * 4, useLitMaterials)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.material.side = THREE.DoubleSide
  mesh.position.fromArray(position)
  mesh.rotation.fromArray(rotation)
  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'ramp'
  mesh.userData.size = [...size]
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  applyMazeFloorTexture(mesh)
  return mesh
}

function addRampBrush(pointA, pointB, rampWidth, scale = 1) {
  const { rampRun, effectiveRise, posX, posY, posZ, rotY } = computeRampParams(
    pointA,
    pointB,
    rampWidth,
    scale
  )

  const geometry = createWedgeGeometry(rampWidth, effectiveRise, rampRun)
  geometry.translate(0, 0, rampRun / 2)

  const texture = resolveBrushTexture(resolveBrushTextureInfo({ key: 'maze' }))
  const material = createBrushMaterial(texture, brushes.length * 4, useLitMaterials)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.material.side = THREE.DoubleSide

  mesh.position.set(posX, posY, posZ)
  mesh.rotation.y = rotY

  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'ramp'
  mesh.userData.size = [rampWidth, effectiveRise, rampRun]
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  applyMazeFloorTexture(mesh)
  scene.add(mesh)
  brushes.push(mesh)
  updateSceneList()
  return mesh
}

function addRampBrushFrom4Points(pointA, pointB, pointC, pointD, scale = 1) {
  const geometry = createRampGeometryFrom4Points(pointA, pointB, pointC, pointD, scale)

  const texture = resolveBrushTexture(resolveBrushTextureInfo({ key: 'maze' }))
  const material = createBrushMaterial(texture, brushes.length * 4, useLitMaterials)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.material.side = THREE.DoubleSide

  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'ramp'
  mesh.userData.rampPoints = [pointA, pointB, pointC, pointD]
  mesh.userData.rampScale = scale
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  applyMazeFloorTexture(mesh)
  scene.add(mesh)
  brushes.push(mesh)
  updateSceneList()
  return mesh
}

function mazeGridToFloorMeshes(
  cols,
  rows,
  spaceBetweenWalls,
  floorOptions,
  offset = [0, 0, 0],
  rotation = null
) {
  const flatThickness =
    (floorOptions?.flatFloorSize ?? Math.max(0.1, spaceBetweenWalls * 0.1)) || 0.1

  const w = cols * 2 + 1
  const h = rows * 2 + 1
  const unitSize = spaceBetweenWalls
  const ox = ((w - 1) / 2) * unitSize
  const oz = ((h - 1) / 2) * unitSize
  const [offX, offY, offZ] = offset

  for (let x = 0; x < w; x++) {
    for (let z = 0; z < h; z++) {
      const localX = x * unitSize - ox
      const localZ = z * unitSize - oz
      const rotated = rotateArenaPoint(localX, localZ, rotation)
      const px = rotated.x + offX
      const pz = rotated.z + offZ

      const flatFloorY = flatThickness / 2 + offY
      addMazeFloorCell([unitSize, flatThickness, unitSize], [px, flatFloorY, pz], rotation)
    }
  }
}

function arenaGridsToMeshes(grids, tileSize, storeyHeight, offset = [0, 0, 0], rotation = null) {
  const [offX, offY, offZ] = offset
  for (let s = 0; s < grids.length; s++) {
    const grid = grids[s]
    const cols = grid.length
    const rows = grid[0].length
    const ox = ((cols - 1) / 2) * tileSize
    const oz = ((rows - 1) / 2) * tileSize
    const storeyBaseY = offY + s * storeyHeight
    const wallCenterY = storeyBaseY + storeyHeight / 2
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) {
        if (grid[x][z] !== 1) continue
        const localX = x * tileSize - ox
        const localZ = z * tileSize - oz
        const rotated = rotateArenaPoint(localX, localZ, rotation)
        const px = rotated.x + offX
        const pz = rotated.z + offZ
        const mesh = addBrushMesh([tileSize, storeyHeight, tileSize], [px, wallCenterY, pz])
        mesh.userData.generator = 'arena'
        mesh.userData.subtype = 'arena-wall'
        mesh.userData.storey = s
        if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
        applyArenaBaseTexture(mesh)
        if (rotation) mesh.rotation.copy(rotation)
        if (activeGenerationCollector) activeGenerationCollector.push(mesh)
      }
    }
  }
}

function clearGeneratedBrushesByGenerator(generator) {
  const toKeep = brushes.filter((m) => m.userData.isUserBrush || m.userData.generator !== generator)
  const toRemove = brushes.filter((m) => !m.userData.isUserBrush && m.userData.generator === generator)
  toRemove.forEach((m) => {
    scene.remove(m)
    m.geometry.dispose()
    m.material.map?.dispose()
    m.material.dispose()
  })
  brushes.length = 0
  brushes.push(...toKeep)
  selectBrush(selectedBrush && brushes.includes(selectedBrush) ? selectedBrush : null)
}

function removeGeneratedBrushes(list) {
  if (!list || list.length === 0) return
  const toRemove = new Set(list)
  list.forEach((m) => {
    if (!m) return
    scene.remove(m)
    m.geometry?.dispose?.()
    m.material?.map?.dispose?.()
    m.material?.dispose?.()
  })
  const nextBrushes = brushes.filter((m) => !toRemove.has(m))
  brushes.length = 0
  brushes.push(...nextBrushes)
  if (lastLevelBuilderGeneratedBrushes.length > 0) {
    lastLevelBuilderGeneratedBrushes = lastLevelBuilderGeneratedBrushes.filter((mesh) => brushes.includes(mesh))
  }
  if (selectedBrush && !brushes.includes(selectedBrush)) selectBrush(null)
  renderLevelBuilderEntitiesList()
}

function cloneGrid(grid) {
  return grid.map((col) => col.slice())
}

function cloneCells(cells) {
  return cells.map((cell) => ({ ...cell }))
}

function cloneArenaState(arena) {
  return {
    grids: arena.grids.map((g) => cloneGrid(g)),
    spawns: cloneCells(arena.spawns),
    flags: cloneCells(arena.flags),
    collisionPoints: cloneCells(arena.collisionPoints),
    covers: cloneCells(arena.covers),
  }
}

function gridsEqual(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let x = 0; x < a.length; x++) {
    const colA = a[x]
    const colB = b[x]
    if (!colA || !colB || colA.length !== colB.length) return false
    for (let z = 0; z < colA.length; z++) {
      if (colA[z] !== colB[z]) return false
    }
  }
  return true
}

function generateMaze() {
  const preview = getSelectedLevelBuilderVolume('maze')
  if (!preview) {
    showToast('Select a Maze volume in Level Builder, then generate.', { type: 'warn' })
    return
  }
  pushUndoState()
  if (!isPreviewValid(preview, null)) {
    updatePreviewValidity(preview, null)
    showToast('Maze volume intersects another object. Move or resize it, then try again.', { type: 'warn' })
    return
  }

  mazeGenerationCount += 1
  lastMazeGroupId = `maze_${String(mazeGenerationCount).padStart(2, '0')}`
  activeGenerationGroup = lastMazeGroupId
  const ctrl = getMazeControls()
  let mazeResult = generateMazeGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    exitWidth: ctrl.exitWidth,
    centerRoomSize: ctrl.centerRoomSize,
    layout: ctrl.layout,
    roomCount: ctrl.roomCount,
  })
  if (lastMazeState) {
    let attempts = 0
    while (attempts < 5 && gridsEqual(mazeResult.grid, lastMazeState.grid)) {
      mazeResult = generateMazeGrid({
        cols: ctrl.cols,
        rows: ctrl.rows,
        exitWidth: ctrl.exitWidth,
        centerRoomSize: ctrl.centerRoomSize,
        layout: ctrl.layout,
        roomCount: ctrl.roomCount,
      })
      attempts += 1
    }
  }
  const { grid, cols, rows } = mazeResult

  const baseOffset = getPreviewBaseOffset(preview, ctrl.wallHeight)
  const baseRotation = preview?.rotation ? preview.rotation.clone() : null
  beginGenerationCollector()
  const floorOptions = { flatFloorSize: ctrl.flatFloorSize }
  mazeGridToFloorMeshes(cols, rows, ctrl.spaceBetweenWalls, floorOptions, baseOffset, baseRotation)
  mazeGridToMeshes(
    grid,
    cols,
    rows,
    ctrl.spaceBetweenWalls,
    ctrl.wallThickness,
    ctrl.wallHeight,
    baseOffset,
    baseRotation
  )
  lastMazeBrushes = endGenerationCollector()
  setLastLevelBuilderGeneratedEntities('maze', lastMazeBrushes)

  lastMazeState = {
    grid: cloneGrid(grid),
    cols,
    rows,
  }
  lastMazePlacement = {
    offset: [...baseOffset],
    rotation: baseRotation ? baseRotation.clone() : null,
  }
  updateIterateButtons()
  removeLevelBuilderVolume(preview)

  selectBrush(null)
  updateSceneList()
}

function addArenaMarkerCylinder(radius, height, position) {
  const mesh = createCylinderMesh(radius, height, position, brushes.length * 4, { key: 'arena' })
  applyArenaBaseTexture(mesh)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'arena'
  mesh.userData.subtype = 'arena-marker'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  mesh.castShadow = false
  mesh.receiveShadow = false
  scene.add(mesh)
  brushes.push(mesh)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function addArenaCover(size, position) {
  const mesh = createBrushMesh(size, position, brushes.length * 4, { key: 'arena' })
  applyArenaObstacleTexture(mesh)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'arena'
  mesh.userData.subtype = 'arena-obstacle'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  mesh.castShadow = false
  mesh.receiveShadow = false
  scene.add(mesh)
  brushes.push(mesh)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function createLevelBuilderVolumeMesh(size, position, levelBuilderType) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  const material = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.isBrush = true
  mesh.userData.isUserBrush = true
  mesh.userData.isLevelBuilderVolume = true
  mesh.userData.levelBuilderType = levelBuilderType
  mesh.userData.type = 'level-builder-volume'
  mesh.userData.subtype = `${levelBuilderType}-volume`
  mesh.userData.size = [...size]
  mesh.userData.id = crypto.randomUUID()
  mesh.name = `${levelBuilderType}_volume_${String(mesh.userData.id).slice(0, 8)}`
  return mesh
}

function addArenaVolume() {
  const ctrl = getArenaControls()
  const totalHeight = ctrl.wallHeight
  const size = [ctrl.cols * ctrl.tileSize, totalHeight, ctrl.rows * ctrl.tileSize]
  const position = [0, totalHeight / 2, 0]
  const mesh = createLevelBuilderVolumeMesh(size, position, 'arena')
  mesh.userData.arenaCols = ctrl.cols
  mesh.userData.arenaRows = ctrl.rows
  scene.add(mesh)
  brushes.push(mesh)
  arenaPreview = mesh
  return mesh
}

function updateArenaPreviewFromControls() {
  const preview = getPrimaryLevelBuilderVolume('arena')
  if (!preview) return
  const ctrl = getArenaControls()
  const obstacleInput = document.getElementById('arena-obstacle-height')
  const obstacleValue = document.getElementById('arena-obstacle-height-value')
  if (obstacleInput) {
    obstacleInput.max = String(ctrl.wallHeightCm)
    const obstacleInputValue = parseFloat(obstacleInput.value)
    const shouldTrackWall = Math.abs(obstacleInputValue - lastArenaWallHeightCm) < 0.001
    if (shouldTrackWall) {
      obstacleInput.value = String(ctrl.wallHeightCm)
      if (obstacleValue) obstacleValue.textContent = String(ctrl.wallHeightCm)
    } else if (ctrl.obstacleHeight * CM_PER_UNIT < obstacleInputValue) {
      obstacleInput.value = String(Math.round(ctrl.obstacleHeight * CM_PER_UNIT))
      if (obstacleValue) obstacleValue.textContent = obstacleInput.value
    }
  }
  lastArenaWallHeightCm = ctrl.wallHeightCm
  const totalHeight = ctrl.wallHeight
  const size = [ctrl.cols * ctrl.tileSize, totalHeight, ctrl.rows * ctrl.tileSize]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.arenaCols = ctrl.cols
  preview.userData.arenaRows = ctrl.rows
  refreshOutline(preview)
  if (!preview.position || Number.isNaN(preview.position.y)) {
    preview.position.set(0, totalHeight / 2, 0)
  }
}

function addMazeVolume() {
  const ctrl = getMazeControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  const position = [0, ctrl.wallHeight / 2, 0]
  const mesh = createLevelBuilderVolumeMesh(size, position, 'maze')
  mesh.userData.mazeCols = ctrl.cols
  mesh.userData.mazeRows = ctrl.rows
  scene.add(mesh)
  brushes.push(mesh)
  mazePreview = mesh
  return mesh
}

function addMazeArenaVolume() {
  const ctrl = getMazeArenaControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  const position = [0, ctrl.wallHeight / 2, 0]
  const mesh = createLevelBuilderVolumeMesh(size, position, 'maze-arena')
  mesh.userData.mazeArenaCols = ctrl.cols
  mesh.userData.mazeArenaRows = ctrl.rows
  scene.add(mesh)
  brushes.push(mesh)
  mazePreview = mesh
  return mesh
}

function updateMazePreviewFromControls() {
  const preview = getPrimaryLevelBuilderVolume('maze')
  if (!preview) return
  const ctrl = getMazeControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.mazeCols = ctrl.cols
  preview.userData.mazeRows = ctrl.rows
  refreshOutline(preview)
  if (!preview.position || Number.isNaN(preview.position.y)) {
    preview.position.set(0, ctrl.wallHeight / 2, 0)
  }
}

function updateMazeArenaPreviewFromControls() {
  const preview = getPrimaryLevelBuilderVolume('maze-arena')
  if (!preview) return
  const ctrl = getMazeArenaControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.mazeArenaCols = ctrl.cols
  preview.userData.mazeArenaRows = ctrl.rows
  refreshOutline(preview)
  if (!preview.position || Number.isNaN(preview.position.y)) {
    preview.position.set(0, ctrl.wallHeight / 2, 0)
  }
}

function getBrushWorldBox(mesh) {
  const box = new THREE.Box3()
  return box.setFromObject(mesh)
}

function isPreviewValid(preview, otherPreview, ignoreGenerator = null) {
  if (!preview || !preview.visible) return false
  const previewBox = getBrushWorldBox(preview)
  if (otherPreview?.visible) {
    const otherBox = getBrushWorldBox(otherPreview)
    if (previewBox.intersectsBox(otherBox)) return false
  }
  for (const brush of brushes) {
    if (!brush || brush === preview || brush === otherPreview) continue
    if (brush.userData?.isArenaPreview || brush.userData?.isMazePreview) continue
    if (ignoreGenerator && brush.userData?.generator === ignoreGenerator) continue
    const brushBox = getBrushWorldBox(brush)
    if (previewBox.intersectsBox(brushBox)) return false
  }
  return true
}

function updatePreviewValidity(preview, otherPreview, ignoreGenerator = null) {
  if (!preview) return false
  const valid = isPreviewValid(preview, otherPreview, ignoreGenerator)
  if (preview.material?.color) {
    preview.material.color.set(valid ? 0x33ff66 : 0xff3333)
  }
  return valid
}

function updateArenaPreviewValidity() {
  const previews = getLevelBuilderVolumes('arena').filter((mesh) => mesh.visible)
  let allValid = previews.length > 0
  previews.forEach((preview) => {
    allValid = updatePreviewValidity(preview, null) && allValid
  })
  return allValid
}

function updateMazePreviewValidity() {
  const previews = [
    ...getLevelBuilderVolumes('maze').filter((mesh) => mesh.visible),
    ...getLevelBuilderVolumes('maze-arena').filter((mesh) => mesh.visible),
  ]
  let allValid = previews.length > 0
  previews.forEach((preview) => {
    allValid = updatePreviewValidity(preview, null) && allValid
  })
  return allValid
}

function snapScaledCount(count, scale, min, max) {
  if (scale > 1) return clamp(Math.ceil(count * scale - 1e-6), min, max)
  if (scale < 1) return clamp(Math.floor(count * scale + 1e-6), min, max)
  return clamp(Math.round(count), min, max)
}

function syncArenaControlsFromPreview(preview, scale) {
  if (!preview) return
  const tileSizeCm = parseFloat(document.getElementById('arena-tile')?.value ?? '100')
  if (!tileSizeCm || Number.isNaN(tileSizeCm)) return
  const tileSize = tileSizeCm / CM_PER_UNIT
  const wallHeightInput = document.getElementById('arena-height')
  const wallHeightValueEl = document.getElementById('arena-height-value')
  const wallHeightCm = parseFloat(wallHeightInput?.value ?? '100')
  const baseTotalHeightUnits = preview.userData.size?.[1] ?? wallHeightCm / CM_PER_UNIT
  const scaledHeightUnits = baseTotalHeightUnits * scale.y
  const baseOffset = getPreviewBaseOffset(preview, scaledHeightUnits)
  const colsEl = document.getElementById('arena-cols')
  const rowsEl = document.getElementById('arena-rows')
  const colsValueEl = document.getElementById('arena-cols-value')
  const rowsValueEl = document.getElementById('arena-rows-value')
  if (!colsEl || !rowsEl) return
  const minCols = parseInt(colsEl.min ?? '1', 10)
  const maxCols = parseInt(colsEl.max ?? '999', 10)
  const minRows = parseInt(rowsEl.min ?? '1', 10)
  const maxRows = parseInt(rowsEl.max ?? '999', 10)
  const baseCols = preview.userData.arenaCols ?? parseInt(colsEl.value, 10) ?? 1
  const baseRows = preview.userData.arenaRows ?? parseInt(rowsEl.value, 10) ?? 1
  const nextCols = snapScaledCount(baseCols, scale.x, minCols, maxCols)
  const nextRows = snapScaledCount(baseRows, scale.z, minRows, maxRows)
  colsEl.value = String(nextCols)
  rowsEl.value = String(nextRows)
  if (colsValueEl) colsValueEl.textContent = String(nextCols)
  if (rowsValueEl) rowsValueEl.textContent = String(nextRows)
  let nextWallHeightCm = wallHeightCm
  if (wallHeightInput) {
    const minHeightCm = parseFloat(wallHeightInput.min ?? '0')
    const maxHeightCm = parseFloat(wallHeightInput.max ?? '999')
    const nextWallHeightUnits = clamp(baseTotalHeightUnits * scale.y, minHeightCm / CM_PER_UNIT, maxHeightCm / CM_PER_UNIT)
    nextWallHeightCm = Math.round(nextWallHeightUnits * CM_PER_UNIT)
    nextWallHeightCm = clamp(nextWallHeightCm, minHeightCm, maxHeightCm)
    wallHeightInput.value = String(nextWallHeightCm)
    if (wallHeightValueEl) wallHeightValueEl.textContent = String(nextWallHeightCm)
  }
  const obstacleInput = document.getElementById('arena-obstacle-height')
  const obstacleValueEl = document.getElementById('arena-obstacle-height-value')
  if (obstacleInput) {
    obstacleInput.max = String(nextWallHeightCm)
    const obstacleValueCm = parseFloat(obstacleInput.value)
    if (obstacleValueCm > nextWallHeightCm) {
      obstacleInput.value = String(nextWallHeightCm)
      if (obstacleValueEl) obstacleValueEl.textContent = String(nextWallHeightCm)
    }
  }
  const nextWallHeightUnits = nextWallHeightCm / CM_PER_UNIT
  const size = [nextCols * tileSize, nextWallHeightUnits, nextRows * tileSize]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.arenaCols = nextCols
  preview.userData.arenaRows = nextRows
  refreshOutline(preview)
  preview.position.set(baseOffset[0], baseOffset[1] + nextWallHeightUnits / 2, baseOffset[2])
}

function syncMazeControlsFromPreview(preview, scale) {
  if (!preview) return
  const spaceBetweenWallsCm = parseFloat(document.getElementById('maze-space')?.value ?? '100')
  if (!spaceBetweenWallsCm || Number.isNaN(spaceBetweenWallsCm)) return
  const spaceBetweenWalls = spaceBetweenWallsCm / CM_PER_UNIT
  const wallHeightInput = document.getElementById('maze-height')
  const wallHeightValueEl = document.getElementById('maze-height-value')
  const wallHeightCm = parseFloat(wallHeightInput?.value ?? '100')
  const wallHeightUnits = preview.userData.size?.[1] ?? wallHeightCm / CM_PER_UNIT
  const scaledHeightUnits = wallHeightUnits * scale.y
  const baseOffset = getPreviewBaseOffset(preview, scaledHeightUnits)
  const colsEl = document.getElementById('maze-cols')
  const rowsEl = document.getElementById('maze-rows')
  const colsValueEl = document.getElementById('maze-cols-value')
  const rowsValueEl = document.getElementById('maze-rows-value')
  if (!colsEl || !rowsEl) return
  const minCols = parseInt(colsEl.min ?? '1', 10)
  const maxCols = parseInt(colsEl.max ?? '999', 10)
  const minRows = parseInt(rowsEl.min ?? '1', 10)
  const maxRows = parseInt(rowsEl.max ?? '999', 10)
  const baseCols = preview.userData.mazeCols ?? parseInt(colsEl.value, 10) ?? 1
  const baseRows = preview.userData.mazeRows ?? parseInt(rowsEl.value, 10) ?? 1
  const nextCols = snapScaledCount(baseCols, scale.x, minCols, maxCols)
  const nextRows = snapScaledCount(baseRows, scale.z, minRows, maxRows)
  colsEl.value = String(nextCols)
  rowsEl.value = String(nextRows)
  if (colsValueEl) colsValueEl.textContent = String(nextCols)
  if (rowsValueEl) rowsValueEl.textContent = String(nextRows)
  let nextWallHeightCm = wallHeightCm
  if (wallHeightInput) {
    const minHeightCm = parseFloat(wallHeightInput.min ?? '0')
    const maxHeightCm = parseFloat(wallHeightInput.max ?? '999')
    const baseHeightUnits = preview.userData.size?.[1] ?? wallHeightCm / CM_PER_UNIT
    const nextWallHeightUnits = clamp(baseHeightUnits * scale.y, minHeightCm / CM_PER_UNIT, maxHeightCm / CM_PER_UNIT)
    nextWallHeightCm = Math.round(nextWallHeightUnits * CM_PER_UNIT)
    nextWallHeightCm = clamp(nextWallHeightCm, minHeightCm, maxHeightCm)
    wallHeightInput.value = String(nextWallHeightCm)
    if (wallHeightValueEl) wallHeightValueEl.textContent = String(nextWallHeightCm)
  }
  const nextWallHeightUnits = nextWallHeightCm / CM_PER_UNIT
  const w = nextCols * 2 + 1
  const h = nextRows * 2 + 1
  const width = (w - 1) * spaceBetweenWalls
  const depth = (h - 1) * spaceBetweenWalls
  const size = [width, nextWallHeightUnits, depth]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.mazeCols = nextCols
  preview.userData.mazeRows = nextRows
  refreshOutline(preview)
  preview.position.set(baseOffset[0], baseOffset[1] + nextWallHeightUnits / 2, baseOffset[2])
}

function syncMazeArenaControlsFromPreview(preview, scale) {
  if (!preview) return
  const spaceBetweenWallsCm = parseFloat(document.getElementById('maze-arena-space')?.value ?? '100')
  if (!spaceBetweenWallsCm || Number.isNaN(spaceBetweenWallsCm)) return
  const spaceBetweenWalls = spaceBetweenWallsCm / CM_PER_UNIT
  const wallHeightInput = document.getElementById('maze-arena-height')
  const wallHeightValueEl = document.getElementById('maze-arena-height-value')
  const wallHeightCm = parseFloat(wallHeightInput?.value ?? '100')
  const wallHeightUnits = preview.userData.size?.[1] ?? wallHeightCm / CM_PER_UNIT
  const scaledHeightUnits = wallHeightUnits * scale.y
  const baseOffset = getPreviewBaseOffset(preview, scaledHeightUnits)
  const colsEl = document.getElementById('maze-arena-cols')
  const rowsEl = document.getElementById('maze-arena-rows')
  const colsValueEl = document.getElementById('maze-arena-cols-value')
  const rowsValueEl = document.getElementById('maze-arena-rows-value')
  if (!colsEl || !rowsEl) return
  const minCols = parseInt(colsEl.min ?? '1', 10)
  const maxCols = parseInt(colsEl.max ?? '999', 10)
  const minRows = parseInt(rowsEl.min ?? '1', 10)
  const maxRows = parseInt(rowsEl.max ?? '999', 10)
  const baseCols = preview.userData.mazeArenaCols ?? parseInt(colsEl.value, 10) ?? 1
  const baseRows = preview.userData.mazeArenaRows ?? parseInt(rowsEl.value, 10) ?? 1
  const nextCols = snapScaledCount(baseCols, scale.x, minCols, maxCols)
  const nextRows = snapScaledCount(baseRows, scale.z, minRows, maxRows)
  colsEl.value = String(nextCols)
  rowsEl.value = String(nextRows)
  if (colsValueEl) colsValueEl.textContent = String(nextCols)
  if (rowsValueEl) rowsValueEl.textContent = String(nextRows)
  let nextWallHeightCm = wallHeightCm
  if (wallHeightInput) {
    const minHeightCm = parseFloat(wallHeightInput.min ?? '0')
    const maxHeightCm = parseFloat(wallHeightInput.max ?? '999')
    const baseHeightUnits = preview.userData.size?.[1] ?? wallHeightCm / CM_PER_UNIT
    const nextWallHeightUnits = clamp(baseHeightUnits * scale.y, minHeightCm / CM_PER_UNIT, maxHeightCm / CM_PER_UNIT)
    nextWallHeightCm = Math.round(nextWallHeightUnits * CM_PER_UNIT)
    nextWallHeightCm = clamp(nextWallHeightCm, minHeightCm, maxHeightCm)
    wallHeightInput.value = String(nextWallHeightCm)
    if (wallHeightValueEl) wallHeightValueEl.textContent = String(nextWallHeightCm)
  }
  const nextWallHeightUnits = nextWallHeightCm / CM_PER_UNIT
  const w = nextCols * 2 + 1
  const h = nextRows * 2 + 1
  const width = (w - 1) * spaceBetweenWalls
  const depth = (h - 1) * spaceBetweenWalls
  const size = [width, nextWallHeightUnits, depth]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.mazeArenaCols = nextCols
  preview.userData.mazeArenaRows = nextRows
  refreshOutline(preview)
  preview.position.set(baseOffset[0], baseOffset[1] + nextWallHeightUnits / 2, baseOffset[2])
}

function addArenaFloors(cols, rows, tileSize, storeyHeight, offset = [0, 0, 0], rotation = null) {
  const thickness = Math.max(0.1, tileSize * 0.1)
  const ox = ((cols - 1) / 2) * tileSize
  const oz = ((rows - 1) / 2) * tileSize
  const [offX, offY, offZ] = offset
  const meshes = []
  const floorY = offY + thickness / 2
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      const localX = x * tileSize - ox
      const localZ = z * tileSize - oz
        const rotated = rotateArenaPoint(localX, localZ, rotation)
        const px = rotated.x + offX
        const pz = rotated.z + offZ
        const mesh = createBrushMesh([tileSize, thickness, tileSize], [px, floorY, pz], brushes.length * 4, {
          index: TEXTURE_INDEX.arenaBase,
        })
        applyArenaBaseTexture(mesh)
        mesh.userData.id = crypto.randomUUID()
        mesh.userData.isUserBrush = false
        mesh.userData.generator = 'arena'
        mesh.userData.subtype = 'arena-floor'
        mesh.userData.storey = 0
        if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
        mesh.castShadow = false
        mesh.receiveShadow = false
        scene.add(mesh)
        brushes.push(mesh)
        if (activeGenerationCollector) activeGenerationCollector.push(mesh)
        if (rotation) mesh.rotation.copy(rotation)
        meshes.push(mesh)
    }
  }
  return meshes
}

function getPreviewBaseOffset(preview, height) {
  if (!preview?.position) return [0, 0, 0]
  const pos = preview.position.toArray()
  return [pos[0], pos[1] - height / 2, pos[2]]
}

function placeArenaMarkers(arena, tileSize, wallHeight, obstacleHeight, offset = [0, 0, 0], rotation = null) {
  const grid = arena.grids[0]
  const cols = grid.length
  const rows = grid[0].length
  const ox = ((cols - 1) / 2) * tileSize
  const oz = ((rows - 1) / 2) * tileSize
  const [offX, offY, offZ] = offset

  const cellToWorld = (cell) => {
    const floor = cell.floor ?? 0
    const baseY = offY + floor * wallHeight
    return {
      x: cell.x * tileSize - ox,
      z: cell.z * tileSize - oz,
      baseY,
    }
  }

  const markerBaseHeight = Math.min(wallHeight, obstacleHeight)
  const spawnHeight = markerBaseHeight * 0.7
  const spawnRadius = tileSize * 0.3
  arena.spawns.forEach((cell) => {
    const { x, z, baseY } = cellToWorld(cell)
    const rotated = rotateArenaPoint(x, z, rotation)
    addArenaMarkerCylinder(spawnRadius, spawnHeight, [rotated.x + offX, baseY + spawnHeight / 2, rotated.z + offZ])
  })

  const flagHeight = markerBaseHeight * 0.5
  const flagRadius = tileSize * 0.22
  arena.flags.forEach((cell) => {
    const { x, z, baseY } = cellToWorld(cell)
    const rotated = rotateArenaPoint(x, z, rotation)
    addArenaMarkerCylinder(flagRadius, flagHeight, [rotated.x + offX, baseY + flagHeight / 2, rotated.z + offZ])
  })

  const collisionHeight = markerBaseHeight * 0.6
  const collisionRadius = tileSize * 0.25
  arena.collisionPoints.forEach((cell) => {
    const { x, z, baseY } = cellToWorld(cell)
    const rotated = rotateArenaPoint(x, z, rotation)
    addArenaMarkerCylinder(collisionRadius, collisionHeight, [rotated.x + offX, baseY + collisionHeight / 2, rotated.z + offZ])
  })

  const coverHeight = obstacleHeight * 0.9
  const coverSize = tileSize * 0.5
  arena.covers.forEach((cell) => {
    const { x, z, baseY } = cellToWorld(cell)
    const rotated = rotateArenaPoint(x, z, rotation)
    const mesh = addArenaCover([coverSize, coverHeight, coverSize], [rotated.x + offX, baseY + coverHeight / 2, rotated.z + offZ])
    if (rotation) mesh.rotation.copy(rotation)
  })

}

function generateArena() {
  const preview = getSelectedLevelBuilderVolume('arena')
  if (!preview) {
    showToast('Select an Arena volume in Level Builder, then generate.', { type: 'warn' })
    return
  }
  pushUndoState()
  if (!isPreviewValid(preview, null)) {
    updatePreviewValidity(preview, null)
    showToast('Arena volume intersects another object. Move or resize it, then try again.', { type: 'warn' })
    return
  }

  removeGeneratedBrushes(lastArenaBrushes)

  arenaGenerationCount += 1
  lastArenaGroupId = `arena_${String(arenaGenerationCount).padStart(2, '0')}`
  activeGenerationGroup = lastArenaGroupId
  const ctrl = getArenaControls()
  let arena = generateArenaGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    density: ctrl.density,
    buildingCount: ctrl.buildingCount,
    smoothingPasses: ctrl.smoothingPasses,
    corridorWidth: ctrl.corridorWidth,
    exitWidth: ctrl.exitWidth,
    candidates: ctrl.candidates,
  })
  if (lastArenaState) {
    let attempts = 0
    while (attempts < 5 && gridsEqual(arena.grids[0], lastArenaState.grids[0])) {
      arena = generateArenaGrid({
        cols: ctrl.cols,
        rows: ctrl.rows,
        density: ctrl.density,
        buildingCount: ctrl.buildingCount,
        smoothingPasses: ctrl.smoothingPasses,
        corridorWidth: ctrl.corridorWidth,
        exitWidth: ctrl.exitWidth,
        candidates: ctrl.candidates,
      })
      attempts += 1
    }
  }

  const totalHeight = ctrl.wallHeight
  const baseOffset = getPreviewBaseOffset(preview, totalHeight)
  const baseRotation = preview?.rotation ? preview.rotation.clone() : null
  beginGenerationCollector()
  addArenaFloors(
    ctrl.cols,
    ctrl.rows,
    ctrl.tileSize,
    ctrl.wallHeight,
    baseOffset,
    baseRotation
  )
  arenaGridsToMeshes(arena.grids, ctrl.tileSize, ctrl.wallHeight, baseOffset, baseRotation)
  placeArenaMarkers(arena, ctrl.tileSize, ctrl.wallHeight, ctrl.obstacleHeight, baseOffset, baseRotation)
  lastArenaBrushes = endGenerationCollector()
  setLastLevelBuilderGeneratedEntities('arena', lastArenaBrushes)

  lastArenaState = cloneArenaState(arena)
  lastArenaPlacement = {
    offset: [...baseOffset],
    rotation: baseRotation ? baseRotation.clone() : null,
  }
  updateIterateButtons()
  removeLevelBuilderVolume(preview)

  selectBrush(null)
  updateSceneList()
}

function regenerateMazeFromLast() {
  if (!lastMazeState) return
  pushUndoState()
  removeGeneratedBrushes(lastMazeBrushes)

  const ctrl = getMazeControls()
  activeGenerationGroup = lastMazeGroupId
  beginGenerationCollector()
  let mazeResult = generateMazeGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    exitWidth: ctrl.exitWidth,
    centerRoomSize: ctrl.centerRoomSize,
    layout: ctrl.layout,
    roomCount: ctrl.roomCount,
  })
  let attempts = 0
  while (attempts < 5 && lastMazeState && gridsEqual(mazeResult.grid, lastMazeState.grid)) {
    mazeResult = generateMazeGrid({
      cols: ctrl.cols,
      rows: ctrl.rows,
      exitWidth: ctrl.exitWidth,
      centerRoomSize: ctrl.centerRoomSize,
      layout: ctrl.layout,
      roomCount: ctrl.roomCount,
    })
    attempts += 1
  }
  const { grid, cols, rows } = mazeResult
  const baseOffset = lastMazePlacement?.offset ?? [0, 0, 0]
  const baseRotation = lastMazePlacement?.rotation ? lastMazePlacement.rotation.clone() : null
  const floorOptions = { flatFloorSize: ctrl.flatFloorSize }
  mazeGridToFloorMeshes(cols, rows, ctrl.spaceBetweenWalls, floorOptions, baseOffset, baseRotation)
  mazeGridToMeshes(
    grid,
    cols,
    rows,
    ctrl.spaceBetweenWalls,
    ctrl.wallThickness,
    ctrl.wallHeight,
    baseOffset,
    baseRotation
  )
  lastMazeBrushes = endGenerationCollector()
  setLastLevelBuilderGeneratedEntities('maze', lastMazeBrushes)

  lastMazeState = {
    grid: cloneGrid(grid),
    cols,
    rows,
  }
  updateIterateButtons()

  selectBrush(null)
  updateSceneList()
}

function regenerateArenaFromLast() {
  if (!lastArenaState) return
  pushUndoState()
  removeGeneratedBrushes(lastArenaBrushes)

  const ctrl = getArenaControls()
  activeGenerationGroup = lastArenaGroupId
  beginGenerationCollector()
  let arena = generateArenaGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    density: ctrl.density,
    buildingCount: ctrl.buildingCount,
    smoothingPasses: ctrl.smoothingPasses,
    corridorWidth: ctrl.corridorWidth,
    exitWidth: ctrl.exitWidth,
    candidates: ctrl.candidates,
  })
  let attempts = 0
  while (attempts < 5 && lastArenaState && gridsEqual(arena.grids[0], lastArenaState.grids[0])) {
    arena = generateArenaGrid({
      cols: ctrl.cols,
      rows: ctrl.rows,
      density: ctrl.density,
      buildingCount: ctrl.buildingCount,
      smoothingPasses: ctrl.smoothingPasses,
      corridorWidth: ctrl.corridorWidth,
      exitWidth: ctrl.exitWidth,
      candidates: ctrl.candidates,
    })
    attempts += 1
  }
  const cols = arena.grids[0].length
  const rows = arena.grids[0][0]?.length ?? 0
  const baseOffset = lastArenaPlacement?.offset ?? [0, 0, 0]
  const baseRotation = lastArenaPlacement?.rotation ? lastArenaPlacement.rotation.clone() : null
  addArenaFloors(
    cols,
    rows,
    ctrl.tileSize,
    ctrl.wallHeight,
    baseOffset,
    baseRotation
  )
  arenaGridsToMeshes(arena.grids, ctrl.tileSize, ctrl.wallHeight, baseOffset, baseRotation)
  placeArenaMarkers(
    arena,
    ctrl.tileSize,
    ctrl.wallHeight,
    ctrl.obstacleHeight,
    baseOffset,
    baseRotation
  )
  lastArenaBrushes = endGenerationCollector()
  setLastLevelBuilderGeneratedEntities('arena', lastArenaBrushes)

  lastArenaState = cloneArenaState(arena)
  updateIterateButtons()

  selectBrush(null)
  updateSceneList()
}

let mazeArenaGenerationCount = 0

function generateMazeArena() {
  const preview = getSelectedLevelBuilderVolume('maze-arena')
  if (!preview) {
    showToast('Select a Complex Maze volume in Level Builder, then generate.', { type: 'warn' })
    return
  }
  pushUndoState()
  if (!isPreviewValid(preview, null)) {
    updatePreviewValidity(preview, null)
    showToast('Complex Maze volume intersects another object. Move or resize it, then try again.', { type: 'warn' })
    return
  }
  removeGeneratedBrushes(lastMazeArenaBrushes)

  mazeArenaGenerationCount += 1
  lastMazeArenaGroupId = `maze_arena_${String(mazeArenaGenerationCount).padStart(2, '0')}`
  activeGenerationGroup = lastMazeArenaGroupId

  const ctrl = getMazeArenaControls()
  const arenaCount = Math.max(2, Math.min(12, ctrl.arenaCount))
  const roomMinSize = 3
  const roomMaxSize = 6

  let mazeResult = generateMazeGrid({
    cols: ctrl.cols,
    rows: ctrl.rows,
    exitWidth: 1,
    centerRoomSize: 1,
    layout: 'center-out',
    roomCount: arenaCount,
    roomMinSize,
    roomMaxSize,
  })

  const { grid, cols, rows, rooms = [] } = mazeResult
  if (rooms.length === 0) {
    showToast('Could not place enough rooms. Try increasing maze size or reducing arena count.', { type: 'warn' })
    return
  }

  const baseOffset = getPreviewBaseOffset(preview, ctrl.wallHeight)
  const baseRotation = preview?.rotation ? preview.rotation.clone() : null

  const w = cols * 2 + 1
  const h = rows * 2 + 1
  const unitSize = ctrl.spaceBetweenWalls
  const ox = ((w - 1) / 2) * unitSize
  const oz = ((h - 1) / 2) * unitSize
  const [offX, offY, offZ] = baseOffset

  beginGenerationCollector()
  const floorOptions = { flatFloorSize: unitSize * 0.2 }
  mazeGridToFloorMeshes(cols, rows, unitSize, floorOptions, baseOffset, baseRotation)
  mazeGridToMeshes(
    grid,
    cols,
    rows,
    unitSize,
    ctrl.wallThickness,
    ctrl.wallHeight,
    baseOffset,
    baseRotation
  )

  for (const room of rooms) {
    const { gx0, gz0, gx1, gz1 } = room
    const roomCols = Math.max(3, gx1 - gx0 + 1)
    const roomRows = Math.max(3, gz1 - gz0 + 1)
    const roomCenterX = ((gx0 + gx1) / 2) * unitSize - ox
    const roomCenterZ = ((gz0 + gz1) / 2) * unitSize - oz
    const roomOffset = [
      offX + (baseRotation ? 0 : roomCenterX),
      offY,
      offZ + (baseRotation ? 0 : roomCenterZ),
    ]
    if (baseRotation) {
      const vec = new THREE.Vector3(roomCenterX, 0, roomCenterZ)
      vec.applyEuler(baseRotation)
      roomOffset[0] = offX + vec.x
      roomOffset[2] = offZ + vec.z
    }

    const interiorCells = Math.max(0, (roomCols - 2) * (roomRows - 2))
    const arena = generateArenaGrid({
      cols: roomCols,
      rows: roomRows,
      density: ctrl.density,
      buildingCount: interiorCells >= 8 ? Math.min(ctrl.buildingCount, Math.floor(interiorCells / 8)) : 0,
      buildingMinSize: 1,
      buildingMaxSize: Math.max(1, Math.min(4, Math.floor(roomCols / 2), Math.floor(roomRows / 2))),
      smoothingPasses: 1,
      corridorWidth: 1,
      exitWidth: 1,
      candidates: 3,
    })

    arenaGridsToMeshes(arena.grids, unitSize, ctrl.wallHeight, roomOffset, baseRotation)
    placeArenaMarkers(arena, unitSize, ctrl.wallHeight, ctrl.wallHeight * 0.7, roomOffset, baseRotation)
  }

  lastMazeArenaBrushes = endGenerationCollector()
  setLastLevelBuilderGeneratedEntities('maze-arena', lastMazeArenaBrushes)
  lastMazeArenaState = {
    grid: cloneGrid(grid),
    cols,
    rows,
    rooms: rooms.map((r) => ({ ...r })),
  }
  lastMazeArenaPlacement = {
    offset: [...baseOffset],
    rotation: baseRotation ? baseRotation.clone() : null,
  }
  updateIterateButtons()
  removeLevelBuilderVolume(preview)

  selectBrush(null)
  updateSceneList()
}

function regenerateMazeArenaFromLast() {
  if (!lastMazeArenaState) return
  const ctrl = getMazeArenaControls()
  let volume = getSelectedLevelBuilderVolume('maze-arena')
  if (!volume) {
    const placementOffset = lastMazeArenaPlacement?.offset ?? [0, 0, 0]
    const placementRotation = lastMazeArenaPlacement?.rotation ? lastMazeArenaPlacement.rotation.clone() : null
    const w = ctrl.cols * 2 + 1
    const h = ctrl.rows * 2 + 1
    const width = (w - 1) * ctrl.spaceBetweenWalls
    const depth = (h - 1) * ctrl.spaceBetweenWalls
    const size = [width, ctrl.wallHeight, depth]
    const position = [
      placementOffset[0],
      placementOffset[1] + ctrl.wallHeight / 2,
      placementOffset[2],
    ]
    volume = createLevelBuilderVolumeMesh(size, position, 'maze-arena')
    volume.userData.mazeArenaCols = ctrl.cols
    volume.userData.mazeArenaRows = ctrl.rows
    if (placementRotation) volume.rotation.copy(placementRotation)
    scene.add(volume)
    brushes.push(volume)
    updateSceneList()
  }
  selectBrush(volume)
  generateMazeArena()
}

const useFatLines = !/Win/i.test(navigator.platform || navigator.userAgent)

function addOutline(mesh) {
  if (mesh.userData.outline || outlineWidth <= 0) return
  const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
  let outline
  if (useFatLines) {
    try {
      const outlineGeom = new LineSegmentsGeometry()
      outlineGeom.fromEdgesGeometry(edges)
      edges.dispose()
      const outlineMat = new LineMaterial({
        color: OUTLINE_COLOR,
        linewidth: outlineWidth,
      })
      const vw = Math.max(1, viewport.clientWidth)
      const vh = Math.max(1, viewport.clientHeight)
      outlineMat.resolution.set(vw, vh)
      outline = new LineSegments2(outlineGeom, outlineMat)
    } catch (_) {
      outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: OUTLINE_COLOR }))
    }
  } else {
    outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: OUTLINE_COLOR }))
  }
  outline.raycast = () => {}
  outline.renderOrder = 1
  outline.userData.isOutline = true
  mesh.add(outline)
  mesh.userData.outline = outline
}

function removeOutline(mesh) {
  const outline = mesh?.userData?.outline
  if (outline) {
    mesh.remove(outline)
    outline.geometry?.dispose?.()
    outline.material?.dispose?.()
    mesh.userData.outline = null
  }
}

function refreshOutline(mesh) {
  const outline = mesh?.userData?.outline
  if (!outline) return
  outline.geometry.dispose()
  const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
  if (outline instanceof LineSegments2) {
    const outlineGeom = new LineSegmentsGeometry()
    outlineGeom.fromEdgesGeometry(edges)
    edges.dispose()
    outline.geometry = outlineGeom
  } else {
    outline.geometry = edges
  }
}

function updateOutlineResolution(width, height) {
  brushes.forEach((brush) => {
    const outline = brush?.userData?.outline
    if (outline?.material?.resolution) {
      outline.material.resolution.set(width, height)
    }
  })
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
    if (isLevelBuilderVolume(mesh)) {
      updateLevelBuilderTypeSelect(mesh.userData.levelBuilderType)
      if (editorMode !== 'level-builder') setEditorMode('level-builder')
      updateLevelBuilderControlPanels()
      if (mesh.userData.levelBuilderType === 'arena') updateArenaPreviewFromControls()
      if (mesh.userData.levelBuilderType === 'maze') updateMazePreviewFromControls()
      if (mesh.userData.levelBuilderType === 'maze-arena') updateMazeArenaPreviewFromControls()
    }
  } else {
    transformControls.detach()
    transformControls.enabled = false
    transformControlsHelper.visible = false
    if (editorMode === 'level-builder') updateLevelBuilderControlPanels()
  }
  renderLevelBuilderEntitiesList()
  updateHeaderRefreshButtonState()
}

function cloneBrush(mesh) {
  const position = mesh.position.toArray()
  const rotation = mesh.rotation.toArray().slice(0, 3)
  let clone
  if (mesh.userData.type === 'cylinder') {
    clone = createCylinderMesh(
      mesh.userData.radius,
      mesh.userData.height,
      position,
      brushes.length * 4,
      { key: mesh.userData.textureKey, index: mesh.userData.textureIndex }
    )
  } else if (isLevelBuilderVolume(mesh)) {
    clone = createLevelBuilderVolumeMesh(
      [...(mesh.userData.size ?? [1, 1, 1])],
      position,
      mesh.userData.levelBuilderType
    )
    clone.userData = {
      ...clone.userData,
      arenaCols: mesh.userData.arenaCols,
      arenaRows: mesh.userData.arenaRows,
      mazeCols: mesh.userData.mazeCols,
      mazeRows: mesh.userData.mazeRows,
      mazeArenaCols: mesh.userData.mazeArenaCols,
      mazeArenaRows: mesh.userData.mazeArenaRows,
    }
  } else if (mesh.userData.type === 'ramp' && mesh.userData.rampPoints) {
    clone = addRampBrushFrom4Points(
      mesh.userData.rampPoints[0],
      mesh.userData.rampPoints[1],
      mesh.userData.rampPoints[2],
      mesh.userData.rampPoints[3],
      mesh.userData.rampScale ?? 1
    )
    return clone
  } else if (mesh.userData.type === 'player_start') {
    clone = createPlayerStartMesh(position)
  } else if (mesh.userData.type === 'imported') {
    clone = mesh.clone()
    clone.geometry = mesh.geometry.clone()
    clone.material = mesh.material.clone()
    if (clone.material.map) clone.material.map = clone.material.map.clone()
    clone.userData = { ...mesh.userData, id: crypto.randomUUID(), outline: null }
    clone.scale.copy(mesh.scale)
  } else {
    clone = createBrushMesh(
      [...mesh.userData.size],
      position,
      brushes.length * 4,
      { key: mesh.userData.textureKey, index: mesh.userData.textureIndex }
    )
  }
  clone.userData.id = clone.userData.id ?? crypto.randomUUID()
  clone.userData.isUserBrush = true
  clone.position.fromArray(position)
  clone.rotation.fromArray(rotation)
  scene.add(clone)
  brushes.push(clone)
  updateSceneList()
  return clone
}

function deleteSelected() {
  if (!selectedBrush) return
  if (isLevelBuilderVolume(selectedBrush)) {
    const meshToDelete = selectedBrush
    removeLevelBuilderVolume(meshToDelete)
    updateSceneList()
    showToast('Level Builder volume removed.')
    return
  }
  pushUndoState()
  const idx = brushes.indexOf(selectedBrush)
  if (idx !== -1) brushes.splice(idx, 1)
  removeOutline(selectedBrush)
  scene.remove(selectedBrush)
  selectedBrush.geometry.dispose()
  selectedBrush.material.map?.dispose()
  selectedBrush.material.dispose()
  selectBrush(null)
  updateSceneList()
  showToast('Object removed.', {
    type: 'undo',
    recoveryLabel: 'Undo',
    onRecovery: undo,
  })
}

// Raycast for click selection
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function findBrushFromObject(obj) {
  let current = obj
  while (current) {
    if (current.userData?.isBrush) {
      if (isBrushSelectable(current)) return current
      return null
    }
    current = current.parent
  }
  return null
}

function isBrushSelectable(brush) {
  if (!brush || !brush.visible) return false
  return true
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
  return null
}

function isGizmoHit(event) {
  if (!transformControls.enabled || !transformControlsHelper.visible) return false
  const rect = pickRectElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([transformControlsHelper], true)
  return hits.length > 0
}



// Mode switching
function setTransformMode(mode) {
  transformControls.setMode(mode)
  if (selectedBrush) {
    transformControls.enabled = true
    transformControls.attach(selectedBrush)
  } else if (selectedLight && selectedLight.type !== 'ambient') {
    if (!selectedLight.light || !selectedLight.light.isObject3D) {
      transformControls.detach()
      transformControls.enabled = false
      return
    }
    let lightMode = mode
    if (selectedLight.type === 'directional' && lightMode === 'scale') {
      lightMode = 'translate'
    }
    transformControls.setMode(lightMode)
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

  if (mesh.userData.isLevelBuilderVolume && mesh.userData.levelBuilderType === 'arena') {
    syncArenaControlsFromPreview(mesh, s)
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }
  if (mesh.userData.isLevelBuilderVolume && mesh.userData.levelBuilderType === 'maze') {
    syncMazeControlsFromPreview(mesh, s)
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }
  if (mesh.userData.isLevelBuilderVolume && mesh.userData.levelBuilderType === 'maze-arena') {
    syncMazeArenaControlsFromPreview(mesh, s)
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }

  if (mesh.userData.type === 'player_start') {
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }
  if (mesh.userData.type === 'ramp') {
    if (mesh.userData.rampPoints) {
      const points = mesh.userData.rampPoints
      const centroid = new THREE.Vector3()
      points.forEach((p) => centroid.add(new THREE.Vector3(p[0], p[1], p[2])))
      centroid.divideScalar(4)
      const baseY = Math.min(...points.map((p) => p[1]))
      const scaleVec = new THREE.Vector3(s.x, s.y, s.z)
      const newPoints = points.map((p) => {
        const v = new THREE.Vector3(p[0], p[1], p[2])
        v.x = centroid.x + (v.x - centroid.x) * scaleVec.x
        v.z = centroid.z + (v.z - centroid.z) * scaleVec.z
        v.y = baseY + (v.y - baseY) * scaleVec.y
        return v.toArray()
      })
      mesh.userData.rampPoints = newPoints
      mesh.geometry.dispose()
      mesh.geometry = createRampGeometryFrom4Points(
        newPoints[0],
        newPoints[1],
        newPoints[2],
        newPoints[3],
        mesh.userData.rampScale ?? 1
      )
    } else {
      const [rampWidth, rampRise, rampRun] = mesh.userData.size ?? [1, 1, 1]
      const newWidth = Math.max(0.01, rampWidth * s.x)
      const newRise = Math.max(0.01, rampRise * s.y)
      const newRun = Math.max(0.01, rampRun * s.z)
      mesh.userData.size = [newWidth, newRise, newRun]
      mesh.geometry.dispose()
      mesh.geometry = createWedgeGeometry(newWidth, newRise, newRun)
      mesh.geometry.translate(0, 0, newRun / 2)
    }
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }
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
    version: 2,
    brushes: brushes
      .filter((m) => m.userData.type !== 'imported' && !m.userData.isLevelBuilderVolume && !m.userData.isArenaPreview && !m.userData.isMazePreview)
      .map((m) => {
      const base = {
        id: m.userData.id,
        type: m.userData.type || 'box',
        position: m.position.toArray(),
        rotation: m.rotation.toArray().slice(0, 3),
      }
      if (m.userData.textureKey) base.textureKey = m.userData.textureKey
      if (typeof m.userData.textureIndex === 'number') base.textureIndex = m.userData.textureIndex
      if (base.type === 'cylinder') {
        base.radius = m.userData.radius
        base.height = m.userData.height
      } else if (base.type === 'ramp' && m.userData.rampPoints) {
        base.rampPoints = m.userData.rampPoints.map((p) => [...p])
        base.rampScale = m.userData.rampScale ?? 1
      } else if (m.userData.size) {
        base.size = [...m.userData.size]
      }
      return base
    }),
    lights: lights.map((entry) => {
      const light = entry.light
      const base = {
        type: entry.type,
        color: `#${light.color.getHexString()}`,
        intensity: light.intensity,
        position: light.position.toArray(),
      }
      if (entry.type === 'point' || entry.type === 'spot') {
        base.distance = light.distance
        base.decay = light.decay
      }
      if (entry.type === 'spot') {
        base.angle = light.angle
        base.penumbra = light.penumbra
        base.target = light.target?.position?.toArray()
      }
      if (entry.type === 'directional') {
        base.target = light.target?.position?.toArray()
      }
      return base
    }),
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
    const textureInfo = b.textureKey ? { key: b.textureKey } : { index: b.textureIndex }
    if (b.type === 'cylinder') {
      mesh = createCylinderMesh(
        b.radius ?? 1,
        b.height ?? 2,
        b.position ?? [0, 1, 0],
        brushes.length * 4,
        textureInfo
      )
    } else if (b.type === 'ramp') {
      if (b.rampPoints && b.rampPoints.length === 4) {
        const geom = createRampGeometryFrom4Points(
          b.rampPoints[0],
          b.rampPoints[1],
          b.rampPoints[2],
          b.rampPoints[3],
          b.rampScale ?? 1
        )
        const texture = resolveBrushTexture(resolveBrushTextureInfo({ key: 'maze' }))
        const material = createBrushMaterial(texture, brushes.length * 4, useLitMaterials)
        mesh = new THREE.Mesh(geom, material)
        mesh.material.side = THREE.DoubleSide
        mesh.userData.type = 'ramp'
        mesh.userData.rampPoints = b.rampPoints.map((p) => [...p])
        mesh.userData.rampScale = b.rampScale ?? 1
        mesh.userData.isBrush = true
        mesh.userData.id = b.id || crypto.randomUUID()
        mesh.userData.isUserBrush = true
        applyMazeFloorTexture(mesh)
      } else {
        mesh = createRampMeshFromParams(
          b.size ?? [1, 1, 1],
          b.position ?? [0, 0, 0],
          b.rotation ?? [0, 0, 0]
        )
      }
    } else if (b.type === 'player_start') {
      mesh = createPlayerStartMesh(b.position ?? [0, 0, 0])
    } else {
      mesh = createBrushMesh(
        b.size ?? [2, 2, 2],
        b.position ?? [0, 1, 0],
        brushes.length * 4,
        textureInfo
      )
    }
    mesh.userData.id = b.id || crypto.randomUUID()
    mesh.position.fromArray(
      b.position ?? (b.type === 'ramp' || b.type === 'player_start' ? [0, 0, 0] : [0, 1, 0])
    )
    if (b.rotation) mesh.rotation.fromArray(b.rotation)
    scene.add(mesh)
    brushes.push(mesh)
  })

  lights.forEach((entry) => {
    if (entry.light.target) scene.remove(entry.light.target)
    scene.remove(entry.light)
    if (entry.helper) {
      entry.helper.traverse((child) => {
        child.geometry?.dispose()
        if (child.material && child.material.dispose) child.material.dispose()
      })
    }
  })
  lights.length = 0

  if (data.lights) {
    data.lights.forEach((l) => {
      const color = l.color ?? '#ffffff'
      let light
      let helper = null
      if (l.type === 'point') {
        light = new THREE.PointLight(
          color,
          l.intensity ?? 1,
          l.distance ?? 20,
          l.decay ?? 0.5
        )
        helper = createPointLightHelper(light)
      } else if (l.type === 'spot') {
        light = new THREE.SpotLight(
          color,
          l.intensity ?? 1,
          l.distance ?? 25,
          l.angle ?? Math.PI / 6,
          l.penumbra ?? 0.5,
          l.decay ?? 1
        )
        helper = createSpotLightHelper(light)
      } else if (l.type === 'directional') {
        light = new THREE.DirectionalLight(color, l.intensity ?? 1)
        helper = createDirectionalLightHelper(light)
      } else if (l.type === 'ambient') {
        light = new THREE.AmbientLight(color, l.intensity ?? 0.5)
        helper = createAmbientLightHelper(light)
      } else {
        return
      }
      const defaultPos = l.type === 'point'
        ? [0, 5, 0]
        : l.type === 'spot'
          ? [0, 8, 4]
          : l.type === 'directional'
            ? [5, 10, 5]
            : [0, 3, 0]
      light.position.fromArray(l.position ?? defaultPos)
      light.castShadow = false
      if (light.target) {
        light.target.position.fromArray(l.target ?? [0, 0, 0])
        scene.add(light.target)
      }
      if (helper) {
        light.add(helper)
      }
      scene.add(light)
      const entry = { light, helper, type: l.type }
      if (helper) helper.userData.lightEntry = entry
      lights.push(entry)
    })
  }

  updateSpotLightHelpers()
  updateDirectionalLightHelpers()
  selectBrush(null)
  selectLight(null)
  updateSceneList()
}

async function saveLevel() {
  if (editorMode === 'floor-plan') {
    const saveSvgButton = document.getElementById('fp-save-svg')
    if (saveSvgButton instanceof HTMLButtonElement) {
      saveSvgButton.click()
      return
    }
    showToast('Floor plan tool is still loading. Try Save again in a moment.', { type: 'warn' })
    return
  }
  openExportModal()
}

const { addImportedMeshes, loadLevelFromFile } = createImportSystem({
  loadGlbSceneFromFile,
  loadTextureForSpawn,
  pushUndoState,
  updateBrushMaterials,
  updateSceneList,
  selectBrush,
  brushes,
  scene,
  getUseLitMaterials: () => useLitMaterials,
  addImportedLight,
  showToast,
})

// --- Mode selector ---
let editorMode = 'brush'
const brushControls = document.getElementById('brush-controls')
const levelBuilderControls = document.getElementById('level-builder-controls')
const mazeControls = document.getElementById('maze-controls')
const mazeArenaControls = document.getElementById('maze-arena-controls')
const arenaControls = document.getElementById('arena-controls')
const skyboxControls = document.getElementById('skybox-controls')
const floorPlanControls = document.getElementById('floor-plan-controls')
const toolsSelect = document.getElementById('tools-select')
const headerAddButton = document.getElementById('btn-header-add')
const headerRefreshButton = document.getElementById('btn-header-refresh')
const floorPlanToolRoot = document.getElementById('floor-plan-tool-root')
const fileButtons = document.getElementById('file-buttons')
const floorPlanControlsRoot = document.getElementById('floor-plan-controls-root')
const floorPlanEntitiesRoot = document.getElementById('floor-plan-entities-root')
const cameraControlsPanel = document.getElementById('camera-controls-panel')
const sceneListPanel = document.getElementById('scene-list-panel')
const floorPlanEntitiesPanel = document.getElementById('floor-plan-entities-panel')
const levelBuilderEntitiesPanel = document.getElementById('level-builder-entities-panel')
const levelBuilderEntitiesRoot = document.getElementById('level-builder-entities-root')
let floorPlanToolMounted = false

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

function updateLevelBuilderControlPanels() {
  const isLevelBuilderMode = editorMode === 'level-builder'
  const requestedType = getRequestedLevelBuilderType()
  if (levelBuilderControls) levelBuilderControls.classList.toggle('hidden', !isLevelBuilderMode)
  mazeControls.classList.toggle('hidden', !(isLevelBuilderMode && requestedType === 'maze'))
  mazeArenaControls.classList.toggle('hidden', !(isLevelBuilderMode && requestedType === 'maze-arena'))
  arenaControls.classList.toggle('hidden', !(isLevelBuilderMode && requestedType === 'arena'))
}

function renderLevelBuilderEntitiesList() {
  if (!levelBuilderEntitiesRoot) return
  levelBuilderEntitiesRoot.innerHTML = ''

  const entities = getLastLevelBuilderGeneratedEntities()
  const list = document.createElement('ul')
  list.className = 'floor-plan-entity-list'

  if (entities.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'floor-plan-entity-empty'
    empty.textContent = 'Generate from a Level Builder volume to see entities.'
    list.appendChild(empty)
    levelBuilderEntitiesRoot.appendChild(list)
    return
  }

  entities.forEach((mesh) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'floor-plan-entity-item'
    if (selectedBrush === mesh) btn.classList.add('is-selected')
    const subtype = mesh.userData?.subtype ?? mesh.userData?.type ?? 'object'
    btn.textContent = `${subtype}_${shortId(mesh.userData?.id)}`
    btn.title = `Select ${subtype}`
    btn.setAttribute('aria-label', `Select ${subtype}`)
    btn.addEventListener('click', () => {
      if (!mesh.parent || !brushes.includes(mesh)) return
      selectLight(null)
      selectBrush(mesh)
      focusCameraOnObject(mesh)
    })
    list.appendChild(btn)
  })

  levelBuilderEntitiesRoot.appendChild(list)
}

function getHeaderAddPickerGroup() {
  if (editorMode === 'brush') return 'object'
  if (editorMode === 'level-builder') return 'level-builder'
  if (editorMode === 'floor-plan') return 'floor-plan'
  return null
}

function hasLastLevelBuilderState(type) {
  if (type === 'maze') return Boolean(lastMazeState)
  if (type === 'arena') return Boolean(lastArenaState)
  if (type === 'maze-arena') return Boolean(lastMazeArenaState)
  return false
}

function runLevelBuilderGenerate(type) {
  if (type === 'maze') generateMaze()
  else if (type === 'arena') generateArena()
  else if (type === 'maze-arena') generateMazeArena()
}

function runLevelBuilderIterate(type) {
  if (type === 'maze') regenerateMazeFromLast()
  else if (type === 'arena') regenerateArenaFromLast()
  else if (type === 'maze-arena') regenerateMazeArenaFromLast()
}

function updateHeaderAddButtonState() {
  if (!(headerAddButton instanceof HTMLButtonElement)) return
  const group = getHeaderAddPickerGroup()
  const enabled = group != null
  headerAddButton.disabled = !enabled
  if (group === 'object') {
    headerAddButton.title = 'Add object entity'
    headerAddButton.setAttribute('aria-label', 'Add object entity')
  } else if (group === 'level-builder') {
    headerAddButton.title = 'Add level builder volume'
    headerAddButton.setAttribute('aria-label', 'Add level builder volume')
  } else if (group === 'floor-plan') {
    headerAddButton.title = 'Add floor planner entity'
    headerAddButton.setAttribute('aria-label', 'Add floor planner entity')
  } else {
    headerAddButton.title = 'Add is available in Object Editor, Level Builder, and Floor Planner'
    headerAddButton.setAttribute('aria-label', 'Add unavailable in current tool')
  }
}

function updateHeaderRefreshButtonState() {
  if (!(headerRefreshButton instanceof HTMLButtonElement)) return
  if (editorMode === 'floor-plan') {
    headerRefreshButton.disabled = false
    headerRefreshButton.title = 'Randomize floor plan seed'
    headerRefreshButton.setAttribute('aria-label', 'Randomize floor plan seed')
    return
  }
  const isLevelBuilderMode = editorMode === 'level-builder'
  if (!isLevelBuilderMode) {
    headerRefreshButton.disabled = true
    headerRefreshButton.title = 'Refresh is available in Level Builder'
    headerRefreshButton.setAttribute('aria-label', 'Refresh unavailable in current tool')
    return
  }
  const selectedVolume = getSelectedLevelBuilderVolume()
  const selectedType = selectedVolume?.userData?.levelBuilderType
  const isValidSelected = Boolean(selectedVolume) && isPreviewValid(selectedVolume, null)
  const fallbackType = lastLevelBuilderGeneratedType
  const canIterateFallback = Boolean(fallbackType) && hasLastLevelBuilderState(fallbackType)
  headerRefreshButton.disabled = !(isValidSelected || canIterateFallback)
  if (isValidSelected && selectedType) {
    const action = hasLastLevelBuilderState(selectedType) ? 'Iterate' : 'Generate'
    headerRefreshButton.title = `${action} selected volume`
    headerRefreshButton.setAttribute('aria-label', `${action.toLowerCase()} selected level builder volume`)
    return
  }
  if (canIterateFallback) {
    headerRefreshButton.title = 'Iterate last generated volume'
    headerRefreshButton.setAttribute('aria-label', 'Iterate last generated level builder volume')
    return
  }
  headerRefreshButton.title = 'Select a valid level builder volume'
  headerRefreshButton.setAttribute('aria-label', 'No valid level builder action available')
}

function runLevelBuilderHeaderRefresh() {
  if (editorMode === 'floor-plan') {
    const randomizeSeedButton = document.getElementById('fp-randomize-seed')
    if (randomizeSeedButton instanceof HTMLButtonElement) {
      randomizeSeedButton.click()
      return
    }
    showToast('Floor planner is still loading. Try refresh again in a moment.', { type: 'warn' })
    return
  }
  if (editorMode !== 'level-builder') return
  const selectedVolume = getSelectedLevelBuilderVolume()
  const selectedType = selectedVolume?.userData?.levelBuilderType
  if (selectedVolume && isPreviewValid(selectedVolume, null) && selectedType) {
    if (hasLastLevelBuilderState(selectedType)) runLevelBuilderIterate(selectedType)
    else runLevelBuilderGenerate(selectedType)
    return
  }
  const fallbackType = lastLevelBuilderGeneratedType
  if (fallbackType && hasLastLevelBuilderState(fallbackType)) {
    runLevelBuilderIterate(fallbackType)
    return
  }
  if (selectedVolume) {
    updatePreviewValidity(selectedVolume, null)
    showToast('Selected volume is invalid. Move or resize it, then try again.', { type: 'warn' })
  } else {
    showToast('Select a Level Builder volume first.', { type: 'warn' })
  }
  updateHeaderRefreshButtonState()
}

function setEditorMode(mode) {
  editorMode = mode
  const isFloorPlanMode = mode === 'floor-plan'
  if (rampCreatorState.active) cancelRampCreator()
  if (toolsSelect && toolsSelect.value !== mode) {
    toolsSelect.value = mode
  }
  if (floorPlanToolRoot) {
    floorPlanToolRoot.classList.toggle('hidden', !isFloorPlanMode)
    if (isFloorPlanMode && !floorPlanToolMounted) {
      mountFloorPlanTool({
        previewContainer: floorPlanToolRoot,
        controlsContainer: floorPlanControlsRoot,
        entitiesContainer: floorPlanEntitiesRoot,
      })
      floorPlanToolMounted = true
    }
  }
  viewport.classList.toggle('hidden', isFloorPlanMode)
  if (fileButtons) fileButtons.classList.remove('hidden')
  brushControls.classList.toggle('hidden', mode !== 'brush')
  updateLevelBuilderControlPanels()
  skyboxControls.classList.toggle('hidden', mode !== 'skybox')
  floorPlanControls.classList.toggle('hidden', !isFloorPlanMode)
  if (cameraControlsPanel) cameraControlsPanel.classList.toggle('hidden', isFloorPlanMode)
  if (sceneListPanel) sceneListPanel.classList.toggle('hidden', mode !== 'brush')
  if (floorPlanEntitiesPanel) floorPlanEntitiesPanel.classList.toggle('hidden', !isFloorPlanMode)
  if (levelBuilderEntitiesPanel) levelBuilderEntitiesPanel.classList.toggle('hidden', mode !== 'level-builder')
  updateHeaderAddButtonState()
  updateHeaderRefreshButtonState()
  sky.visible = mode === 'skybox' && !isFloorPlanMode
  useLitMaterials = mode === 'skybox' && !isFloorPlanMode
  updateBrushMaterials(useLitMaterials)
  updateShadowState(mode === 'skybox')
  if (mode === 'level-builder') {
    updateLevelBuilderControlPanels()
    renderLevelBuilderEntitiesList()
    updateArenaPreviewVisibility()
    updateMazePreviewVisibility()
    getLevelBuilderVolumes('maze-arena').forEach((mesh) => {
      mesh.visible = true
    })
    updateArenaPreviewValidity()
    updateMazePreviewValidity()
    setCurrentTool('translate')
    setTransformMode('translate')
  } else {
    getLevelBuilderVolumes().forEach((mesh) => {
      mesh.visible = false
    })
  }
  updateHeaderRefreshButtonState()
}

toolsSelect?.addEventListener('change', (event) => {
  const nextMode = event.target.value
  setEditorMode(nextMode)
})

setEditorMode(toolsSelect?.value ?? 'brush')

document.getElementById('level-builder-type')?.addEventListener('change', () => {
  if (isLevelBuilderVolume(selectedBrush)) {
    updateLevelBuilderTypeSelect(selectedBrush.userData.levelBuilderType)
  }
  updateLevelBuilderControlPanels()
})

// --- Collapsible controls area ---
const controlsArea = document.getElementById('controls-area')
const controlsAreaToggle = document.getElementById('controls-area-toggle')
if (controlsArea && controlsAreaToggle) {
  controlsAreaToggle.addEventListener('click', () => {
    controlsArea.classList.toggle('collapsed')
    controlsAreaToggle.setAttribute('aria-expanded', String(!controlsArea.classList.contains('collapsed')))
  })
}

// --- Panel headers (always expanded; main controls toggle handles collapse) ---
document.querySelectorAll('.panel-header').forEach((btn) => {
  const panel = btn.closest('.panel')
  if (panel) panel.classList.remove('collapsed')
  btn.setAttribute('aria-expanded', 'true')
  btn.setAttribute('aria-disabled', 'true')
  btn.tabIndex = -1
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
document.getElementById('maze-room-count').addEventListener('input', (e) => {
  document.getElementById('maze-room-count-value').textContent = e.target.value
})
document.getElementById('maze-center-size').addEventListener('input', (e) => {
  document.getElementById('maze-center-size-value').textContent = e.target.value
})
document.getElementById('maze-flat-floor-size')?.addEventListener('input', (e) => {
  const el = document.getElementById('maze-flat-floor-size-value')
  if (el) el.textContent = e.target.value
})

// --- Arena slider value display ---
function bindArenaSlider(id, valueId, onChange) {
  const input = document.getElementById(id)
  const valueEl = document.getElementById(valueId)
  if (!input || !valueEl) return
  input.addEventListener('input', (e) => {
    valueEl.textContent = e.target.value
    if (onChange) onChange()
  })
}
bindArenaSlider('arena-cols', 'arena-cols-value', updateArenaPreviewFromControls)
bindArenaSlider('arena-rows', 'arena-rows-value', updateArenaPreviewFromControls)
bindArenaSlider('arena-tile', 'arena-tile-value', updateArenaPreviewFromControls)
bindArenaSlider('arena-height', 'arena-height-value', updateArenaPreviewFromControls)
bindArenaSlider('arena-obstacle-height', 'arena-obstacle-height-value', updateArenaPreviewFromControls)
bindArenaSlider('arena-density', 'arena-density-value')
bindArenaSlider('arena-buildings', 'arena-buildings-value')
bindArenaSlider('arena-smoothing', 'arena-smoothing-value')
bindArenaSlider('arena-corridor', 'arena-corridor-value')
bindArenaSlider('arena-exit-width', 'arena-exit-width-value')
bindArenaSlider('arena-candidates', 'arena-candidates-value')

// --- Maze preview updates ---
function bindMazeSlider(id, valueId, onChange) {
  const input = document.getElementById(id)
  const valueEl = document.getElementById(valueId)
  if (!input || !valueEl) return
  input.addEventListener('input', (e) => {
    valueEl.textContent = e.target.value
    if (onChange) onChange()
  })
}
bindMazeSlider('maze-cols', 'maze-cols-value', updateMazePreviewFromControls)
bindMazeSlider('maze-rows', 'maze-rows-value', updateMazePreviewFromControls)
bindMazeSlider('maze-space', 'maze-space-value', updateMazePreviewFromControls)
bindMazeSlider('maze-height', 'maze-height-value', updateMazePreviewFromControls)

bindMazeSlider('maze-arena-cols', 'maze-arena-cols-value', updateMazeArenaPreviewFromControls)
bindMazeSlider('maze-arena-rows', 'maze-arena-rows-value', updateMazeArenaPreviewFromControls)
bindMazeSlider('maze-arena-arena-count', 'maze-arena-arena-count-value')
bindMazeSlider('maze-arena-space', 'maze-arena-space-value', updateMazeArenaPreviewFromControls)
bindMazeSlider('maze-arena-thickness', 'maze-arena-thickness-value')
bindMazeSlider('maze-arena-height', 'maze-arena-height-value', updateMazeArenaPreviewFromControls)
bindMazeSlider('maze-arena-density', 'maze-arena-density-value')
bindMazeSlider('maze-arena-buildings', 'maze-arena-buildings-value')

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

// --- Camera speed control ---
const cameraSpeedInput = document.getElementById('camera-speed')
const cameraSpeedValue = document.getElementById('camera-speed-value')
let cameraZoomSpeed = 0
function applyCameraSpeed() {
  if (!cameraSpeedInput) return
  const value = parseFloat(cameraSpeedInput.value)
  cameraZoomSpeed = Number.isFinite(value) ? value : 0
  if (cameraSpeedValue) cameraSpeedValue.textContent = cameraSpeedInput.value
}
if (cameraSpeedInput) {
  cameraSpeedInput.addEventListener('input', applyCameraSpeed)
  applyCameraSpeed()
}

const cameraFlySpeedInput = document.getElementById('camera-fly-speed')
const cameraFlySpeedValue = document.getElementById('camera-fly-speed-value')
let cameraFlySpeed = 6
function applyCameraFlySpeed() {
  if (!cameraFlySpeedInput) return
  const value = parseFloat(cameraFlySpeedInput.value)
  cameraFlySpeed = Number.isFinite(value) ? value : 0
  if (cameraFlySpeedValue) cameraFlySpeedValue.textContent = cameraFlySpeedInput.value
}
if (cameraFlySpeedInput) {
  cameraFlySpeedInput.addEventListener('input', applyCameraFlySpeed)
  applyCameraFlySpeed()
}

const outlineWidthInput = document.getElementById('outline-width')
const outlineWidthValue = document.getElementById('outline-width-value')
let outlineWidth = 2
function applyOutlineWidth() {
  if (!outlineWidthInput) return
  const value = parseFloat(outlineWidthInput.value)
  outlineWidth = Number.isFinite(value) ? value : 0
  if (outlineWidthValue) outlineWidthValue.textContent = outlineWidthInput.value
  brushes.forEach((brush) => {
    const outline = brush?.userData?.outline
    if (outline?.material && 'linewidth' in outline.material) {
      outline.material.linewidth = outlineWidth
      outline.material.needsUpdate = true
    }
  })
}
if (outlineWidthInput) {
  outlineWidthInput.addEventListener('input', applyOutlineWidth)
  applyOutlineWidth()
}

// --- Fly movement (WASD + mouse look) ---
// On Windows: right-click to look (common editor convention). On Mac: left-click.
const LOOK_BUTTON = /Win/i.test(navigator.platform) ? 2 : 0
const flyKeys = { w: false, a: false, s: false, d: false, q: false, e: false }
let flyMouseDown = false
let lastFlyTime = performance.now()
let isLooking = false
let lookYaw = camera.rotation.y
let lookPitch = camera.rotation.x
const LOOK_SENSITIVITY = 0.002
let lastLookX = null
let lastLookY = null
const lockElement = renderer.domElement

function updateLookTarget() {
  const distance = camera.position.distanceTo(orbitControls.target) || 1
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  orbitControls.target.copy(camera.position).addScaledVector(forward, distance)
}

function shouldIgnoreKeyInput() {
  const active = document.activeElement
  return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === LOOK_BUTTON) {
    flyMouseDown = true
    if (!isTransformDragging) {
      lockElement.requestPointerLock?.()
    }
  }
})

document.addEventListener('pointerup', (e) => {
  if (e.button === LOOK_BUTTON) {
    flyMouseDown = false
    document.exitPointerLock?.()
  }
  lastLookX = null
  lastLookY = null
})

document.addEventListener('pointercancel', () => {
  flyMouseDown = false
  document.exitPointerLock?.()
  lastLookX = null
  lastLookY = null
})

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault()
})

document.addEventListener('pointerlockchange', () => {
  isLooking = document.pointerLockElement === lockElement
  if (isLooking) {
    lookYaw = camera.rotation.y
    lookPitch = camera.rotation.x
  }
})

renderer.domElement.addEventListener('pointermove', (e) => {
  updateRampCursorPreview(e.clientX, e.clientY)
  if (!isLooking) return
  const dx = e.movementX ?? 0
  const dy = e.movementY ?? 0
  lookYaw -= dx * LOOK_SENSITIVITY
  lookPitch -= dy * LOOK_SENSITIVITY
  const limit = Math.PI / 2 - 0.01
  lookPitch = Math.max(-limit, Math.min(limit, lookPitch))
  camera.rotation.order = 'YXZ'
  camera.rotation.y = lookYaw
  camera.rotation.x = lookPitch
  updateLookTarget()
})

document.addEventListener('keydown', (e) => {
  if (shouldIgnoreKeyInput()) return
  if (e.code === 'KeyW') flyKeys.w = true
  if (e.code === 'KeyA') flyKeys.a = true
  if (e.code === 'KeyS') flyKeys.s = true
  if (e.code === 'KeyD') flyKeys.d = true
  if (e.code === 'KeyQ') flyKeys.q = true
  if (e.code === 'KeyE') flyKeys.e = true
})

document.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') flyKeys.w = false
  if (e.code === 'KeyA') flyKeys.a = false
  if (e.code === 'KeyS') flyKeys.s = false
  if (e.code === 'KeyD') flyKeys.d = false
  if (e.code === 'KeyQ') flyKeys.q = false
  if (e.code === 'KeyE') flyKeys.e = false
})

renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (cameraZoomSpeed === 0) return
    e.preventDefault()
    const target = orbitControls.target
    const toTarget = target.clone().sub(camera.position)
    const distance = toTarget.length()
    if (distance <= 0.0001) return
    const direction = toTarget.normalize()
    const sign = e.deltaY > 0 ? -1 : 1
    const step = cameraZoomSpeed * sign
    const nextDistance = distance - step
    const clampedStep = nextDistance <= 0.05 ? distance - 0.05 : step
    const maxDistance = camera.far * 0.95
    const finalDistance = distance - clampedStep
    if (finalDistance > maxDistance) {
      camera.position.addScaledVector(direction, distance - maxDistance)
    } else {
      camera.position.addScaledVector(direction, clampedStep)
    }
    orbitControls.update()
  },
  { passive: false }
)

// Show/hide center room size when layout changes
function updateCenterRoomVisibility() {
  const centerOut = document.getElementById('maze-start-from-center').checked
  document.getElementById('center-room-row').classList.toggle('hidden', !centerOut)
}
document.getElementById('maze-start-from-center').addEventListener('change', updateCenterRoomVisibility)
updateCenterRoomVisibility()

updateIterateButtons()
document.getElementById('maze-preview-visible')?.addEventListener('change', () => {
  updateMazePreviewVisibility()
  updateMazePreviewValidity()
})
document.getElementById('arena-preview-visible')?.addEventListener('change', () => {
  updateArenaPreviewVisibility()
  updateArenaPreviewValidity()
})
document.getElementById('maze-arena-preview-visible')?.addEventListener('change', () => {
  const checkbox = document.getElementById('maze-arena-preview-visible')
  if (checkbox) checkbox.checked = true
  getLevelBuilderVolumes('maze-arena').forEach((mesh) => {
    mesh.visible = true
  })
})

document.getElementById('btn-generate-arena').addEventListener('click', generateArena)
document.getElementById('btn-iterate-arena').addEventListener('click', regenerateArenaFromLast)
document.getElementById('btn-generate-maze-arena').addEventListener('click', generateMazeArena)
document.getElementById('btn-iterate-maze-arena').addEventListener('click', regenerateMazeArenaFromLast)

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
  getEditorMode() {
    return editorMode
  },
  shouldSuppressSelect: () => isRampCreatorActive(),
  onRampCreatorPick: handleRampCreatorPick,
  deleteSelected,
  cloneBrush,
  pushUndoState,
  undo,
  transformControls,
  orbitControls,
  bakeScaleIntoGeometry,
  pickBrush,
  isGizmoHit,
  pickLight,
  get selectedLight() {
    return selectedLight
  },
  selectLight,
  deleteSelectedLight,
})
updateLightControls()
updateSceneList()

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
const defaultTextureIndex = TEXTURE_POOL.findIndex(
  (entry) => entry.palette === 'Dark' && entry.file === 'texture_01.png'
)
if (defaultTextureIndex >= 0) {
  textureSelect.value = String(defaultTextureIndex)
}

// --- Light controls ---
function applyDirectionalDirectionFromInputs() {
  if (!selectedLight || selectedLight.type !== 'directional') return
  const x = parseFloat(document.getElementById('directional-light-dir-x').value)
  const y = parseFloat(document.getElementById('directional-light-dir-y').value)
  const z = parseFloat(document.getElementById('directional-light-dir-z').value)
  const dir = new THREE.Vector3(x, y, z)
  if (dir.lengthSq() === 0) dir.set(0, -1, 0)
  dir.normalize()
  selectedLight.light.target.position.copy(selectedLight.light.position).add(dir)
  updateDirectionalLightHelpers()
}

document.getElementById('point-light-color').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'point') return
  selectedLight.light.color.set(e.target.value)
  updateLightHelperColor(selectedLight)
})
document.getElementById('point-light-intensity').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'point') return
  const value = parseFloat(e.target.value)
  selectedLight.light.intensity = value
  document.getElementById('point-light-intensity-value').textContent = value
})
document.getElementById('point-light-radius').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'point') return
  const value = parseFloat(e.target.value)
  selectedLight.light.distance = value
  document.getElementById('point-light-radius-value').textContent = value
})

document.getElementById('spot-light-color').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'spot') return
  selectedLight.light.color.set(e.target.value)
  updateLightHelperColor(selectedLight)
})
document.getElementById('spot-light-intensity').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'spot') return
  const value = parseFloat(e.target.value)
  selectedLight.light.intensity = value
  document.getElementById('spot-light-intensity-value').textContent = value
})
document.getElementById('spot-light-radius').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'spot') return
  const value = parseFloat(e.target.value)
  selectedLight.light.distance = value
  document.getElementById('spot-light-radius-value').textContent = value
})
document.getElementById('spot-light-angle').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'spot') return
  const value = parseFloat(e.target.value)
  selectedLight.light.angle = THREE.MathUtils.degToRad(value)
  document.getElementById('spot-light-angle-value').textContent = value
  updateSpotLightHelpers()
})

document.getElementById('ambient-light-color').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'ambient') return
  selectedLight.light.color.set(e.target.value)
  updateLightHelperColor(selectedLight)
})
document.getElementById('ambient-light-intensity').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'ambient') return
  const value = parseFloat(e.target.value)
  selectedLight.light.intensity = value
  document.getElementById('ambient-light-intensity-value').textContent = value
})

document.getElementById('directional-light-color').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'directional') return
  selectedLight.light.color.set(e.target.value)
  updateLightHelperColor(selectedLight)
})
document.getElementById('directional-light-intensity').addEventListener('input', (e) => {
  if (!selectedLight || selectedLight.type !== 'directional') return
  const value = parseFloat(e.target.value)
  selectedLight.light.intensity = value
  document.getElementById('directional-light-intensity-value').textContent = value
})
document.getElementById('directional-light-dir-x').addEventListener('input', applyDirectionalDirectionFromInputs)
document.getElementById('directional-light-dir-y').addEventListener('input', applyDirectionalDirectionFromInputs)
document.getElementById('directional-light-dir-z').addEventListener('input', applyDirectionalDirectionFromInputs)

// --- Toolbar ---
const entityPickerOverlay = document.getElementById('entity-picker-overlay')
const entityPickerTitle = document.getElementById('entity-picker-title')
let activeEntityPickerGroup = 'object'

function closeEntityPicker() {
  if (!entityPickerOverlay) return
  entityPickerOverlay.hidden = true
}

function addEntityByType(entityType) {
  switch (entityType) {
    case 'floor': addFloorBrush(); return
    case 'wall': addWallBrush(); return
    case 'cylinder': addCylinderBrush(); return
    case 'ramp': startRampCreator(); return
    case 'player_start': addPlayerStartMarker(); return
    case 'point_light': addPointLight(); return
    case 'spot_light': addSpotLight(); return
    case 'directional_light': addDirectionalLight(); return
    case 'ambient_light': addAmbientLight(); return
    case 'level_builder_maze': {
      const mesh = addMazeVolume()
      selectBrush(mesh)
      focusCameraOnObject(mesh)
      updateLevelBuilderTypeSelect('maze')
      setEditorMode('level-builder')
      updateSceneList()
      return
    }
    case 'level_builder_maze_arena': {
      const mesh = addMazeArenaVolume()
      selectBrush(mesh)
      focusCameraOnObject(mesh)
      updateLevelBuilderTypeSelect('maze-arena')
      setEditorMode('level-builder')
      updateSceneList()
      return
    }
    case 'level_builder_arena': {
      const mesh = addArenaVolume()
      selectBrush(mesh)
      focusCameraOnObject(mesh)
      updateLevelBuilderTypeSelect('arena')
      setEditorMode('level-builder')
      updateSceneList()
      return
    }
    default: return
  }
}

function openEntityPicker(group = 'object') {
  if (!entityPickerOverlay) return
  if (group === 'light') activeEntityPickerGroup = 'light'
  else if (group === 'level-builder') activeEntityPickerGroup = 'level-builder'
  else activeEntityPickerGroup = 'object'
  entityPickerTitle.textContent = activeEntityPickerGroup === 'light'
    ? 'Add light'
    : activeEntityPickerGroup === 'level-builder'
      ? 'Add level builder volume'
      : 'Add object'
  entityPickerOverlay.querySelectorAll('[data-entity-group]').forEach((option) => {
    if (!(option instanceof HTMLElement)) return
    option.hidden = option.dataset.entityGroup !== activeEntityPickerGroup
  })
  entityPickerOverlay.hidden = false
}

document.getElementById('btn-open-object-entity-picker')?.addEventListener('click', () => openEntityPicker('object'))
document.getElementById('btn-open-light-entity-picker')?.addEventListener('click', () => openEntityPicker('light'))
document.getElementById('btn-open-level-builder-entity-picker')?.addEventListener('click', () => openEntityPicker('level-builder'))
headerAddButton?.addEventListener('click', () => {
  const group = getHeaderAddPickerGroup()
  if (!group) return
  if (group === 'floor-plan') {
    const floorPlanAddButton = document.getElementById('fp-add-entity')
    if (floorPlanAddButton instanceof HTMLButtonElement) {
      floorPlanAddButton.click()
      return
    }
    showToast('Floor planner is still loading. Try add again in a moment.', { type: 'warn' })
    return
  }
  openEntityPicker(group)
})
headerRefreshButton?.addEventListener('click', runLevelBuilderHeaderRefresh)
entityPickerOverlay?.addEventListener('click', (event) => {
  if (event.target === entityPickerOverlay) {
    closeEntityPicker()
    return
  }
  if (!(event.target instanceof HTMLElement)) return
  const option = event.target.closest('[data-entity-type]')
  if (option instanceof HTMLElement) {
    const entityType = option.dataset.entityType
    if (entityType) {
      addEntityByType(entityType)
      closeEntityPicker()
    }
    return
  }
  if (event.target.closest('.entity-picker-cancel')) {
    closeEntityPicker()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && entityPickerOverlay && !entityPickerOverlay.hidden) {
    closeEntityPicker()
  }
})

document.getElementById('btn-ramp-place')?.addEventListener('click', placeRampFromCreator)
document.getElementById('btn-ramp-cancel')?.addEventListener('click', cancelRampCreator)


document.getElementById('ramp-scale')?.addEventListener('input', (e) => {
  const el = document.getElementById('ramp-scale-value')
  if (el) el.textContent = e.target.value
  updateRampPreview()
  updateRampCreatorStatus()
})
document.getElementById('btn-move').addEventListener('click', () => inputHandler.setTransformMode('translate'))
document.getElementById('btn-rotate').addEventListener('click', () => inputHandler.setTransformMode('rotate'))
document.getElementById('btn-scale').addEventListener('click', () => inputHandler.setTransformMode('scale'))
document.getElementById('btn-delete').addEventListener('click', () => inputHandler.deleteSelected())
document.getElementById('btn-generate-maze').addEventListener('click', generateMaze)
document.getElementById('btn-iterate-maze').addEventListener('click', regenerateMazeFromLast)
document.getElementById('btn-save').addEventListener('click', () => saveLevel())
document.getElementById('btn-load').addEventListener('click', () => loadLevelFromFile())
document.getElementById('btn-export-cancel')?.addEventListener('click', () => {
  document.getElementById('export-modal')?.classList.add('hidden')
})

// --- Resize ---
const resizeObserver = new ResizeObserver(() => {
  const w = viewport.clientWidth
  const h = viewport.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  updateOutlineResolution(w, h)
})
resizeObserver.observe(viewport)

// --- Loop ---
function animate() {
  requestAnimationFrame(animate)
  const now = performance.now()
  const delta = Math.min(0.05, (now - lastFlyTime) / 1000)
  lastFlyTime = now

  if (flyMouseDown && (flyKeys.w || flyKeys.a || flyKeys.s || flyKeys.d || flyKeys.q || flyKeys.e)) {
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() > 0) forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    const move = new THREE.Vector3()
    if (flyKeys.w) move.add(forward)
    if (flyKeys.s) move.sub(forward)
    if (flyKeys.d) move.add(right)
    if (flyKeys.a) move.sub(right)
    if (flyKeys.e) move.add(camera.up)
    if (flyKeys.q) move.sub(camera.up)
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(cameraFlySpeed * delta)
      camera.position.add(move)
      orbitControls.target.add(move)
      orbitControls.update()
    }
  }
  orbitControls.update()
  updateSpotLightHelpers()
  updateDirectionalLightHelpers()
  if (getLevelBuilderVolumes('arena').some((mesh) => mesh.visible)) updateArenaPreviewValidity()
  if (getLevelBuilderVolumes('maze').some((mesh) => mesh.visible) || getLevelBuilderVolumes('maze-arena').some((mesh) => mesh.visible)) {
    updateMazePreviewValidity()
  }
  if (editorMode === 'level-builder') updateHeaderRefreshButtonState()
  renderer.render(scene, camera)
}
animate()
