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

  function addImportedMeshes(meshes) {
    if (!meshes || meshes.length === 0) return
    pushUndoState()
    meshes.forEach((mesh) => {
      const isPlayerStart = mesh.userData?.type === 'player_start'
      if (!isPlayerStart) {
        const tex = loadTextureForSpawn()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((mat) => {
          if (mat && mat.map !== undefined) mat.map = tex
        })
      }
      mesh.userData.isBrush = true
      if (!isPlayerStart) mesh.userData.type = 'imported'
      mesh.userData.id = mesh.userData.id || crypto.randomUUID()
      mesh.userData.isUserBrush = true
      mesh.castShadow = getUseLitMaterials()
      mesh.receiveShadow = getUseLitMaterials()
      scene.add(mesh)
      brushes.push(mesh)
    })
    selectBrush(null)
    updateBrushMaterials(getUseLitMaterials())
    updateSceneList()
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
        try {
          const sceneRoot = await loadGlbSceneFromFile(first)
          if (!sceneRoot) {
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
          addImportedMeshes(meshes)
          if (addImportedLight) {
            lights.forEach((light) => addImportedLight(light))
          }
        } catch (err) {
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
