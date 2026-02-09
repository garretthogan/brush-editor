export function createImportSystem({
  loadGlbFromFile,
  loadTextureForSpawn,
  pushUndoState,
  updateBrushMaterials,
  updateSceneList,
  selectBrush,
  brushes,
  scene,
  getUseLitMaterials,
}) {
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
        const meshes = await loadGlbFromFile(first)
        addImportedMeshes(meshes)
      }
    })
    document.body.appendChild(input)
    input.click()
  }

  return { addImportedMeshes, loadLevelFromFile }
}
