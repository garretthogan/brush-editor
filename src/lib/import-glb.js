import * as THREE from 'three'
import { Brush } from 'three-bvh-csg'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { getTextureForImportedMesh, getRandomDarkTextureIndex } from './materials.js'

/** Snap world position to this grid so shared edges get identical UVs. */
const WORLD_UV_GRID = 1 / 512

function snapToGrid(val, grid) {
  return Math.round(val / grid) * grid
}

/**
 * Transform geometry positions and normals by mesh world matrix (in place).
 * Used to bring each mesh's geometry into world space before merging.
 */
function transformGeometryToWorld(geom, matrixWorld) {
  const pos = geom.attributes.position
  const normalAttr = geom.attributes.normal
  const count = pos.count
  const _v = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld)
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
    pos.setXYZ(i, _v.x, _v.y, _v.z)
    if (normalAttr) {
      _v.fromBufferAttribute(normalAttr, i).transformDirection(normalMatrix).normalize()
      normalAttr.setXYZ(i, _v.x, _v.y, _v.z)
    }
  }
  pos.needsUpdate = true
  if (normalAttr) normalAttr.needsUpdate = true
}

/**
 * Apply world-space UVs to a BufferGeometry whose positions are already in world space.
 * No vertex merge — avoids topology artifacts. Texture tiles without stretching.
 */
function applyWorldSpaceUVsToGeometry(geom) {
  if (!geom?.attributes?.position) return
  BufferGeometryUtils.deinterleaveGeometry(geom)
  if (geom.index) geom.toNonIndexed()
  const pos = geom.attributes.position
  const count = pos.count
  const uvs = new Float32Array(count * 2)
  const normals = new Float32Array(count * 3)
  const _v0 = new THREE.Vector3()
  const _v1 = new THREE.Vector3()
  const _v2 = new THREE.Vector3()
  const _normal = new THREE.Vector3()

  // When two normal components are within TIE_EPS, pick axis by fixed order so adjacent triangles get same UV axes (avoids diagonal shear).
  const TIE_EPS = 0.2
  for (let i = 0; i < count; i += 3) {
    _v0.fromBufferAttribute(pos, i)
    _v1.fromBufferAttribute(pos, i + 1)
    _v2.fromBufferAttribute(pos, i + 2)
    _normal.crossVectors(_v1.clone().sub(_v0), _v2.clone().sub(_v0)).normalize()
    let nx = _normal.x
    let ny = _normal.y
    let nz = _normal.z
    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    const sorted = [
      [ax, 'x', nx],
      [ay, 'y', ny],
      [az, 'z', nz],
    ].sort((a, b) => b[0] - a[0])
    const [maxVal, maxAxis] = sorted[0]
    const secondVal = sorted[1][0]
    const useTieBreak = maxVal - secondVal < TIE_EPS
    // When two components tie, use the third (smallest) as normal so both triangles get same UV axes and no shear
    const dominantAxis = useTieBreak ? sorted[2][1] : maxAxis
    const sign =
      dominantAxis === 'x' ? (nx >= 0 ? 1 : -1) : dominantAxis === 'y' ? (ny >= 0 ? 1 : -1) : nz >= 0 ? 1 : -1
    nx = dominantAxis === 'x' ? sign : 0
    ny = dominantAxis === 'y' ? sign : 0
    nz = dominantAxis === 'z' ? sign : 0
    const { u: uAxis, v: vAxis } = getUVAxesFromWorldNormal(nx, ny, nz)
    const flipU = nx < 0 || ny < 0 || nz < 0
    const u0 = snapToGrid(_v0[uAxis], WORLD_UV_GRID)
    const v0 = snapToGrid(_v0[vAxis], WORLD_UV_GRID)
    const u1 = snapToGrid(_v1[uAxis], WORLD_UV_GRID)
    const v1 = snapToGrid(_v1[vAxis], WORLD_UV_GRID)
    const u2 = snapToGrid(_v2[uAxis], WORLD_UV_GRID)
    const v2 = snapToGrid(_v2[vAxis], WORLD_UV_GRID)
    uvs[i * 2] = flipU ? -u0 : u0
    uvs[i * 2 + 1] = v0
    uvs[(i + 1) * 2] = flipU ? -u1 : u1
    uvs[(i + 1) * 2 + 1] = v1
    uvs[(i + 2) * 2] = flipU ? -u2 : u2
    uvs[(i + 2) * 2 + 1] = v2
    normals[i * 3] = nx
    normals[i * 3 + 1] = ny
    normals[i * 3 + 2] = nz
    normals[(i + 1) * 3] = nx
    normals[(i + 1) * 3 + 1] = ny
    normals[(i + 1) * 3 + 2] = nz
    normals[(i + 2) * 3] = nx
    normals[(i + 2) * 3 + 1] = ny
    normals[(i + 2) * 3 + 2] = nz
  }
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
}

/** Tolerance for merging vertices by position (reduces corner duplication; shared corners keep one UV). */
const MERGE_VERTICES_TOLERANCE = 1e-5

/**
 * Picks the two world axes that span the face (perpendicular to normal).
 * Matches Three.js BoxGeometry convention so texture "horizontal" (U) aligns with the wall/floor:
 * - X-facing normals: U = Z, V = Y (so text runs along the wall, not vertical)
 * - Y-facing (floor/ceiling): U = X, V = Z
 * - Z-facing: U = X, V = Y
 */
function getUVAxesFromWorldNormal(nx, ny, nz) {
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  if (ax >= ay && ax >= az) return { u: 'z', v: 'y' }
  if (ay >= az) return { u: 'x', v: 'z' }
  return { u: 'x', v: 'y' }
}

/**
 * Apply world-space UVs using vertex normals (geometry must be merged so each vertex has one normal).
 * Fixes vertical stretching on walls: export (x,z) UVs give constant V on vertical faces; here each
 * vertex gets U,V from the two axes that span its face (e.g. X,Y for Z-facing walls).
 */
function applyWorldSpaceUVsFromVertexNormals(geom) {
  if (!geom?.attributes?.position || !geom?.attributes?.normal) return
  const pos = geom.attributes.position
  const norm = geom.attributes.normal
  const count = pos.count
  const uvs = new Float32Array(count * 2)
  const TIE_EPS = 0.2
  const _v = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(norm, i)
    let nx = _v.x
    let ny = _v.y
    let nz = _v.z
    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    const sorted = [
      [ax, 'x', nx],
      [ay, 'y', ny],
      [az, 'z', nz],
    ].sort((a, b) => b[0] - a[0])
    const [maxVal, maxAxis] = sorted[0]
    const secondVal = sorted[1][0]
    const useTieBreak = maxVal - secondVal < TIE_EPS
    const dominantAxis = useTieBreak ? sorted[2][1] : maxAxis
    const sign =
      dominantAxis === 'x' ? (nx >= 0 ? 1 : -1) : dominantAxis === 'y' ? (ny >= 0 ? 1 : -1) : nz >= 0 ? 1 : -1
    nx = dominantAxis === 'x' ? sign : 0
    ny = dominantAxis === 'y' ? sign : 0
    nz = dominantAxis === 'z' ? sign : 0
    const { u: uAxis, v: vAxis } = getUVAxesFromWorldNormal(nx, ny, nz)
    _v.fromBufferAttribute(pos, i)
    const flipU = nx < 0 || ny < 0 || nz < 0
    const u = snapToGrid(_v[uAxis], WORLD_UV_GRID)
    const v = snapToGrid(_v[vAxis], WORLD_UV_GRID)
    uvs[i * 2] = flipU ? -u : u
    uvs[i * 2 + 1] = v
  }
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
}

export function createImportSystem({
  loadGlbSceneFromFile,
  loadTextureForSpawn,
  pushUndoState,
  updateBrushMaterials,
  updateSceneList,
  selectBrush,
  brushes,
  scene,
  getUseLitMaterials,
  addImportedLight,
  showToast,
  onBrushesChanged,
  setImportLoading,
}) {
  function collectMeshes(root) {
    const meshes = []
    root.traverse((child) => {
      if (child.isMesh) meshes.push(child)
    })
    return meshes
  }

  function collectLights(root) {
    const lights = []
    root.traverse((child) => {
      if (child.isLight) lights.push(child)
    })
    return lights
  }

  const EDITOR_BRUSH_TYPES = new Set(['box', 'cylinder', 'ramp', 'player_start'])

  /**
   * @param {THREE.Mesh[]} meshes
   * @param {() => void} [onSceneReady] - Called when the scene is ready (CSG applied if any). Used to hide import spinner only after the maze is visible.
   * @param {string} [importGroupName] - Name for grouping in scene list and export (e.g. filename without extension).
   */
  /**
   * Prepare geometry for import when we will bake to world and recompute UVs (no existing UVs).
   * Clone, ensure normal/uv placeholder, transform to world, non-indexed.
   */
  function prepareGeometryForImportBaked(mesh) {
    const geom = mesh.geometry.clone()
    if (!geom.attributes.normal) geom.computeVertexNormals()
    if (!geom.attributes.uv) {
      const n = geom.attributes.position.count
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
    }
    BufferGeometryUtils.deinterleaveGeometry(geom)
    if (geom.index) geom.toNonIndexed()
    mesh.updateWorldMatrix(true, false)
    transformGeometryToWorld(geom, mesh.matrixWorld)
    return geom
  }

  function addImportedMeshes(meshes, onSceneReady, importGroupName) {
    if (!meshes || meshes.length === 0) return
    pushUndoState()
    const groupName = importGroupName?.trim() || null
    const _size = new THREE.Vector3()

    const playerStartMeshes = meshes.filter((m) => m.userData?.type === 'player_start')
    const meshesToAdd = meshes.filter((m) => m.userData?.type !== 'player_start')

    for (const mesh of meshesToAdd) {
      if (!mesh.geometry?.attributes?.position) continue
      const geom = prepareGeometryForImportBaked(mesh)
      const merged = BufferGeometryUtils.mergeVertices(geom, MERGE_VERTICES_TOLERANCE)
      const geometry = merged || geom
      if (merged) geom.dispose()
      geometry.computeVertexNormals()
      applyWorldSpaceUVsFromVertexNormals(geometry)
      const darkIndex = getRandomDarkTextureIndex()
      const darkTex = getTextureForImportedMesh(darkIndex)
      geometry.computeBoundingBox()
      geometry.boundingBox.getSize(_size)
      const a = Math.max(0.1, _size.x)
      const b = Math.max(0.1, _size.y)
      const c = Math.max(0.1, _size.z)
      const sorted = [a, b, c].sort((p, q) => p - q)
      const repeatU = sorted[1]
      const repeatV = sorted[2]
      const aspect =
        darkTex.image?.width && darkTex.image?.height
          ? darkTex.image.width / darkTex.image.height
          : 1
      const baseRepeat = Math.sqrt(repeatU * repeatV)
      if (darkTex.repeat) darkTex.repeat.set(baseRepeat * Math.sqrt(aspect), baseRepeat / Math.sqrt(aspect))
      const unlitMaterial = new THREE.MeshBasicMaterial({
        map: darkTex,
        polygonOffset: false,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: 0,
      })
      const importedMesh = new THREE.Mesh(geometry, unlitMaterial)
      importedMesh.userData = {
        isBrush: true,
        type: 'imported',
        importGroup: groupName ?? undefined,
        id: crypto.randomUUID(),
        isUserBrush: true,
        textureIndex: darkIndex,
      }
      importedMesh.castShadow = getUseLitMaterials()
      importedMesh.receiveShadow = getUseLitMaterials()
      scene.add(importedMesh)
      brushes.push(importedMesh)
      mesh.geometry?.dispose?.()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((mat) => mat?.dispose?.())
    }

    for (const mesh of playerStartMeshes) {
      mesh.userData.isBrush = true
      mesh.userData.id = mesh.userData.id || crypto.randomUUID()
      mesh.userData.isUserBrush = true
      if (groupName) mesh.userData.importGroup = groupName
      mesh.castShadow = getUseLitMaterials()
      mesh.receiveShadow = getUseLitMaterials()
      scene.add(mesh)
      brushes.push(mesh)
    }

    selectBrush(null)
    updateBrushMaterials(getUseLitMaterials())
    updateSceneList()
    onBrushesChanged?.(onSceneReady)
  }

  function loadLevelFromFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gltf,.glb'
    input.style.display = 'none'
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || [])
      document.body.removeChild(input)
      if (files.length === 0) return
      const first = files[0]
      const ext = first.name.split('.').pop()?.toLowerCase()
      if (ext === 'glb' || ext === 'gltf') {
        setImportLoading?.(true)
        try {
          const sceneRoot = await loadGlbSceneFromFile(first)
          if (!sceneRoot) {
            setImportLoading?.(false)
            if (showToast) {
              showToast(
                'The file could not be loaded. It may be corrupted or in an unsupported format.',
                {
                  type: 'error',
                  recoveryLabel: 'Try again',
                  onRecovery: loadLevelFromFile,
                }
              )
            }
            return
          }
          const meshes = collectMeshes(sceneRoot)
          const lights = collectLights(sceneRoot)
          const importGroupName = first.name.replace(/\.(glb|gltf)$/i, '') || 'import'
          addImportedMeshes(meshes, () => setImportLoading?.(false), importGroupName)
          if (addImportedLight) {
            lights.forEach((light) => addImportedLight(light))
          }
        } catch (err) {
          setImportLoading?.(false)
          if (showToast) {
            showToast(
              'The file could not be loaded. Try a different file or check that it is a valid GLB/GLTF.',
              {
                type: 'error',
                recoveryLabel: 'Try again',
                onRecovery: loadLevelFromFile,
              }
            )
          }
        }
      }
    })
    document.body.appendChild(input)
    input.click()
  }

  return { addImportedMeshes, loadLevelFromFile }
}
