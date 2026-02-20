import { Brush } from 'three-bvh-csg'
import { getTextureByIndex, TEXTURE_INDEX } from './materials.js'

const SUBTYPE_TEXTURE_INDEX = {
  'maze-floor': TEXTURE_INDEX.mazeFloor,
  'maze-wall': TEXTURE_INDEX.mazeWall,
  'arena-floor': TEXTURE_INDEX.arenaBase,
  'arena-wall': TEXTURE_INDEX.arenaObstacle,
  'arena-obstacle': TEXTURE_INDEX.arenaObstacle,
  floor: TEXTURE_INDEX.mazeFloor,
  wall: TEXTURE_INDEX.mazeWall,
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
   */
  function addImportedMeshes(meshes, onSceneReady) {
    if (!meshes || meshes.length === 0) return
    pushUndoState()
    meshes.forEach((mesh, idx) => {
      const existingType = mesh.userData?.type
      const isEditorBrush = existingType && EDITOR_BRUSH_TYPES.has(existingType)
      const isPlayerStart = existingType === 'player_start'

      if (!isPlayerStart) {
        const subtype = mesh.userData?.subtype
        const textureIndex = SUBTYPE_TEXTURE_INDEX[subtype]
        const tex =
          textureIndex != null ? getTextureByIndex(textureIndex) : loadTextureForSpawn()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((mat) => {
          if (mat && mat.map !== undefined) mat.map = tex
        })
      }
      mesh.userData.isBrush = true
      if (!isEditorBrush) {
        mesh.userData.type = 'imported'
      }
      mesh.userData.id = mesh.userData.id || crypto.randomUUID()
      mesh.userData.isUserBrush = true
      mesh.castShadow = getUseLitMaterials()
      mesh.receiveShadow = getUseLitMaterials()

      const isCsgShape = existingType === 'box' || existingType === 'cylinder'
      if (isCsgShape && mesh.geometry && mesh.material) {
        const geometry = mesh.geometry.clone()
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        const brush = new Brush(geometry, material)
        brush.position.copy(mesh.position)
        brush.quaternion.copy(mesh.quaternion)
        brush.scale.copy(mesh.scale)
        brush.userData = { ...mesh.userData }
        brush.castShadow = mesh.castShadow
        brush.receiveShadow = mesh.receiveShadow
        scene.add(brush)
        brushes.push(brush)
      } else {
        scene.add(mesh)
        brushes.push(mesh)
      }
    })
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
          addImportedMeshes(meshes, () => setImportLoading?.(false))
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
