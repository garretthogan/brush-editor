import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { saveGlvl, loadGlvlFromFile } from './lib/glvl-io.js'
import { loadGlbFromFile } from './lib/glb-io.js'
import { generateMaze as generateMazeGrid } from './lib/maze-generator.js'
import { generateArena as generateArenaGrid } from './lib/arena-generator.js'
import { createInputHandler } from './lib/input-commands.js'

const GRID_COLOR = 0x333333
const OUTLINE_COLOR = 0xff8800
let useLitMaterials = false

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
const textureCacheByIndex = new Map()

function getTextureUrl(index) {
  const { palette, file } = TEXTURE_POOL[index]
  return `${baseUrl}textures/${palette}/${file}`
}

function getSelectedTextureIndex() {
  const select = document.getElementById('texture-select')
  const value = select?.value
  return value === 'random' || value === ''
    ? Math.floor(Math.random() * TEXTURE_POOL.length)
    : Math.max(0, Math.min(parseInt(value, 10) || 0, TEXTURE_POOL.length - 1))
}

function loadTextureByIndex(index) {
  const url = getTextureUrl(index)
  const tex = textureLoader.load(url)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function getTextureIndex(palette, file) {
  const idx = TEXTURE_POOL.findIndex((entry) => entry.palette === palette && entry.file === file)
  return idx >= 0 ? idx : 0
}

const TEXTURE_INDEX = {
  mazeWall: getTextureIndex('Dark', 'texture_13.png'),
  mazeFloor: getTextureIndex('Dark', 'texture_01.png'),
  arenaBase: getTextureIndex('Dark', 'texture_01.png'),
  arenaObstacle: getTextureIndex('Orange', 'texture_02.png'),
}

function getTextureByIndex(index) {
  const clamped = Math.max(0, Math.min(index ?? 0, TEXTURE_POOL.length - 1))
  if (textureCacheByIndex.has(clamped)) return textureCacheByIndex.get(clamped)
  const tex = loadTextureByIndex(clamped)
  if (typeof maxAnisotropy === 'number') tex.anisotropy = maxAnisotropy
  textureCacheByIndex.set(clamped, tex)
  return tex
}

function resolveBrushTexture(textureInfo) {
  if (textureInfo?.key === 'arena') return getTextureByIndex(TEXTURE_INDEX.arenaBase)
  if (typeof textureInfo?.index === 'number') return getTextureByIndex(textureInfo.index)
  const index = getSelectedTextureIndex()
  return getTextureByIndex(index)
}

function resolveBrushTextureInfo(textureInfo) {
  if (textureInfo?.key === 'arena') return { index: TEXTURE_INDEX.arenaBase }
  if (typeof textureInfo?.index === 'number') return { index: textureInfo.index }
  return { index: getSelectedTextureIndex() }
}

function createBrushMaterial(texture, depthBias, lit) {
  if (lit) {
    return new THREE.MeshStandardMaterial({
      map: texture,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: depthBias,
    })
  }
  return new THREE.MeshBasicMaterial({
    map: texture,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: depthBias,
  })
}

function applyTextureIndex(mesh, index) {
  if (!mesh?.material) return
  const tex = getTextureByIndex(index)
  if (mesh.material.map && mesh.material.map !== tex) {
    mesh.material.map.dispose()
  }
  mesh.material.map = tex
  mesh.material.needsUpdate = true
  mesh.userData.textureKey = null
  mesh.userData.textureIndex = index
}

function applyMazeWallTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.mazeWall)
}

function applyMazeFloorTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.mazeFloor)
}

function applyArenaBaseTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.arenaBase)
}

function applyArenaObstacleTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.arenaObstacle)
}

function updateBrushMaterials(lit) {
  brushes.forEach((mesh) => {
    if (!mesh?.material || mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) return
    if (mesh.userData?.type === 'imported') return
    const texture = mesh.material.map ?? null
    const depthBias = mesh.material.polygonOffsetUnits ?? 0
    const nextMaterial = createBrushMaterial(texture, depthBias, lit)
    if (mesh.material.map && mesh.material.map !== texture) {
      mesh.material.map.dispose()
    }
    mesh.material.dispose()
    mesh.material = nextMaterial
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// --- Scene Setup ---
const viewport = document.getElementById('viewport')
let pickRectElement = viewport
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000000)

// Sky (Preetham model) - added as mesh so it can be toggled or edited
const sky = new Sky()
sky.scale.setScalar(450000)
scene.add(sky)
const sun = new THREE.Vector3()
sky.visible = false

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000)
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
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

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
orbitControls.autoRotate = false
orbitControls.autoRotateSpeed = 0
orbitControls.enableZoom = false
orbitControls.enableRotate = false
orbitControls.enablePan = false

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
let lastArenaWallHeight = 3
let lastMazeState = null
let lastArenaState = null
let lastMazePlacement = null
let lastArenaPlacement = null
let lastMazeBrushes = []
let lastArenaBrushes = []
let activeGenerationCollector = null
let activeGenerationGroup = null
let mazeGenerationCount = 0
let arenaGenerationCount = 0
let lastMazeGroupId = null
let lastArenaGroupId = null

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

function updateIterateButtons() {
  const mazeBtn = document.getElementById('btn-iterate-maze')
  if (mazeBtn) mazeBtn.disabled = !lastMazeState
  const arenaBtn = document.getElementById('btn-iterate-arena')
  if (arenaBtn) arenaBtn.disabled = !lastArenaState
}

function updateSceneList() {
  const container = document.getElementById('scene-list')
  if (!container) return
  container.innerHTML = ''

  const makeLabel = (text) => {
    const el = document.createElement('div')
    el.className = 'scene-list-title'
    el.textContent = text
    return el
  }

  const makeButton = (label, onClick) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'scene-list-item'
    btn.textContent = label
    btn.addEventListener('click', onClick)
    return btn
  }

  const shortId = (id) => (id ? String(id).slice(0, 8) : 'no-id')

  const objectList = document.createElement('div')
  const groups = new Map()
  const loose = []

  brushes.forEach((mesh) => {
    if (!mesh || mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) return
    if (!mesh.parent) return
    const groupId = mesh.userData?.generatorGroup
    const subtype = mesh.userData?.subtype
    const labelBase = subtype ?? mesh.userData?.type ?? 'object'
    const label = `${labelBase}_${shortId(mesh.userData?.id)}`
    if (groupId) {
      if (!groups.has(groupId)) groups.set(groupId, [])
      groups.get(groupId).push({ mesh, label })
    } else {
      loose.push({ mesh, label })
    }
  })

  if (groups.size > 0 || loose.length > 0) {
    objectList.appendChild(makeLabel('Objects'))
  }

  Array.from(groups.keys()).sort().forEach((groupId) => {
    const details = document.createElement('details')
    details.className = 'scene-list-group'
    details.open = false
    const summary = document.createElement('summary')
    summary.textContent = groupId
    details.appendChild(summary)
    const sublist = document.createElement('div')
    sublist.className = 'scene-list-subitems'
    groups.get(groupId).forEach(({ mesh, label }) => {
      sublist.appendChild(makeButton(label, () => {
        selectLight(null)
        selectBrush(mesh)
      }))
    })
    details.appendChild(sublist)
    objectList.appendChild(details)
  })

  loose.forEach(({ mesh, label }) => {
    objectList.appendChild(makeButton(label, () => {
      selectLight(null)
      selectBrush(mesh)
    }))
  })

  container.appendChild(objectList)

  const lightList = document.createElement('div')
  if (lights.length > 0) {
    lightList.appendChild(makeLabel('Lights'))
  }
  lights.forEach((entry, idx) => {
    if (!entry?.light?.parent) return
    const label = `${entry.type}_light_${String(idx + 1).padStart(2, '0')}`
    lightList.appendChild(makeButton(label, () => {
      selectBrush(null)
      selectLight(entry)
    }))
  })
  container.appendChild(lightList)
}

function updateMazePreviewVisibility() {
  const checkbox = document.getElementById('maze-preview-visible')
  const shouldShow = checkbox?.checked ?? true
  if (shouldShow) {
    const preview = ensureMazePreview()
    preview.visible = true
  } else if (mazePreview) {
    mazePreview.visible = false
    if (selectedBrush === mazePreview) selectBrush(null)
  }
}

function updateArenaPreviewVisibility() {
  const checkbox = document.getElementById('arena-preview-visible')
  const shouldShow = checkbox?.checked ?? true
  if (shouldShow) {
    const preview = ensureArenaPreview()
    preview.visible = true
  } else if (arenaPreview) {
    arenaPreview.visible = false
    if (selectedBrush === arenaPreview) selectBrush(null)
  }
}

// --- Light State ---
const lights = [] // { light, helper, type: 'point'|'spot'|'directional'|'ambient' }
let selectedLight = null

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
  mesh.castShadow = false
  mesh.receiveShadow = false
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
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.isBrush = true
  mesh.userData.type = 'cylinder'
  mesh.userData.radius = radius
  mesh.userData.height = height
  if (resolvedInfo.key) mesh.userData.textureKey = resolvedInfo.key
  if (typeof resolvedInfo.index === 'number') mesh.userData.textureIndex = resolvedInfo.index
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
  updateSceneList()
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
  updateSceneList()
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
  updateSceneList()
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
  updateSceneList()
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
  updateSceneList()
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
}

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

function getArenaControls() {
  const wallHeight = parseFloat(document.getElementById('arena-height').value)
  const obstacleRaw = parseFloat(document.getElementById('arena-obstacle-height').value)
  const obstacleHeight = Math.min(obstacleRaw, wallHeight)
  return {
    cols: parseInt(document.getElementById('arena-cols').value, 10),
    rows: parseInt(document.getElementById('arena-rows').value, 10),
    tileSize: parseFloat(document.getElementById('arena-tile').value),
    wallHeight,
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
  if (rotation) mesh.rotation.copy(rotation)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function addMazeFloor(width, depth, thickness, offset = [0, 0, 0], rotation = null) {
  const position = [offset[0], thickness / 2 + offset[1], offset[2]]
  const mesh = addBrushMesh([width, thickness, depth], position)
  applyMazeFloorTexture(mesh)
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'maze'
  mesh.userData.subtype = 'maze-floor'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  return mesh
}

function arenaGridToMeshes(grid, tileSize, wallHeight, offset = [0, 0, 0], rotation = null) {
  const cols = grid.length
  const rows = grid[0].length
  const ox = ((cols - 1) / 2) * tileSize
  const oz = ((rows - 1) / 2) * tileSize
  const [offX, offY, offZ] = offset
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      if (grid[x][z] !== 1) continue
      const localX = x * tileSize - ox
      const localZ = z * tileSize - oz
      const rotated = rotateArenaPoint(localX, localZ, rotation)
      const px = rotated.x + offX
      const pz = rotated.z + offZ
      const mesh = addBrushMesh([tileSize, wallHeight, tileSize], [px, wallHeight / 2 + offY, pz])
      mesh.userData.generator = 'arena'
      mesh.userData.subtype = 'arena-wall'
      if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
      applyArenaBaseTexture(mesh)
      if (rotation) mesh.rotation.copy(rotation)
      if (activeGenerationCollector) activeGenerationCollector.push(mesh)
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
  if (selectedBrush && !brushes.includes(selectedBrush)) selectBrush(null)
}

function cloneGrid(grid) {
  return grid.map((col) => col.slice())
}

function cloneCells(cells) {
  return cells.map((cell) => ({ ...cell }))
}

function cloneArenaState(arena) {
  return {
    grid: cloneGrid(arena.grid),
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
  pushUndoState()
  if (!updateMazePreviewValidity()) return

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
      })
      attempts += 1
    }
  }
  const { grid, cols, rows } = mazeResult

  const preview = ensureMazePreview()
  const baseOffset = getPreviewBaseOffset(preview, ctrl.wallHeight)
  const baseRotation = preview?.rotation ? preview.rotation.clone() : null
  beginGenerationCollector()
  const mazeWidth = (cols * 2) * ctrl.spaceBetweenWalls
  const mazeDepth = (rows * 2) * ctrl.spaceBetweenWalls
  const floorThickness = Math.max(0.1, ctrl.spaceBetweenWalls * 0.1)
  addMazeFloor(mazeWidth, mazeDepth, floorThickness, baseOffset, baseRotation)
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
  const mazePreviewCheckbox = document.getElementById('maze-preview-visible')
  if (mazePreviewCheckbox) mazePreviewCheckbox.checked = false
  if (mazePreview) mazePreview.visible = false

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

function createArenaPreviewMesh(size, position) {
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
  mesh.userData.isArenaPreview = true
  mesh.userData.type = 'arena-preview'
  mesh.userData.size = [...size]
  return mesh
}

function ensureArenaPreview() {
  if (arenaPreview && brushes.includes(arenaPreview)) return arenaPreview
  const ctrl = getArenaControls()
  const size = [ctrl.cols * ctrl.tileSize, ctrl.wallHeight, ctrl.rows * ctrl.tileSize]
  const position = [0, ctrl.wallHeight / 2, 0]
  arenaPreview = createArenaPreviewMesh(size, position)
  arenaPreview.userData.id = crypto.randomUUID()
  arenaPreview.userData.arenaCols = ctrl.cols
  arenaPreview.userData.arenaRows = ctrl.rows
  scene.add(arenaPreview)
  brushes.push(arenaPreview)
  return arenaPreview
}

function updateArenaPreviewFromControls() {
  const ctrl = getArenaControls()
  const obstacleInput = document.getElementById('arena-obstacle-height')
  const obstacleValue = document.getElementById('arena-obstacle-height-value')
  if (obstacleInput) {
    obstacleInput.max = String(ctrl.wallHeight)
    const obstacleInputValue = parseFloat(obstacleInput.value)
    const shouldTrackWall = Math.abs(obstacleInputValue - lastArenaWallHeight) < 0.001
    if (shouldTrackWall) {
      obstacleInput.value = String(ctrl.wallHeight)
      if (obstacleValue) obstacleValue.textContent = String(ctrl.wallHeight)
    } else if (ctrl.obstacleHeight < obstacleInputValue) {
      obstacleInput.value = String(ctrl.obstacleHeight)
      if (obstacleValue) obstacleValue.textContent = String(ctrl.obstacleHeight)
    }
  }
  lastArenaWallHeight = ctrl.wallHeight
  const size = [ctrl.cols * ctrl.tileSize, ctrl.wallHeight, ctrl.rows * ctrl.tileSize]
  const preview = ensureArenaPreview()
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.arenaCols = ctrl.cols
  preview.userData.arenaRows = ctrl.rows
  refreshOutline(preview)
  if (!preview.position || Number.isNaN(preview.position.y)) {
    preview.position.set(0, ctrl.wallHeight / 2, 0)
  }
}

function createMazePreviewMesh(size, position) {
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
  mesh.userData.isMazePreview = true
  mesh.userData.type = 'maze-preview'
  mesh.userData.size = [...size]
  return mesh
}

function ensureMazePreview() {
  if (mazePreview && brushes.includes(mazePreview)) return mazePreview
  const ctrl = getMazeControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  const position = [0, ctrl.wallHeight / 2, 0]
  mazePreview = createMazePreviewMesh(size, position)
  mazePreview.userData.id = crypto.randomUUID()
  mazePreview.userData.mazeCols = ctrl.cols
  mazePreview.userData.mazeRows = ctrl.rows
  scene.add(mazePreview)
  brushes.push(mazePreview)
  return mazePreview
}

function updateMazePreviewFromControls() {
  const ctrl = getMazeControls()
  const w = ctrl.cols * 2 + 1
  const h = ctrl.rows * 2 + 1
  const width = (w - 1) * ctrl.spaceBetweenWalls
  const depth = (h - 1) * ctrl.spaceBetweenWalls
  const size = [width, ctrl.wallHeight, depth]
  const preview = ensureMazePreview()
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
  return updatePreviewValidity(arenaPreview, mazePreview)
}

function updateMazePreviewValidity() {
  return updatePreviewValidity(mazePreview, arenaPreview)
}

function snapScaledCount(count, scale, min, max) {
  if (scale > 1) return clamp(Math.ceil(count * scale - 1e-6), min, max)
  if (scale < 1) return clamp(Math.floor(count * scale + 1e-6), min, max)
  return clamp(Math.round(count), min, max)
}

function syncArenaControlsFromPreview(preview, scale) {
  if (!preview) return
  const tileSize = parseFloat(document.getElementById('arena-tile')?.value ?? '1')
  if (!tileSize || Number.isNaN(tileSize)) return
  const wallHeightInput = document.getElementById('arena-height')
  const wallHeightValueEl = document.getElementById('arena-height-value')
  const wallHeight = parseFloat(wallHeightInput?.value ?? '1')
  const currentHeight = preview.userData.size?.[1] ?? wallHeight
  const scaledHeight = currentHeight * scale.y
  const baseOffset = getPreviewBaseOffset(preview, scaledHeight)
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
  let nextWallHeight = wallHeight
  if (wallHeightInput) {
    const minHeight = parseFloat(wallHeightInput.min ?? '0')
    const maxHeight = parseFloat(wallHeightInput.max ?? '999')
    const baseHeight = preview.userData.size?.[1] ?? wallHeight
    nextWallHeight = clamp(baseHeight * scale.y, minHeight, maxHeight)
    wallHeightInput.value = String(nextWallHeight)
    if (wallHeightValueEl) wallHeightValueEl.textContent = String(nextWallHeight)
  }
  const obstacleInput = document.getElementById('arena-obstacle-height')
  const obstacleValueEl = document.getElementById('arena-obstacle-height-value')
  if (obstacleInput) {
    obstacleInput.max = String(nextWallHeight)
    const obstacleValue = parseFloat(obstacleInput.value)
    if (obstacleValue > nextWallHeight) {
      obstacleInput.value = String(nextWallHeight)
      if (obstacleValueEl) obstacleValueEl.textContent = String(nextWallHeight)
    }
  }
  const size = [nextCols * tileSize, nextWallHeight, nextRows * tileSize]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.arenaCols = nextCols
  preview.userData.arenaRows = nextRows
  refreshOutline(preview)
  preview.position.set(baseOffset[0], baseOffset[1] + nextWallHeight / 2, baseOffset[2])
}

function syncMazeControlsFromPreview(preview, scale) {
  if (!preview) return
  const spaceBetweenWalls = parseFloat(document.getElementById('maze-space')?.value ?? '1')
  if (!spaceBetweenWalls || Number.isNaN(spaceBetweenWalls)) return
  const wallHeightInput = document.getElementById('maze-height')
  const wallHeightValueEl = document.getElementById('maze-height-value')
  const wallHeight = parseFloat(wallHeightInput?.value ?? '1')
  const currentHeight = preview.userData.size?.[1] ?? wallHeight
  const scaledHeight = currentHeight * scale.y
  const baseOffset = getPreviewBaseOffset(preview, scaledHeight)
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
  let nextWallHeight = wallHeight
  if (wallHeightInput) {
    const minHeight = parseFloat(wallHeightInput.min ?? '0')
    const maxHeight = parseFloat(wallHeightInput.max ?? '999')
    const baseHeight = preview.userData.size?.[1] ?? wallHeight
    nextWallHeight = clamp(baseHeight * scale.y, minHeight, maxHeight)
    wallHeightInput.value = String(nextWallHeight)
    if (wallHeightValueEl) wallHeightValueEl.textContent = String(nextWallHeight)
  }
  const w = nextCols * 2 + 1
  const h = nextRows * 2 + 1
  const width = (w - 1) * spaceBetweenWalls
  const depth = (h - 1) * spaceBetweenWalls
  const size = [width, nextWallHeight, depth]
  preview.geometry.dispose()
  preview.geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  preview.userData.size = [...size]
  preview.userData.mazeCols = nextCols
  preview.userData.mazeRows = nextRows
  refreshOutline(preview)
  preview.position.set(baseOffset[0], baseOffset[1] + nextWallHeight / 2, baseOffset[2])
}

function addArenaFloor(cols, rows, tileSize, offset = [0, 0, 0], rotation = null) {
  const thickness = Math.max(0.1, tileSize * 0.1)
  const width = cols * tileSize
  const depth = rows * tileSize
  const position = [offset[0], thickness / 2 + offset[1], offset[2]]
  const mesh = createBrushMesh([width, thickness, depth], position, brushes.length * 4, {
    index: TEXTURE_INDEX.arenaBase,
  })
  applyArenaBaseTexture(mesh)
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = false
  mesh.userData.generator = 'arena'
  mesh.userData.subtype = 'arena-floor'
  if (activeGenerationGroup) mesh.userData.generatorGroup = activeGenerationGroup
  mesh.castShadow = false
  mesh.receiveShadow = false
  scene.add(mesh)
  brushes.push(mesh)
  if (activeGenerationCollector) activeGenerationCollector.push(mesh)
  if (rotation) mesh.rotation.copy(rotation)
  return mesh
}

function getPreviewBaseOffset(preview, height) {
  if (!preview?.position) return [0, 0, 0]
  const pos = preview.position.toArray()
  return [pos[0], pos[1] - height / 2, pos[2]]
}

function placeArenaMarkers(arena, tileSize, wallHeight, obstacleHeight, offset = [0, 0, 0], rotation = null) {
  const cols = arena.grid.length
  const rows = arena.grid[0].length
  const ox = ((cols - 1) / 2) * tileSize
  const oz = ((rows - 1) / 2) * tileSize
  const [offX, offY, offZ] = offset

  const cellToWorld = (cell) => ({
    x: cell.x * tileSize - ox,
    z: cell.z * tileSize - oz,
  })

  const markerBaseHeight = Math.min(wallHeight, obstacleHeight)
  const spawnHeight = markerBaseHeight * 0.7
  const spawnRadius = tileSize * 0.3
  arena.spawns.forEach((cell) => {
    const pos = cellToWorld(cell)
    const rotated = rotateArenaPoint(pos.x, pos.z, rotation)
    addArenaMarkerCylinder(spawnRadius, spawnHeight, [rotated.x + offX, spawnHeight / 2 + offY, rotated.z + offZ])
  })

  const flagHeight = markerBaseHeight * 0.5
  const flagRadius = tileSize * 0.22
  arena.flags.forEach((cell) => {
    const pos = cellToWorld(cell)
    const rotated = rotateArenaPoint(pos.x, pos.z, rotation)
    addArenaMarkerCylinder(flagRadius, flagHeight, [rotated.x + offX, flagHeight / 2 + offY, rotated.z + offZ])
  })

  const collisionHeight = markerBaseHeight * 0.6
  const collisionRadius = tileSize * 0.25
  arena.collisionPoints.forEach((cell) => {
    const pos = cellToWorld(cell)
    const rotated = rotateArenaPoint(pos.x, pos.z, rotation)
    addArenaMarkerCylinder(collisionRadius, collisionHeight, [rotated.x + offX, collisionHeight / 2 + offY, rotated.z + offZ])
  })

  const coverHeight = obstacleHeight * 0.9
  const coverSize = tileSize * 0.5
  arena.covers.forEach((cell) => {
    const pos = cellToWorld(cell)
    const rotated = rotateArenaPoint(pos.x, pos.z, rotation)
    const mesh = addArenaCover([coverSize, coverHeight, coverSize], [rotated.x + offX, coverHeight / 2 + offY, rotated.z + offZ])
    if (rotation) mesh.rotation.copy(rotation)
  })
}

function generateArena() {
  pushUndoState()
  if (!updateArenaPreviewValidity()) return

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
    while (attempts < 5 && gridsEqual(arena.grid, lastArenaState.grid)) {
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

  const preview = ensureArenaPreview()
  const baseOffset = getPreviewBaseOffset(preview, ctrl.wallHeight)
  const baseRotation = preview?.rotation ? preview.rotation.clone() : null
  beginGenerationCollector()
  addArenaFloor(ctrl.cols, ctrl.rows, ctrl.tileSize, baseOffset, baseRotation)
  arenaGridToMeshes(arena.grid, ctrl.tileSize, ctrl.wallHeight, baseOffset, baseRotation)
  placeArenaMarkers(arena, ctrl.tileSize, ctrl.wallHeight, ctrl.obstacleHeight, baseOffset, baseRotation)
  lastArenaBrushes = endGenerationCollector()

  lastArenaState = cloneArenaState(arena)
  lastArenaPlacement = {
    offset: [...baseOffset],
    rotation: baseRotation ? baseRotation.clone() : null,
  }
  updateIterateButtons()
  const arenaPreviewCheckbox = document.getElementById('arena-preview-visible')
  if (arenaPreviewCheckbox) arenaPreviewCheckbox.checked = false
  if (arenaPreview) arenaPreview.visible = false

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
  })
  let attempts = 0
  while (attempts < 5 && lastMazeState && gridsEqual(mazeResult.grid, lastMazeState.grid)) {
    mazeResult = generateMazeGrid({
      cols: ctrl.cols,
      rows: ctrl.rows,
      exitWidth: ctrl.exitWidth,
      centerRoomSize: ctrl.centerRoomSize,
      layout: ctrl.layout,
    })
    attempts += 1
  }
  const { grid, cols, rows } = mazeResult
  const baseOffset = lastMazePlacement?.offset ?? [0, 0, 0]
  const baseRotation = lastMazePlacement?.rotation ? lastMazePlacement.rotation.clone() : null
  const mazeWidth = (cols * 2) * ctrl.spaceBetweenWalls
  const mazeDepth = (rows * 2) * ctrl.spaceBetweenWalls
  const floorThickness = Math.max(0.1, ctrl.spaceBetweenWalls * 0.1)
  addMazeFloor(mazeWidth, mazeDepth, floorThickness, baseOffset, baseRotation)
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
  while (attempts < 5 && lastArenaState && gridsEqual(arena.grid, lastArenaState.grid)) {
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
  const cols = arena.grid.length
  const rows = arena.grid[0]?.length ?? 0
  const baseOffset = lastArenaPlacement?.offset ?? [0, 0, 0]
  const baseRotation = lastArenaPlacement?.rotation ? lastArenaPlacement.rotation.clone() : null
  addArenaFloor(cols, rows, ctrl.tileSize, baseOffset, baseRotation)
  arenaGridToMeshes(arena.grid, ctrl.tileSize, ctrl.wallHeight, baseOffset, baseRotation)
  placeArenaMarkers(
    arena,
    ctrl.tileSize,
    ctrl.wallHeight,
    ctrl.obstacleHeight,
    baseOffset,
    baseRotation
  )
  lastArenaBrushes = endGenerationCollector()

  lastArenaState = cloneArenaState(arena)
  updateIterateButtons()

  selectBrush(null)
  updateSceneList()
}
function addOutline(mesh) {
  if (mesh.userData.outline) return
  const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
  const outlineGeom = new LineSegmentsGeometry()
  outlineGeom.fromEdgesGeometry(edges)
  edges.dispose()
  const outlineMat = new LineMaterial({
    color: OUTLINE_COLOR,
    linewidth: outlineWidth,
  })
  outlineMat.resolution.set(viewport.clientWidth, viewport.clientHeight)
  const outline = new LineSegments2(outlineGeom, outlineMat)
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

function refreshOutline(mesh) {
  const outline = mesh?.userData?.outline
  if (!outline) return
  outline.geometry.dispose()
  const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
  const outlineGeom = new LineSegmentsGeometry()
  outlineGeom.fromEdgesGeometry(edges)
  edges.dispose()
  outline.geometry = outlineGeom
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
    clone = createCylinderMesh(
      mesh.userData.radius,
      mesh.userData.height,
      position,
      brushes.length * 4,
      { key: mesh.userData.textureKey, index: mesh.userData.textureIndex }
    )
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
  if (selectedBrush.userData?.isArenaPreview || selectedBrush.userData?.isMazePreview) return
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
  if (brush.userData?.isMazePreview) {
    const checkbox = document.getElementById('maze-preview-visible')
    if (checkbox && !checkbox.checked) return false
  }
  if (brush.userData?.isArenaPreview) {
    const checkbox = document.getElementById('arena-preview-visible')
    if (checkbox && !checkbox.checked) return false
  }
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

  if (mesh.userData.isArenaPreview) {
    syncArenaControlsFromPreview(mesh, s)
    mesh.scale.set(1, 1, 1)
    if (outline) refreshOutline(mesh)
    return
  }
  if (mesh.userData.isMazePreview) {
    syncMazeControlsFromPreview(mesh, s)
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
      .filter((m) => m.userData.type !== 'imported' && !m.userData.isArenaPreview && !m.userData.isMazePreview)
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
      } else {
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
    } else {
      mesh = createBrushMesh(
        b.size ?? [2, 2, 2],
        b.position ?? [0, 1, 0],
        brushes.length * 4,
        textureInfo
      )
    }
    mesh.userData.id = b.id || crypto.randomUUID()
    mesh.position.fromArray(b.position ?? [0, 1, 0])
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
  updateSceneList()
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
const arenaControls = document.getElementById('arena-controls')
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
  arenaControls.classList.toggle('hidden', mode !== 'arena')
  skyboxControls.classList.toggle('hidden', mode !== 'skybox')
  sky.visible = mode === 'skybox'
  useLitMaterials = mode === 'skybox'
  updateBrushMaterials(useLitMaterials)
  if (mode === 'arena') {
    updateArenaPreviewFromControls()
    updateArenaPreviewValidity()
    updateArenaPreviewVisibility()
    if (mazePreview) mazePreview.visible = false
    setCurrentTool('translate')
    setTransformMode('translate')
  } else if (mode === 'maze') {
    updateMazePreviewFromControls()
    updateMazePreviewValidity()
    updateMazePreviewVisibility()
    if (arenaPreview) arenaPreview.visible = false
    setCurrentTool('translate')
    setTransformMode('translate')
  } else {
    if (arenaPreview) {
      arenaPreview.visible = false
      if (selectedBrush === arenaPreview) selectBrush(null)
    }
    if (mazePreview) {
      mazePreview.visible = false
      if (selectedBrush === mazePreview) selectBrush(null)
    }
  }
}

document.getElementById('tab-brush').addEventListener('click', () => setEditorMode('brush'))
document.getElementById('tab-maze').addEventListener('click', () => setEditorMode('maze'))
document.getElementById('tab-arena').addEventListener('click', () => setEditorMode('arena'))
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

// --- Fly movement (WASD + LMB) ---
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
  if (e.button === 0) {
    flyMouseDown = true
    if (!isTransformDragging) {
      lockElement.requestPointerLock?.()
    }
  }
})

document.addEventListener('pointerup', (e) => {
  if (e.button === 0) flyMouseDown = false
  if (e.button === 0) document.exitPointerLock?.()
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

document.getElementById('btn-generate-arena').addEventListener('click', generateArena)
document.getElementById('btn-iterate-arena').addEventListener('click', regenerateArenaFromLast)

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
  reportPick,
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
document.getElementById('btn-iterate-maze').addEventListener('click', regenerateMazeFromLast)
document.getElementById('btn-save').addEventListener('click', () => saveLevel())
document.getElementById('btn-load').addEventListener('click', () => loadLevelFromFile())

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
  if (arenaPreview?.visible) updateArenaPreviewValidity()
  if (mazePreview?.visible) updateMazePreviewValidity()
  renderer.render(scene, camera)
}
animate()
