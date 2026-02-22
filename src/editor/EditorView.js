/**
 * Editor view: updates DOM from model state (scene list, panel visibility, brush tools).
 * Does not hold business state; reads from getters and callbacks passed at init.
 */

export class EditorView {
  constructor() {
    /** @type {() => THREE.Object3D[]} */
    this._getBrushes = () => []
    /** @type {() => Array<{ light: THREE.Light, type: string }>} */
    this._getLights = () => []
    /** @type {Array<{ light: THREE.Light, type: string, isDefault?: boolean, label?: string }>} */
    this._baseLightEntries = []
    /** @type {(mesh: THREE.Object3D | null) => void} */
    this._selectBrush = () => {}
    /** @type {(entry: unknown) => void} */
    this._selectLight = () => {}
    /** @type {(obj: THREE.Object3D) => void} */
    this._focusCameraOnObject = () => {}
    /** @type {(mesh: THREE.Object3D | null) => boolean} */
    this._isCsgBrush = () => false
    /** @type {() => string} */
    this._getDefaultCsgOperationKey = () => 'ADDITION'
    /** @type {Record<string, unknown>} */
    this._csgOpValues = {}
    /** @type {Record<string, HTMLElement | null>} */
    this._panels = {}
  }

  /**
   * @param {{
   *   getBrushes: () => THREE.Object3D[],
   *   getLights: () => Array<{ light: THREE.Light, type: string }>,
   *   baseLightEntries?: Array<{ light: THREE.Light, type: string, isDefault?: boolean, label?: string }>,
   *   selectBrush: (mesh: THREE.Object3D | null) => void,
   *   selectLight: (entry: unknown) => void,
   *   focusCameraOnObject: (obj: THREE.Object3D) => void,
   *   isCsgBrush?: (mesh: THREE.Object3D | null) => boolean,
   *   getDefaultCsgOperationKey?: () => string,
   *   csgOpValues?: Record<string, unknown>,
   *   panels?: Record<string, HTMLElement | null>,
   * }} options
   */
  init(options) {
    this._getBrushes = options.getBrushes ?? this._getBrushes
    this._getLights = options.getLights ?? this._getLights
    this._baseLightEntries = options.baseLightEntries ?? []
    this._selectBrush = options.selectBrush ?? this._selectBrush
    this._selectLight = options.selectLight ?? this._selectLight
    this._focusCameraOnObject = options.focusCameraOnObject ?? this._focusCameraOnObject
    this._isCsgBrush = options.isCsgBrush ?? this._isCsgBrush
    this._getDefaultCsgOperationKey = options.getDefaultCsgOperationKey ?? this._getDefaultCsgOperationKey
    this._csgOpValues = options.csgOpValues ?? {}
    this._panels = options.panels ?? {}

    const searchInput = document.getElementById('scene-list-search')
    if (searchInput) {
      searchInput.addEventListener('input', () => this.updateSceneList())
    }
  }

  updateSceneList() {
    const container = document.getElementById('scene-list')
    const brushes = this._getBrushes()
    const lights = this._getLights()
    if (!container || !lights) return
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

    const makeEmpty = (text) => {
      const el = document.createElement('div')
      el.className = 'scene-list-empty'
      el.textContent = text
      return el
    }

    const shortId = (id) => (id ? String(id).slice(0, 8) : 'no-id')

    const objectList = document.createElement('div')
    const groups = new Map()
    const loose = []

    brushes.forEach((mesh) => {
      if (!mesh) return
      if (!mesh.parent) return
      const groupId = mesh.userData?.generatorGroup ?? mesh.userData?.importGroup
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

    objectList.appendChild(makeLabel('Objects'))

    let objectCountShown = 0
    Array.from(groups.keys()).sort().forEach((groupId) => {
      const items = groups.get(groupId)
      const filtered = items.filter(({ label }) => matches(label))
      const showGroup = matches(groupId) || filtered.length > 0
      if (!showGroup) return
      const itemsToShow = matches(groupId) ? items : filtered
      if (itemsToShow.length === 0) return
      objectCountShown += itemsToShow.length
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
          this._selectLight(null)
          this._selectBrush(mesh)
          this._focusCameraOnObject(mesh)
        }))
      })
      details.appendChild(sublist)
      objectList.appendChild(details)
    })

    loose.filter(({ label }) => matches(label)).forEach(({ mesh, label }) => {
      objectCountShown += 1
      objectList.appendChild(makeButton(label, () => {
        this._selectLight(null)
        this._selectBrush(mesh)
        this._focusCameraOnObject(mesh)
      }))
    })

    if (objectCountShown === 0) {
      objectList.appendChild(makeEmpty(searchQuery ? 'No objects match this search.' : 'No objects in scene.'))
    }

    container.appendChild(objectList)

    const lightList = document.createElement('div')
    const allLights = [
      ...this._baseLightEntries,
      ...lights.map((entry, idx) => ({
        ...entry,
        label: `${entry.type}_light_${String(idx + 1).padStart(2, '0')}`,
      })),
    ].filter((entry) => entry?.light?.parent)
    const filteredLights = allLights.filter((entry) => matches(entry.label))
    lightList.appendChild(makeLabel('Lights'))
    filteredLights.forEach((entry) => {
      lightList.appendChild(makeButton(entry.label, () => {
        this._selectBrush(null)
        this._selectLight(entry)
        this._focusCameraOnObject(entry.light)
      }))
    })
    if (filteredLights.length === 0) {
      lightList.appendChild(makeEmpty(searchQuery ? 'No lights match this search.' : 'No lights in scene.'))
    }
    container.appendChild(lightList)
  }

  /**
   * @param {string} mode - 'brush' | 'level-builder' | 'floor-plan' | 'skybox'
   */
  updatePanelVisibility(mode) {
    const isFloorPlanMode = mode === 'floor-plan'
    const brushControls = this._panels.brushControls ?? document.getElementById('brush-controls')?.closest('.mode-panel')
    const skyboxControls = this._panels.skyboxControls ?? document.getElementById('skybox-controls')?.closest('.mode-panel')
    const floorPlanControls = this._panels.floorPlanControls ?? document.getElementById('floor-plan-controls')?.closest('.mode-panel')
    const cameraControlsPanel = this._panels.cameraControlsPanel ?? document.getElementById('camera-controls-panel')
    const sceneListPanel = this._panels.sceneListPanel ?? document.getElementById('scene-list-panel')
    const floorPlanEntitiesPanel = this._panels.floorPlanEntitiesPanel ?? document.getElementById('floor-plan-entities-panel')
    const levelBuilderEntitiesPanel = this._panels.levelBuilderEntitiesPanel ?? document.getElementById('level-builder-entities-panel')
    const viewport = this._panels.viewport ?? document.getElementById('viewport')
    const floorPlanToolRoot = this._panels.floorPlanToolRoot ?? document.getElementById('floor-plan-tool-root')

    if (viewport) viewport.classList.toggle('hidden', isFloorPlanMode)
    if (brushControls) brushControls.classList.toggle('hidden', mode !== 'brush')
    if (skyboxControls) skyboxControls.classList.toggle('hidden', mode !== 'skybox')
    if (floorPlanControls) floorPlanControls.classList.toggle('hidden', !isFloorPlanMode)
    if (cameraControlsPanel) cameraControlsPanel.classList.toggle('hidden', isFloorPlanMode)
    if (sceneListPanel) sceneListPanel.classList.toggle('hidden', mode !== 'brush')
    if (floorPlanEntitiesPanel) floorPlanEntitiesPanel.classList.toggle('hidden', !isFloorPlanMode)
    if (levelBuilderEntitiesPanel) levelBuilderEntitiesPanel.classList.toggle('hidden', mode !== 'level-builder')
    if (floorPlanToolRoot) floorPlanToolRoot.classList.toggle('hidden', !isFloorPlanMode)
  }

  /**
   * @param {THREE.Object3D | null} selectedBrush
   */
  updateBrushToolsPanel(selectedBrush) {
    const el = document.getElementById('csg-operation-select')
    if (el) {
      const isUserCsg = selectedBrush && this._isCsgBrush(selectedBrush) && selectedBrush.userData?.isUserBrush
      const key = isUserCsg ? (selectedBrush.userData?.csgOperation ?? this._getDefaultCsgOperationKey()) : this._getDefaultCsgOperationKey()
      if (this._csgOpValues[key] !== undefined) el.value = key
    }

    const includeRow = document.getElementById('csg-include-row')
    if (includeRow) {
      const canInclude = selectedBrush && this._isCsgBrush(selectedBrush) && !selectedBrush.userData?.isUserBrush
      includeRow.style.display = canInclude ? '' : 'none'
    }
  }
}
