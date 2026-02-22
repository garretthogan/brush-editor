let _editorView = null
let _getBrushes = null
let _getLights = null
let _baseLightEntries = null

export function initUIPanels({ editorView, getBrushes, getLights, baseLightEntries }) {
  _editorView = editorView ?? null
  _getBrushes = getBrushes ?? (() => [])
  _getLights = getLights ?? (() => [])
  _baseLightEntries = baseLightEntries ?? []

  if (_editorView) {
    const searchInput = document.getElementById('scene-list-search')
    if (searchInput) {
      searchInput.addEventListener('input', () => _editorView.updateSceneList())
    }
  }
}

export function updateSceneList() {
  if (_editorView) {
    _editorView.updateSceneList()
    return
  }
}

export function buildExportEntries() {
  const brushes = _getBrushes?.() ?? []
  const lights = _getLights?.() ?? []
  if (!brushes || !lights) return { groups: new Map(), loose: [], lights: [] }
  const groups = new Map()
  const loose = []
  brushes.forEach((mesh) => {
    if (!mesh || mesh.userData?.isLevelBuilderVolume || mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) return
    if (!mesh.parent) return
    const groupId = mesh.userData?.generatorGroup ?? mesh.userData?.importGroup
    const subtype = mesh.userData?.subtype
    const labelBase = subtype ?? mesh.userData?.type ?? 'object'
    const label = `${labelBase}_${String(mesh.userData?.id ?? '').slice(0, 8) || 'no-id'}`
    const entry = { type: 'mesh', object: mesh, label }
    if (groupId) {
      if (!groups.has(groupId)) groups.set(groupId, [])
      groups.get(groupId).push(entry)
    } else {
      loose.push(entry)
    }
  })

  const lightsList = []
  const allLights = [
    ...(_baseLightEntries ?? []),
    ...lights.map((entry, idx) => ({
      ...entry,
      label: `${entry.type}_light_${String(idx + 1).padStart(2, '0')}`,
    })),
  ].filter((entry) => entry?.light?.parent)
  allLights.forEach((entry) => {
    lightsList.push({
      type: 'light',
      object: entry.light,
      label: entry.label,
    })
  })

  return { groups, loose, lights: lightsList }
}
