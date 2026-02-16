import { generateFloorPlan, renderFloorPlanSvg } from './floor-plan-engine.js'

function encodeSvgMetadata(metadata) {
  return btoa(encodeURIComponent(JSON.stringify(metadata)))
}

function decodeSvgMetadata(svgElement) {
  const metadataNode = svgElement?.querySelector('#occult-floorplan-meta')
  if (metadataNode == null) return null
  const encoded = metadataNode.textContent?.trim()
  if (encoded == null || encoded.length === 0) return null
  try {
    const json = decodeURIComponent(atob(encoded))
    return JSON.parse(json)
  } catch {
    return null
  }
}

const MAX_SEED = 4294967295
const SETTINGS_KEY = 'brushEditor.floorPlanTool.settings'
const LATEST_SVG_KEY = 'brushEditor.floorPlanTool.latestSvg'

function createNumberField(labelText, id, value, min, max) {
  const row = document.createElement('label')
  row.className = 'floor-plan-control'
  row.setAttribute('for', id)
  row.textContent = labelText
  const input = document.createElement('input')
  input.type = 'number'
  input.id = id
  input.min = String(min)
  input.max = String(max)
  input.step = '1'
  input.value = String(value)
  row.appendChild(input)
  return { row, input }
}

function createRangeField(labelText, id, value, min, max, step = 1) {
  const row = document.createElement('label')
  row.className = 'floor-plan-control'
  row.setAttribute('for', id)
  const label = document.createElement('span')
  label.textContent = labelText
  const readout = document.createElement('strong')
  readout.textContent = String(value)
  label.append(' ', readout)
  const input = document.createElement('input')
  input.type = 'range'
  input.id = id
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => {
    readout.textContent = input.value
  })
  row.append(label, input)
  return { row, input }
}

function readPositiveInt(input, fallback) {
  const n = Number(input.value)
  if (!Number.isFinite(n)) return fallback
  const v = Math.round(n)
  return v > 0 ? v : fallback
}

function readBoundedInt(input, fallback, min, max) {
  const n = Number(input.value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function randomSeed() {
  const words = new Uint32Array(2)
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(words)
  } else {
    words[0] = Math.floor(Math.random() * 0xffffffff)
    words[1] = Math.floor(Math.random() * 0xffffffff)
  }
  const mixed = (words[0] ^ words[1] ^ (Date.now() >>> 0)) >>> 0
  const hashed = ((mixed * 2654435761) ^ (mixed >>> 16)) >>> 0
  return Math.max(1, Math.min(MAX_SEED, hashed))
}

function downloadSvg(svgText, fileName = `floor-plan-${Date.now()}.svg`) {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

function loadSettings() {
  const raw = window.localStorage.getItem(SETTINGS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function parseViewBox(svgElement) {
  const raw = svgElement.getAttribute('viewBox')
  if (raw == null) return null
  const values = raw.trim().split(/\s+/).map(Number)
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return null
  return { minX: values[0], minY: values[1], width: values[2], height: values[3] }
}

function parseViewBoxFromRaw(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const values = raw.trim().split(/\s+/).map(Number)
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return null
  return { minX: values[0], minY: values[1], width: values[2], height: values[3] }
}

function readBaseViewBox(svgElement) {
  const raw = svgElement.getAttribute('data-base-viewbox')
  return parseViewBoxFromRaw(raw) ?? parseViewBox(svgElement)
}

function updatePlayerStartElementGeometry(element, playerStart, padding) {
  const cx = playerStart.x + padding
  const cy = playerStart.y + padding
  element.setAttribute('data-plan-x', String(playerStart.x))
  element.setAttribute('data-plan-y', String(playerStart.y))
  const dot = element.querySelector('.player-start-dot')
  if (dot != null) {
    dot.setAttribute('cx', String(cx))
    dot.setAttribute('cy', String(cy))
  }
  const horizontal = element.querySelectorAll('.player-start-cross')[0]
  const vertical = element.querySelectorAll('.player-start-cross')[1]
  if (horizontal != null) {
    horizontal.setAttribute('x1', String(cx - 0.28))
    horizontal.setAttribute('y1', String(cy))
    horizontal.setAttribute('x2', String(cx + 0.28))
    horizontal.setAttribute('y2', String(cy))
  }
  if (vertical != null) {
    vertical.setAttribute('x1', String(cx))
    vertical.setAttribute('y1', String(cy - 0.28))
    vertical.setAttribute('x2', String(cx))
    vertical.setAttribute('y2', String(cy + 0.28))
  }
}

function updateNpcStartElementGeometry(element, npcSpawn, padding) {
  const cx = npcSpawn.x + padding
  const cy = npcSpawn.y + padding
  element.setAttribute('data-plan-x', String(npcSpawn.x))
  element.setAttribute('data-plan-y', String(npcSpawn.y))
  const body = element.querySelector('.npc-start-body')
  if (body != null) {
    body.setAttribute('x', String(cx - 0.22))
    body.setAttribute('y', String(cy - 0.5))
    body.setAttribute('width', '0.44')
    body.setAttribute('height', '1.0')
  }
  const head = element.querySelector('.npc-start-head')
  if (head != null) {
    head.setAttribute('cx', String(cx))
    head.setAttribute('cy', String(cy - 0.52))
    head.setAttribute('r', '0.18')
  }
}

function updateLightStartElementGeometry(element, lightSpawn, padding) {
  const cx = lightSpawn.x + padding
  const cy = lightSpawn.y + padding
  element.setAttribute('data-plan-x', String(lightSpawn.x))
  element.setAttribute('data-plan-y', String(lightSpawn.y))
  const core = element.querySelector('.light-start-core')
  const ring = element.querySelector('.light-start-ring')
  if (core != null) {
    core.setAttribute('cx', String(cx))
    core.setAttribute('cy', String(cy))
    core.setAttribute('r', '0.2')
  }
  if (ring != null) {
    ring.setAttribute('cx', String(cx))
    ring.setAttribute('cy', String(cy))
    ring.setAttribute('r', '0.38')
  }
}

export function mountFloorPlanTool(containerElement) {
  const previewContainer = containerElement?.previewContainer
  const controlsContainer = containerElement?.controlsContainer
  const entitiesContainer = containerElement?.entitiesContainer
  if (!previewContainer || !controlsContainer || !entitiesContainer) return
  if (previewContainer.dataset.mounted === 'true') return
  previewContainer.dataset.mounted = 'true'

  const saved = loadSettings()
  let latestSvg = ''
  let selectedNpcId = null
  let selectedLightId = null
  let dragState = null

  const preview = document.createElement('section')
  preview.className = 'floor-plan-preview'
  const previewContent = document.createElement('div')
  previewContent.className = 'floor-plan-preview-content'
  preview.appendChild(previewContent)
  previewContainer.appendChild(preview)

  const controls = document.createElement('div')
  controls.className = 'floor-plan-controls'
  const title = document.createElement('h2')
  title.textContent = 'Floor Plan SVG Generator'
  const seed = createNumberField('Seed', 'fp-seed', saved?.seed ?? randomSeed(), 1, MAX_SEED)
  const width = createNumberField('Width (m)', 'fp-width', saved?.width ?? 36, 12, 80)
  const height = createNumberField('Height (m)', 'fp-height', saved?.height ?? 24, 12, 80)
  const hallways = createNumberField('Hallway count', 'fp-hallways', saved?.hallwayCount ?? 1, 1, 4)
  const hallwayWidth = createRangeField(
    'Hallway width (cells)',
    'fp-max-hallway-width',
    saved?.maxCorridorWidthCells ?? 13,
    3,
    25,
    1
  )
  const doors = createNumberField('Target rooms', 'fp-doors', saved?.doorCount ?? 6, 1, 24)
  const windows = createNumberField('Max windows', 'fp-windows', saved?.maxWindowCount ?? 8, 0, 24)
  const lights = createNumberField('Max lights', 'fp-lights', saved?.maxLightCount ?? 10, 0, 80)
  const roomShapeStyle = createRangeField('Rectilinear rooms (%)', 'fp-room-shape', saved?.roomShapeStyle ?? 45, 0, 100)

  const actions = document.createElement('div')
  actions.className = 'floor-plan-actions'
  const randomizeBtn = document.createElement('button')
  randomizeBtn.type = 'button'
  randomizeBtn.id = 'fp-randomize-seed'
  randomizeBtn.textContent = 'Randomize Seed'
  const generateBtn = document.createElement('button')
  generateBtn.type = 'button'
  generateBtn.className = 'primary'
  generateBtn.textContent = 'Generate'
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.id = 'fp-save-svg'
  saveBtn.textContent = 'Save SVG'
  actions.append(randomizeBtn, generateBtn, saveBtn)

  const status = document.createElement('p')
  status.className = 'floor-plan-status'
  status.textContent = 'Generate a floor plan.'
  const stats = document.createElement('p')
  stats.className = 'floor-plan-stats'
  stats.textContent = saved?.statsText ?? ''
  controls.append(
    title,
    seed.row,
    width.row,
    height.row,
    hallways.row,
    hallwayWidth.row,
    doors.row,
    windows.row,
    lights.row,
    roomShapeStyle.row,
    actions,
    status,
    stats
  )
  controlsContainer.appendChild(controls)

  const entitiesWrap = document.createElement('div')
  entitiesWrap.className = 'floor-plan-entities'
  const entityActions = document.createElement('div')
  entityActions.className = 'floor-plan-actions'
  const addEntityBtn = document.createElement('button')
  addEntityBtn.type = 'button'
  addEntityBtn.id = 'fp-add-entity'
  addEntityBtn.textContent = 'Add'
  const deleteEntityBtn = document.createElement('button')
  deleteEntityBtn.type = 'button'
  deleteEntityBtn.textContent = 'Delete selected'
  entityActions.append(addEntityBtn, deleteEntityBtn)
  const entitiesList = document.createElement('ul')
  entitiesList.className = 'floor-plan-entity-list'
  entitiesWrap.append(entityActions, entitiesList)
  entitiesContainer.appendChild(entitiesWrap)

  const addEntityOverlay = document.createElement('div')
  addEntityOverlay.id = 'floor-plan-entity-picker-overlay'
  addEntityOverlay.className = 'entity-picker-overlay'
  addEntityOverlay.hidden = true
  addEntityOverlay.innerHTML = `
    <div class="entity-picker-dialog" role="dialog" aria-modal="true" aria-label="Select entity type to add">
      <h3>Add entity</h3>
      <div class="entity-picker-options">
        <button type="button" class="entity-picker-option" data-entity-type="npc" aria-label="Add NPC placeholder">
          <span aria-hidden="true">🤖</span>
          <span>NPC</span>
        </button>
        <button type="button" class="entity-picker-option" data-entity-type="light" aria-label="Add light">
          <span aria-hidden="true">💡</span>
          <span>Light</span>
        </button>
      </div>
      <button type="button" class="entity-picker-cancel">Cancel</button>
    </div>
  `
  document.body.appendChild(addEntityOverlay)

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  function persistSettings(statsText) {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        seed: readPositiveInt(seed.input, Date.now()),
        width: readPositiveInt(width.input, 36),
        height: readPositiveInt(height.input, 24),
        hallwayCount: readPositiveInt(hallways.input, 1),
        maxCorridorWidthCells: readBoundedInt(hallwayWidth.input, 13, 3, 25),
        doorCount: readPositiveInt(doors.input, 6),
        maxWindowCount: readPositiveInt(windows.input, 8),
        maxLightCount: readBoundedInt(lights.input, 10, 0, 80),
        roomShapeStyle: readBoundedInt(roomShapeStyle.input, 45, 0, 100),
        statsText,
      })
    )
  }

  function persistMetadata(svg, metadata) {
    const metadataNode = svg.querySelector('#occult-floorplan-meta')
    if (metadataNode != null) metadataNode.textContent = encodeSvgMetadata(metadata)
    latestSvg = svg.outerHTML
    window.localStorage.setItem(LATEST_SVG_KEY, latestSvg)
  }

  function renderEntityList(metadata) {
    entitiesList.innerHTML = ''
    if (metadata?.playerStart) {
      const item = document.createElement('li')
      item.className = 'floor-plan-entity-item'
      item.textContent = `player_start (${Number(metadata.playerStart.x).toFixed(1)}, ${Number(metadata.playerStart.y).toFixed(1)})`
      entitiesList.appendChild(item)
    }
    ;(metadata?.npcSpawns ?? []).forEach((npc, index) => {
      const id = npc.id ?? `npc-${index + 1}`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'floor-plan-entity-item'
      if (selectedNpcId === id) btn.classList.add('is-selected')
      btn.textContent = `${id} (${Number(npc.x).toFixed(1)}, ${Number(npc.y).toFixed(1)})`
      btn.addEventListener('click', () => {
        selectedLightId = null
        selectedNpcId = id
        bindSvgInteractions()
      })
      entitiesList.appendChild(btn)
    })
    ;(metadata?.lightSpawns ?? []).forEach((light, index) => {
      const id = light.id ?? `light-${index + 1}`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'floor-plan-entity-item'
      if (selectedLightId === id) btn.classList.add('is-selected')
      btn.textContent = `${id} (${Number(light.x).toFixed(1)}, ${Number(light.y).toFixed(1)})`
      btn.addEventListener('click', () => {
        selectedNpcId = null
        selectedLightId = id
        bindSvgInteractions()
      })
      entitiesList.appendChild(btn)
    })
    if (entitiesList.children.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'floor-plan-entity-empty'
      empty.textContent = 'No entities.'
      entitiesList.appendChild(empty)
    }
  }

  function bindSvgInteractions() {
    const svg = previewContent.querySelector('svg')
    if (!svg) return
    const metadata = decodeSvgMetadata(svg)
    if (!metadata) return
    const viewBox = parseViewBox(svg)
    if (!viewBox) return
    const padding = Number(metadata.padding) || 0
    const planWidth = Math.max(0, viewBox.width - padding * 2)
    const planHeight = Math.max(0, viewBox.height - padding * 2)
    metadata.playerStart = metadata.playerStart ?? { x: planWidth / 2, y: planHeight / 2 }
    metadata.npcSpawns = Array.isArray(metadata.npcSpawns) ? metadata.npcSpawns : []
    metadata.lightSpawns = Array.isArray(metadata.lightSpawns) ? metadata.lightSpawns : []

    const playerMarker = svg.querySelector('.player-start-marker')
    if (playerMarker) {
      updatePlayerStartElementGeometry(playerMarker, metadata.playerStart, padding)
    }
    svg.querySelectorAll('.npc-start-marker').forEach((element) => {
      const id = element.getAttribute('data-id')
      const npc = metadata.npcSpawns.find((entry) => entry.id === id)
      if (npc) updateNpcStartElementGeometry(element, npc, padding)
      element.classList.toggle('is-selected', id != null && id === selectedNpcId)
    })
    svg.querySelectorAll('.light-start-marker').forEach((element) => {
      const id = element.getAttribute('data-id')
      const light = metadata.lightSpawns.find((entry) => entry.id === id)
      if (light) updateLightStartElementGeometry(element, light, padding)
      element.classList.toggle('is-selected', id != null && id === selectedLightId)
    })
    renderEntityList(metadata)

    const svgPoint = svg.createSVGPoint()
    const toSvgCoordinates = (event) => {
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      svgPoint.x = event.clientX
      svgPoint.y = event.clientY
      return svgPoint.matrixTransform(ctm.inverse())
    }
    const toViewBoxDelta = (deltaPixelsX, deltaPixelsY) => {
      const rect = svg.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return {
        x: (deltaPixelsX / rect.width) * viewBox.width,
        y: (deltaPixelsY / rect.height) * viewBox.height,
      }
    }
    const baseViewBox = readBaseViewBox(svg)
    const minViewBoxWidth = Math.max(1, (baseViewBox?.width ?? viewBox.width) * 0.2)
    const minViewBoxHeight = Math.max(1, (baseViewBox?.height ?? viewBox.height) * 0.2)
    const maxViewBoxWidth = Math.max(viewBox.width * 8, (baseViewBox?.width ?? viewBox.width) * 8)
    const maxViewBoxHeight = Math.max(viewBox.height * 8, (baseViewBox?.height ?? viewBox.height) * 8)
    const zoomAtPointer = (event) => {
      const point = toSvgCoordinates(event)
      const currentViewBox = parseViewBox(svg)
      if (!point || !currentViewBox) return
      let delta = event.deltaY
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= 240
      const clampedDelta = Math.max(-120, Math.min(120, delta))
      const zoomFactor = Math.pow(1.0018, clampedDelta)
      const nextWidth = clamp(currentViewBox.width * zoomFactor, minViewBoxWidth, maxViewBoxWidth)
      const nextHeight = clamp(currentViewBox.height * zoomFactor, minViewBoxHeight, maxViewBoxHeight)
      if (
        Math.abs(nextWidth - currentViewBox.width) < 0.0001 &&
        Math.abs(nextHeight - currentViewBox.height) < 0.0001
      ) return
      const anchorX = (point.x - currentViewBox.minX) / currentViewBox.width
      const anchorY = (point.y - currentViewBox.minY) / currentViewBox.height
      const nextViewBox = {
        minX: point.x - anchorX * nextWidth,
        minY: point.y - anchorY * nextHeight,
        width: nextWidth,
        height: nextHeight,
      }
      svg.setAttribute('viewBox', `${nextViewBox.minX} ${nextViewBox.minY} ${nextViewBox.width} ${nextViewBox.height}`)
      persistMetadata(svg, metadata)
      previewContent.innerHTML = latestSvg
      bindSvgInteractions()
    }
    const clampPlanX = (x) => clamp(x, 0, planWidth)
    const clampPlanY = (y) => clamp(y, 0, planHeight)

    svg.onpointerdown = (event) => {
      const player = event.target.closest('.player-start-marker')
      if (player) {
        const point = toSvgCoordinates(event)
        if (!point) return
        selectedNpcId = null
        selectedLightId = null
        dragState = {
          kind: 'player',
          element: player,
          offsetX: point.x - (metadata.playerStart.x + padding),
          offsetY: point.y - (metadata.playerStart.y + padding),
        }
        player.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
      const npcElement = event.target.closest('.npc-start-marker')
      if (npcElement) {
        const id = npcElement.getAttribute('data-id')
        const npc = metadata.npcSpawns.find((entry) => entry.id === id)
        const point = toSvgCoordinates(event)
        if (!id || !npc || !point) return
        selectedNpcId = id
        selectedLightId = null
        dragState = {
          kind: 'npc',
          id,
          element: npcElement,
          offsetX: point.x - (npc.x + padding),
          offsetY: point.y - (npc.y + padding),
        }
        npcElement.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
      const lightElement = event.target.closest('.light-start-marker')
      if (lightElement) {
        const id = lightElement.getAttribute('data-id')
        const light = metadata.lightSpawns.find((entry) => entry.id === id)
        const point = toSvgCoordinates(event)
        if (!id || !light || !point) return
        selectedLightId = id
        selectedNpcId = null
        dragState = {
          kind: 'light',
          id,
          element: lightElement,
          offsetX: point.x - (light.x + padding),
          offsetY: point.y - (light.y + padding),
        }
        lightElement.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
      selectedNpcId = null
      selectedLightId = null
      const currentViewBox = parseViewBox(svg)
      if (!currentViewBox) return
      svg.querySelectorAll('.npc-start-marker').forEach((el) => el.classList.remove('is-selected'))
      svg.querySelectorAll('.light-start-marker').forEach((el) => el.classList.remove('is-selected'))
      renderEntityList(metadata)
      dragState = {
        kind: 'pan',
        element: svg,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewBox: currentViewBox,
      }
      svg.setPointerCapture(event.pointerId)
      svg.classList.add('is-panning')
      event.preventDefault()
    }

    svg.onpointermove = (event) => {
      if (!dragState) return
      if (dragState.kind === 'pan') {
        const delta = toViewBoxDelta(
          event.clientX - dragState.startClientX,
          event.clientY - dragState.startClientY
        )
        if (!delta) return
        svg.setAttribute(
          'viewBox',
          `${dragState.startViewBox.minX - delta.x} ${dragState.startViewBox.minY - delta.y} ${dragState.startViewBox.width} ${dragState.startViewBox.height}`
        )
        return
      }
      const point = toSvgCoordinates(event)
      if (!point) return
      if (dragState.kind === 'player') {
        metadata.playerStart.x = clampPlanX(point.x - dragState.offsetX - padding)
        metadata.playerStart.y = clampPlanY(point.y - dragState.offsetY - padding)
        updatePlayerStartElementGeometry(dragState.element, metadata.playerStart, padding)
        return
      }
      if (dragState.kind === 'npc') {
        const npc = metadata.npcSpawns.find((entry) => entry.id === dragState.id)
        if (!npc) return
        npc.x = clampPlanX(point.x - dragState.offsetX - padding)
        npc.y = clampPlanY(point.y - dragState.offsetY - padding)
        updateNpcStartElementGeometry(dragState.element, npc, padding)
        return
      }
      if (dragState.kind === 'light') {
        const light = metadata.lightSpawns.find((entry) => entry.id === dragState.id)
        if (!light) return
        light.x = clampPlanX(point.x - dragState.offsetX - padding)
        light.y = clampPlanY(point.y - dragState.offsetY - padding)
        updateLightStartElementGeometry(dragState.element, light, padding)
      }
    }

    const endDrag = (event) => {
      if (!dragState) return
      dragState.element.releasePointerCapture(event.pointerId)
      svg.classList.remove('is-panning')
      dragState = null
      persistMetadata(svg, metadata)
      previewContent.innerHTML = latestSvg
      bindSvgInteractions()
    }
    svg.onpointerup = endDrag
    svg.onpointercancel = endDrag
    svg.onwheel = (event) => {
      if (dragState) return
      event.preventDefault()
      zoomAtPointer(event)
    }
  }

  function generate() {
    const options = {
      seed: readPositiveInt(seed.input, Date.now()),
      width: readPositiveInt(width.input, 36),
      height: readPositiveInt(height.input, 24),
      hallwayCount: readPositiveInt(hallways.input, 1),
      maxCorridorWidthCells: readBoundedInt(hallwayWidth.input, 13, 3, 25),
      doorCount: readPositiveInt(doors.input, 6),
      maxWindowCount: readPositiveInt(windows.input, 8),
      maxLightCount: readBoundedInt(lights.input, 10, 0, 80),
      roomShapeStyle: readBoundedInt(roomShapeStyle.input, 45, 0, 100),
      strictDoorCount: false,
      requireExteriorExits: false,
    }
    seed.input.value = String(options.seed)
    status.textContent = 'Generating hallway...'
    try {
      const previousViewBoxRaw = (() => {
        const currentSvg = previewContent.querySelector('svg')
        if (!currentSvg) return null
        const raw = currentSvg.getAttribute('viewBox')
        return parseViewBoxFromRaw(raw) ? raw : null
      })()
      const previousMetadata = (() => {
        if (!latestSvg) return null
        const wrapper = document.createElement('div')
        wrapper.innerHTML = latestSvg
        return decodeSvgMetadata(wrapper.querySelector('svg'))
      })()
      const plan = generateFloorPlan(options)
      const playerStart = previousMetadata?.playerStart ?? { x: options.width / 2, y: options.height / 2 }
      const npcSpawns = Array.isArray(previousMetadata?.npcSpawns) ? previousMetadata.npcSpawns : []
      latestSvg = renderFloorPlanSvg(plan, {
        playerStart,
        npcSpawns,
        lightSpawns: plan.lightSpawns ?? [],
      })
      previewContent.innerHTML = latestSvg
      const generatedSvg = previewContent.querySelector('svg')
      if (generatedSvg && previousViewBoxRaw) {
        generatedSvg.setAttribute('viewBox', previousViewBoxRaw)
        latestSvg = generatedSvg.outerHTML
      }
      window.localStorage.setItem(LATEST_SVG_KEY, latestSvg)
      const statsText =
        `Hallways: ${plan.meta.hallwayCount} · Walls: ${plan.walls.length} · ` +
        `Rooms: ${plan.meta.placedDoorCount}/${options.doorCount} · ` +
        `Windows: ${plan.meta.windowCount}/${options.maxWindowCount} · ` +
        `Lights: ${plan.meta.lightCount}/${options.maxLightCount}`
      stats.textContent = statsText
      persistSettings(statsText)
      selectedNpcId = null
      selectedLightId = null
      bindSvgInteractions()
      status.textContent = plan.meta.hasExteriorExit
        ? 'Hallway generated.'
        : 'Hallway generated, but fewer than 2 exterior exits were available.'
    } catch (error) {
      status.textContent = `Could not generate hallway: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  function addEntityByType(entityType) {
    const svg = previewContent.querySelector('svg')
    if (!svg) {
      status.textContent = 'Generate a floor plan before adding entities.'
      return
    }
    const metadata = decodeSvgMetadata(svg)
    const viewBox = parseViewBox(svg)
    if (!metadata || !viewBox) {
      status.textContent = 'Could not read floor plan metadata.'
      return
    }
    const padding = Number(metadata.padding) || 0
    const planWidth = Math.max(0, viewBox.width - padding * 2)
    const planHeight = Math.max(0, viewBox.height - padding * 2)
    metadata.npcSpawns = Array.isArray(metadata.npcSpawns) ? metadata.npcSpawns : []
    metadata.lightSpawns = Array.isArray(metadata.lightSpawns) ? metadata.lightSpawns : []
    if (entityType === 'npc') {
      const id = `npc-${metadata.npcSpawns.length + 1}`
      const offset = metadata.npcSpawns.length * 0.5
      metadata.npcSpawns.push({
        id,
        x: clamp(planWidth * 0.5 + offset, 0, planWidth),
        y: clamp(planHeight * 0.5 + offset, 0, planHeight),
      })
      selectedNpcId = id
      selectedLightId = null
    } else if (entityType === 'light') {
      const id = `light-${metadata.lightSpawns.length + 1}`
      const offset = metadata.lightSpawns.length * 0.5
      metadata.lightSpawns.push({
        id,
        x: clamp(planWidth * 0.5 + offset, 0, planWidth),
        y: clamp(planHeight * 0.5 + offset, 0, planHeight),
        height: 2.35,
        intensity: 1.2,
        range: 7.5,
        color: '#ffe8b8',
      })
      selectedLightId = id
      selectedNpcId = null
    }
    persistMetadata(svg, metadata)
    previewContent.innerHTML = latestSvg
    bindSvgInteractions()
    status.textContent = entityType === 'npc' ? 'NPC placeholder added.' : 'Light added.'
  }

  addEntityBtn.addEventListener('click', () => {
    addEntityOverlay.hidden = false
  })
  deleteEntityBtn.addEventListener('click', () => {
    const svg = previewContent.querySelector('svg')
    if (!svg) return
    const metadata = decodeSvgMetadata(svg)
    if (!metadata) return
    metadata.npcSpawns = Array.isArray(metadata.npcSpawns) ? metadata.npcSpawns : []
    metadata.lightSpawns = Array.isArray(metadata.lightSpawns) ? metadata.lightSpawns : []
    if (selectedNpcId != null) {
      metadata.npcSpawns = metadata.npcSpawns.filter((entry) => entry.id !== selectedNpcId)
      selectedNpcId = null
      persistMetadata(svg, metadata)
      previewContent.innerHTML = latestSvg
      bindSvgInteractions()
      status.textContent = 'NPC placeholder deleted.'
      return
    }
    if (selectedLightId != null) {
      metadata.lightSpawns = metadata.lightSpawns.filter((entry) => entry.id !== selectedLightId)
      selectedLightId = null
      persistMetadata(svg, metadata)
      previewContent.innerHTML = latestSvg
      bindSvgInteractions()
      status.textContent = 'Light deleted.'
      return
    }
    status.textContent = 'Select an NPC or light first.'
  })

  addEntityOverlay.addEventListener('click', (event) => {
    if (event.target === addEntityOverlay) {
      addEntityOverlay.hidden = true
      return
    }
    if (!(event.target instanceof HTMLElement)) return
    const option = event.target.closest('[data-entity-type]')
    if (option instanceof HTMLElement) {
      const type = option.dataset.entityType
      if (type === 'npc' || type === 'light') {
        addEntityByType(type)
      }
      addEntityOverlay.hidden = true
      return
    }
    if (event.target.closest('.entity-picker-cancel') != null) {
      addEntityOverlay.hidden = true
    }
  })

  window.addEventListener('keydown', (event) => {
    if (previewContainer.classList.contains('hidden')) return
    if (event.key === 'Escape' && !addEntityOverlay.hidden) {
      addEntityOverlay.hidden = true
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedNpcId != null || selectedLightId != null)) {
      deleteEntityBtn.click()
      event.preventDefault()
    }
  })

  randomizeBtn.addEventListener('click', () => {
    seed.input.value = String(randomSeed())
    generate()
  })
  generateBtn.addEventListener('click', generate)
  saveBtn.addEventListener('click', () => {
    if (!latestSvg) {
      status.textContent = 'Generate a floor plan before saving.'
      return
    }
    downloadSvg(latestSvg)
    status.textContent = 'SVG downloaded.'
  })

  const savedSvg = window.localStorage.getItem(LATEST_SVG_KEY)
  if (savedSvg) {
    latestSvg = savedSvg
    previewContent.innerHTML = latestSvg
    status.textContent = 'Loaded previous floor plan.'
    bindSvgInteractions()
  } else {
    generate()
  }
}
