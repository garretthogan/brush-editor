let _brushes = null
let _lights = null
let _baseLightEntries = null
let _selectBrush = null
let _selectLight = null
let _focusCameraOnObject = null

export function initUIPanels({ brushes, lights, baseLightEntries, selectBrush, selectLight, focusCameraOnObject }) {
  _brushes = brushes
  _lights = lights
  _baseLightEntries = baseLightEntries
  _selectBrush = selectBrush
  _selectLight = selectLight
  _focusCameraOnObject = focusCameraOnObject

  const searchInput = document.getElementById('scene-list-search')
  if (searchInput) {
    searchInput.addEventListener('input', () => updateSceneList())
  }
}

export function updateSceneList() {
  const container = document.getElementById('scene-list')
  if (!container || !_brushes || !_lights) return
  container.innerHTML = ''

  const searchQuery = (document.getElementById('scene-list-search')?.value ?? '').trim().toLowerCase()
  const matches = (text) => !searchQuery || String(text ?? '').toLowerCase().includes(searchQuery)

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

  _brushes.forEach((mesh) => {
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
    const items = groups.get(groupId)
    const filtered = items.filter(({ label }) => matches(label))
    const showGroup = matches(groupId) || filtered.length > 0
    if (!showGroup) return
    const itemsToShow = matches(groupId) ? items : filtered
    if (itemsToShow.length === 0) return
    const details = document.createElement('details')
    details.className = 'scene-list-group'
    details.open = searchQuery.length > 0
    const summary = document.createElement('summary')
    summary.textContent = groupId
    details.appendChild(summary)
    const sublist = document.createElement('div')
    sublist.className = 'scene-list-subitems'
    itemsToShow.forEach(({ mesh, label }) => {
      sublist.appendChild(makeButton(label, () => {
        if (_selectLight) _selectLight(null)
        _selectBrush?.(mesh)
        _focusCameraOnObject?.(mesh)
      }))
    })
    details.appendChild(sublist)
    objectList.appendChild(details)
  })

  loose.filter(({ label }) => matches(label)).forEach(({ mesh, label }) => {
    objectList.appendChild(makeButton(label, () => {
      if (_selectLight) _selectLight(null)
      _selectBrush?.(mesh)
      _focusCameraOnObject?.(mesh)
    }))
  })

  container.appendChild(objectList)

  const lightList = document.createElement('div')
  const allLights = [
    ...(_baseLightEntries ?? []).filter((entry) => !entry.isDefault),
    ..._lights.map((entry, idx) => ({
      ...entry,
      label: `${entry.type}_light_${String(idx + 1).padStart(2, '0')}`,
    })),
  ].filter((entry) => entry?.light?.parent)
  const filteredLights = allLights.filter((entry) => matches(entry.label))
  if (filteredLights.length > 0) {
    lightList.appendChild(makeLabel('Lights'))
  }
  filteredLights.forEach((entry) => {
    lightList.appendChild(makeButton(entry.label, () => {
      if (_selectBrush) _selectBrush(null)
      _selectLight?.(entry)
      _focusCameraOnObject?.(entry.light)
    }))
  })
  container.appendChild(lightList)
}

export function buildExportEntries() {
  if (!_brushes || !_lights) return { groups: new Map(), loose: [], lights: [] }
  const groups = new Map()
  const loose = []
  _brushes.forEach((mesh) => {
    if (!mesh || mesh.userData?.isArenaPreview || mesh.userData?.isMazePreview) return
    if (!mesh.parent) return
    const groupId = mesh.userData?.generatorGroup
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
    ..._lights.map((entry, idx) => ({
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
