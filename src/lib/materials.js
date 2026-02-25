import * as THREE from 'three'

// Palette root textures plus Dark/Fixtures for import random selection. Format: { palette, file }
export const TEXTURE_POOL = [
  { palette: 'Dark', file: 'texture_01.png' },
  { palette: 'Dark', file: 'texture_13.png' },
  { palette: 'Dark/Fixtures', file: 'texture_02.png' },
  { palette: 'Dark/Fixtures', file: 'texture_03.png' },
  { palette: 'Dark/Fixtures', file: 'texture_04.png' },
  { palette: 'Dark/Fixtures', file: 'texture_05.png' },
  { palette: 'Dark/Fixtures', file: 'texture_06.png' },
  { palette: 'Dark/Fixtures', file: 'texture_07.png' },
  { palette: 'Dark/Fixtures', file: 'texture_08.png' },
  { palette: 'Dark/Fixtures', file: 'texture_09.png' },
  { palette: 'Green', file: 'texture_02.png' },
  { palette: 'Light', file: 'texture_02.png' },
  { palette: 'Orange', file: 'texture_02.png' },
  { palette: 'Purple', file: 'texture_02.png' },
  { palette: 'Red', file: 'texture_02.png' },
]

let _baseUrl = ''
let _maxAnisotropy = null
let _renderer = null
let _lights = null
let _dirLight = null
let _brushes = null
const textureLoader = new THREE.TextureLoader()
const textureCacheByIndex = new Map()

export function initMaterialSystem({ baseUrl, maxAnisotropy, renderer, lights, dirLight, brushes }) {
  _baseUrl = baseUrl
  _maxAnisotropy = maxAnisotropy
  _renderer = renderer
  _lights = lights
  _dirLight = dirLight
  _brushes = brushes
}

function getTextureUrl(index) {
  const { palette, file } = TEXTURE_POOL[index]
  return `${_baseUrl}textures/${palette}/${file}`
}

export function getSelectedTextureIndex() {
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

export const TEXTURE_INDEX = {
  mazeWall: getTextureIndex('Dark', 'texture_13.png'),
  mazeFloor: getTextureIndex('Dark', 'texture_01.png'),
  arenaBase: getTextureIndex('Dark', 'texture_01.png'),
  arenaObstacle: getTextureIndex('Orange', 'texture_02.png'),
}

/** Indices in TEXTURE_POOL for Dark and Dark/Fixtures (for random per-mesh assignment on import). */
const DARK_PALETTE_INDICES = TEXTURE_POOL.map((entry, i) =>
  entry.palette === 'Dark' || entry.palette === 'Dark/Fixtures' ? i : -1
).filter((i) => i >= 0)

/**
 * Returns a random texture index from the Dark palette. Use when assigning a random Dark texture
 * to each mesh (e.g. imported GLB children) so pieces get varied textures.
 */
export function getRandomDarkTextureIndex() {
  if (DARK_PALETTE_INDICES.length === 0) return TEXTURE_INDEX.mazeFloor
  return DARK_PALETTE_INDICES[Math.floor(Math.random() * DARK_PALETTE_INDICES.length)]
}

export function getTextureByIndex(index) {
  const clamped = Math.max(0, Math.min(index ?? 0, TEXTURE_POOL.length - 1))
  if (textureCacheByIndex.has(clamped)) return textureCacheByIndex.get(clamped)
  const tex = loadTextureByIndex(clamped)
  if (typeof _maxAnisotropy === 'number') tex.anisotropy = _maxAnisotropy
  tex.userData = tex.userData || {}
  tex.userData.isCached = true
  textureCacheByIndex.set(clamped, tex)
  return tex
}

const _box3 = new THREE.Box3()
const _size = new THREE.Vector3()

/**
 * Returns a cloned texture with repeat set from the mesh's world-space size
 * so that the texture tiles instead of stretching (e.g. for GLB with 0-1 UVs).
 * Uses the two largest bbox dimensions so both floors (thin in Y) and walls
 * (thin in X or Z) tile as a grid instead of stretching.
 * Caller must dispose the returned texture when no longer needed.
 * @param {import('three').Mesh} mesh
 * @param {number} index - TEXTURE_INDEX or palette index
 * @returns {import('three').Texture}
 */
export function getTextureWithWorldRepeat(mesh, index) {
  mesh.updateWorldMatrix(true, false)
  _box3.setFromObject(mesh)
  _box3.getSize(_size)
  const tex = getTextureByIndex(index).clone()
  const a = Math.max(0.1, _size.x)
  const b = Math.max(0.1, _size.y)
  const c = Math.max(0.1, _size.z)
  const [repeatU, repeatV] = [a, b, c].sort((p, q) => p - q).slice(1)
  tex.repeat.set(repeatU, repeatV)
  if (typeof _maxAnisotropy === 'number') tex.anisotropy = _maxAnisotropy
  return tex
}

export function resolveBrushTexture(textureInfo) {
  if (textureInfo?.key === 'arena') return getTextureByIndex(TEXTURE_INDEX.arenaBase)
  if (typeof textureInfo?.index === 'number') return getTextureByIndex(textureInfo.index)
  const index = getSelectedTextureIndex()
  return getTextureByIndex(index)
}

export function resolveBrushTextureInfo(textureInfo) {
  if (textureInfo?.key === 'arena') return { index: TEXTURE_INDEX.arenaBase }
  if (typeof textureInfo?.index === 'number') return { index: textureInfo.index }
  return { index: getSelectedTextureIndex() }
}

export function loadTextureForSpawn() {
  return getTextureByIndex(getSelectedTextureIndex())
}

export function createBrushMaterial(texture, depthBias, lit, color = null) {
  const baseOpts = {
    map: texture,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  }
  if (lit) {
    const material = new THREE.MeshStandardMaterial({
      ...baseOpts,
      flatShading: false,
    })
    if (color && material.color) material.color.copy(color)
    return material
  }
  const material = new THREE.MeshBasicMaterial(baseOpts)
  if (color && material.color) material.color.copy(color)
  return material
}

/**
 * For imported meshes with world-space UVs: clone texture and set repeat so cells are square
 * regardless of texture aspect ratio. Use when applying any texture to an imported mesh.
 * Caller must dispose the returned texture when no longer needed.
 */
export function getTextureForImportedMesh(index) {
  const base = getTextureByIndex(index)
  const tex = base.clone()
  const img = base.image
  const aspect = img?.width && img?.height ? img.width / img.height : 1
  const r = aspect > 0 ? Math.sqrt(aspect) : 1
  tex.repeat.set(r, r)
  if (typeof _maxAnisotropy === 'number') tex.anisotropy = _maxAnisotropy
  return tex
}

export function applyTextureIndex(mesh, index) {
  if (!mesh?.material) return
  const isImported = mesh.userData?.type === 'imported'
  const tex = isImported ? getTextureForImportedMesh(index) : getTextureByIndex(index)
  const prev = mesh.material.map
  if (prev && prev !== tex && !prev.userData?.isCached) prev.dispose()
  mesh.material.map = tex
  mesh.material.needsUpdate = true
  mesh.userData.textureKey = null
  mesh.userData.textureIndex = index
}

export function applyMazeWallTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.mazeWall)
}

export function applyMazeFloorTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.mazeFloor)
}

export function applyArenaBaseTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.arenaBase)
}

export function applyArenaObstacleTexture(mesh) {
  applyTextureIndex(mesh, TEXTURE_INDEX.arenaObstacle)
}

export function updateBrushMaterials(lit) {
  if (!_brushes) return
  _brushes.forEach((mesh) => {
    if (!mesh?.material || mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const nextMaterials = materials.map((mat) => {
      if (!mat) return mat
      const texture = mat.map ?? null
      const depthBias = mat.polygonOffsetUnits ?? 0
      const color = mat.color ? mat.color.clone() : null
      return createBrushMaterial(texture, depthBias, lit, color)
    })
    materials.forEach((mat) => mat?.dispose?.())
    mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0]
    if (mesh.userData?.type === 'ramp') {
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => (m.side = THREE.DoubleSide))
      else if (mat) mat.side = THREE.DoubleSide
    }
  })
}

export function updateShadowState(enable) {
  if (!_renderer) return
  _renderer.shadowMap.enabled = enable
  if (enable) _renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const configureShadow = (light) => {
    if (!light?.shadow) return
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.bias = -0.0005
    if (light.isDirectionalLight) {
      const cam = light.shadow.camera
      cam.left = -200
      cam.right = 200
      cam.top = 200
      cam.bottom = -200
      cam.near = 0.1
      cam.far = 1000
      cam.updateProjectionMatrix()
    } else if (light.isSpotLight) {
      light.shadow.camera.near = 0.5
      light.shadow.camera.far = 300
      light.shadow.camera.updateProjectionMatrix()
    } else if (light.isPointLight) {
      light.shadow.camera.near = 0.1
      light.shadow.camera.far = Math.max(10, light.distance || 100)
      light.shadow.camera.updateProjectionMatrix()
    }
  }
  if (_lights) {
    _lights.forEach((entry) => {
      if (!entry?.light) return
      entry.light.castShadow = enable && entry.type !== 'ambient'
      if (entry.light.castShadow) configureShadow(entry.light)
    })
  }
  if (_dirLight) {
    _dirLight.castShadow = enable
    if (enable) configureShadow(_dirLight)
  }
  if (_brushes) {
    _brushes.forEach((mesh) => {
      if (!mesh?.isMesh) return
      if (mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) {
        mesh.castShadow = false
        mesh.receiveShadow = false
        return
      }
      mesh.castShadow = enable
      mesh.receiveShadow = enable
    })
  }
}
