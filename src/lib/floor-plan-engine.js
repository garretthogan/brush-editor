const DEFAULT_OPTIONS = {
  width: 36,
  height: 24,
  hallwayCount: 1,
  doorCount: 6,
  maxLightCount: 10,
  roomShapeStyle: 45,
  maxWindowCount: 8,
  wallStroke: 0.28,
  seed: Date.now(),
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createRng(seed) {
  let state = (Number(seed) >>> 0) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

function cellKey(x, y) {
  return `${x},${y}`
}

function parseCellKey(key) {
  const [xRaw, yRaw] = key.split(',')
  return { x: Number(xRaw), y: Number(yRaw) }
}

function normalizeEdge(x1, y1, x2, y2) {
  if (x1 < x2 || (x1 === x2 && y1 <= y2)) return { x1, y1, x2, y2 }
  return { x1: x2, y1: y2, x2: x1, y2: y1 }
}

function edgeKey(edge) {
  return `${edge.x1},${edge.y1}|${edge.x2},${edge.y2}`
}

function edgeLength(edge) {
  return Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1)
}

function buildHallways(bounds, hallwayCount, rng) {
  const groups = []
  const allCells = new Set()
  const anchorX = Math.floor(bounds.cols / 2)
  const anchorY = Math.floor(bounds.rows / 2)
  for (let index = 0; index < hallwayCount; index++) {
    const local = new Set()
    const steps = randomInt(rng, 28, 64)
    const brushRadius = rng() > 0.5 ? 1 : 0
    let x = anchorX
    let y = anchorY
    if (index > 0) {
      const radius = randomInt(rng, 1, 4)
      const angle = rng() * Math.PI * 2
      x = clamp(Math.round(anchorX + Math.cos(angle) * radius), 1, bounds.cols - 2)
      y = clamp(Math.round(anchorY + Math.sin(angle) * radius), 1, bounds.rows - 2)
    }
    let direction = randomInt(rng, 0, 3)
    for (let step = 0; step < steps; step++) {
      if (rng() < 0.18) direction = randomInt(rng, 0, 3)
      // Bias the walk toward the center anchor to keep generated layouts stable on screen.
      if (rng() < 0.32) {
        const towardCenterX = anchorX - x
        const towardCenterY = anchorY - y
        if (Math.abs(towardCenterX) > Math.abs(towardCenterY)) {
          direction = towardCenterX >= 0 ? 0 : 1
        } else {
          direction = towardCenterY >= 0 ? 2 : 3
        }
      }
      if (direction === 0) x += 1
      if (direction === 1) x -= 1
      if (direction === 2) y += 1
      if (direction === 3) y -= 1
      x = clamp(x, 1, bounds.cols - 2)
      y = clamp(y, 1, bounds.rows - 2)
      for (let dy = -brushRadius; dy <= brushRadius; dy++) {
        for (let dx = -brushRadius; dx <= brushRadius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= bounds.cols || ny < 0 || ny >= bounds.rows) continue
          const key = cellKey(nx, ny)
          local.add(key)
          allCells.add(key)
        }
      }
    }
    const cells = [...local].map(parseCellKey)
    if (cells.length === 0) continue
    const sum = cells.reduce((acc, cell) => ({ x: acc.x + cell.x + 0.5, y: acc.y + cell.y + 0.5 }), { x: 0, y: 0 })
    groups.push({
      id: `hall-${groups.length + 1}`,
      shape: null,
      labelX: sum.x / cells.length,
      labelY: sum.y / cells.length,
      cells,
    })
  }
  if (groups.length === 0) {
    const key = cellKey(Math.floor(bounds.cols / 2), Math.floor(bounds.rows / 2))
    allCells.add(key)
    const cell = parseCellKey(key)
    groups.push({
      id: 'hall-1',
      shape: null,
      labelX: cell.x + 0.5,
      labelY: cell.y + 0.5,
      cells: [cell],
    })
  }
  return { hallwayCells: allCells, hallways: groups }
}

function roomRectFits(rect, bounds, occupied) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > bounds.cols || rect.y + rect.height > bounds.rows) return false
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (occupied.has(cellKey(x, y))) return false
    }
  }
  return true
}

function generateRoomsFromHallways(bounds, hallwayCells, doorCount, roomShapeStyle, rng) {
  const occupied = new Set(hallwayCells)
  const ownerByCell = new Map()
  hallwayCells.forEach((key) => ownerByCell.set(key, '__hallway__'))
  const rooms = []
  const doorOpenings = []
  const candidates = []
  hallwayCells.forEach((key) => {
    const { x, y } = parseCellKey(key)
    const neighbors = [
      { dx: 0, dy: -1, side: 'north' },
      { dx: 1, dy: 0, side: 'east' },
      { dx: 0, dy: 1, side: 'south' },
      { dx: -1, dy: 0, side: 'west' },
    ]
    neighbors.forEach((n) => {
      const nx = x + n.dx
      const ny = y + n.dy
      if (nx < 0 || ny < 0 || nx >= bounds.cols || ny >= bounds.rows) return
      const nKey = cellKey(nx, ny)
      if (hallwayCells.has(nKey)) return
      const edge = n.side === 'north'
        ? normalizeEdge(x, y, x + 1, y)
        : n.side === 'east'
          ? normalizeEdge(x + 1, y, x + 1, y + 1)
          : n.side === 'south'
            ? normalizeEdge(x, y + 1, x + 1, y + 1)
            : normalizeEdge(x, y, x, y + 1)
      candidates.push({ x, y, side: n.side, edge })
    })
  })
  for (let index = candidates.length - 1; index > 0; index--) {
    const swap = randomInt(rng, 0, index)
    const temp = candidates[index]
    candidates[index] = candidates[swap]
    candidates[swap] = temp
  }

  const style = clamp(Number(roomShapeStyle) / 100, 0, 1)
  const maxRoomAttempts = Math.min(candidates.length, Math.max(doorCount * 6, 32))
  for (let index = 0; index < maxRoomAttempts && rooms.length < doorCount; index++) {
    const candidate = candidates[index]
    const base = 4 + Math.round(style * 4)
    const width = randomInt(rng, base, base + 4)
    const height = randomInt(rng, base, base + 4)
    let rect = null
    if (candidate.side === 'north') rect = { x: candidate.x - Math.floor(width / 2), y: candidate.y - height, width, height }
    if (candidate.side === 'south') rect = { x: candidate.x - Math.floor(width / 2), y: candidate.y + 1, width, height }
    if (candidate.side === 'west') rect = { x: candidate.x - width, y: candidate.y - Math.floor(height / 2), width, height }
    if (candidate.side === 'east') rect = { x: candidate.x + 1, y: candidate.y - Math.floor(height / 2), width, height }
    if (rect == null || !roomRectFits(rect, bounds, occupied)) continue

    const roomId = `room-${rooms.length + 1}`
    const cells = []
    let sumX = 0
    let sumY = 0
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const key = cellKey(x, y)
        occupied.add(key)
        ownerByCell.set(key, roomId)
        cells.push({ x, y })
        sumX += x + 0.5
        sumY += y + 0.5
      }
    }
    rooms.push({
      id: roomId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      cells,
      labelX: sumX / cells.length,
      labelY: sumY / cells.length,
    })
    doorOpenings.push({
      wallKey: edgeKey(candidate.edge),
      type: 'door',
      start: 0.1,
      end: 0.9,
    })
  }
  return { rooms, occupied, ownerByCell, doorOpenings }
}

function buildWalls(ownerByCell) {
  const walls = []
  const seen = new Set()
  ownerByCell.forEach((owner, key) => {
    const { x, y } = parseCellKey(key)
    const neighbors = [
      { key: cellKey(x, y - 1), edge: normalizeEdge(x, y, x + 1, y) },
      { key: cellKey(x + 1, y), edge: normalizeEdge(x + 1, y, x + 1, y + 1) },
      { key: cellKey(x, y + 1), edge: normalizeEdge(x, y + 1, x + 1, y + 1) },
      { key: cellKey(x - 1, y), edge: normalizeEdge(x, y, x, y + 1) },
    ]
    neighbors.forEach((neighbor) => {
      const neighborOwner = ownerByCell.get(neighbor.key)
      if (neighborOwner === owner) return
      const key = edgeKey(neighbor.edge)
      if (seen.has(key)) return
      seen.add(key)
      walls.push({ edge: neighbor.edge })
    })
  })
  return walls
}

function createWallSegmentsFromOpenings(wall, openings) {
  const length = edgeLength(wall.edge)
  const sorted = [...openings].sort((a, b) => a.start - b.start)
  const segments = []
  let cursor = 0
  sorted.forEach((opening) => {
    const start = clamp(opening.start, 0, length)
    const end = clamp(opening.end, 0, length)
    if (start > cursor) segments.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  })
  if (cursor < length) segments.push({ start: cursor, end: length })
  const dx = wall.edge.x2 - wall.edge.x1
  const dy = wall.edge.y2 - wall.edge.y1
  const invLength = length === 0 ? 0 : 1 / length
  return segments
    .filter((segment) => segment.end - segment.start > 0.05)
    .map((segment) => ({
      x1: wall.edge.x1 + dx * segment.start * invLength,
      y1: wall.edge.y1 + dy * segment.start * invLength,
      x2: wall.edge.x1 + dx * segment.end * invLength,
      y2: wall.edge.y1 + dy * segment.end * invLength,
      type: 'wall',
    }))
}

function createOpeningGlyph(edge, opening) {
  const length = edgeLength(edge)
  if (length === 0) return null
  const dx = edge.x2 - edge.x1
  const dy = edge.y2 - edge.y1
  const invLength = 1 / length
  return {
    x1: edge.x1 + dx * opening.start * invLength,
    y1: edge.y1 + dy * opening.start * invLength,
    x2: edge.x1 + dx * opening.end * invLength,
    y2: edge.y1 + dy * opening.end * invLength,
    type: opening.type,
  }
}

function createWindows(maxWindowCount, walls, existingOpenings, rng) {
  const count = Math.max(0, Math.round(Number(maxWindowCount) || 0))
  if (count === 0) return []
  const blocked = new Set(existingOpenings.map((opening) => opening.wallKey))
  const candidates = walls.filter((wall) => edgeLength(wall.edge) >= 1 && !blocked.has(edgeKey(wall.edge)))
  if (candidates.length === 0) return []
  for (let index = candidates.length - 1; index > 0; index--) {
    const swap = randomInt(rng, 0, index)
    const temp = candidates[index]
    candidates[index] = candidates[swap]
    candidates[swap] = temp
  }
  return candidates.slice(0, Math.min(count, candidates.length)).map((wall) => ({
    wallKey: edgeKey(wall.edge),
    type: 'window',
    start: 0.15,
    end: 0.85,
  }))
}

function createLightSpawns(occupied, maxLightCount, rng) {
  const count = Math.max(0, Math.round(Number(maxLightCount) || 0))
  const cells = [...occupied].map(parseCellKey)
  if (count === 0 || cells.length === 0) return []
  for (let index = cells.length - 1; index > 0; index--) {
    const swap = randomInt(rng, 0, index)
    const temp = cells[index]
    cells[index] = cells[swap]
    cells[swap] = temp
  }
  return cells.slice(0, Math.min(count, cells.length)).map((cell, index) => ({
    id: `light-${index + 1}`,
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    height: 2.35,
    intensity: 1.2,
    range: 7.5,
    color: '#ffe8b8',
  }))
}

function svgLine(line, className) {
  return `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" class="${className}" />`
}

function encodePlanMetadata(metadata) {
  return btoa(encodeURIComponent(JSON.stringify(metadata)))
}

export function generateFloorPlan(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions }
  options.width = clamp(Number(options.width) || DEFAULT_OPTIONS.width, 12, 100)
  options.height = clamp(Number(options.height) || DEFAULT_OPTIONS.height, 12, 100)
  options.hallwayCount = Math.round(clamp(Number(options.hallwayCount) || 1, 1, 6))
  options.doorCount = Math.round(clamp(Number(options.doorCount) || 0, 0, 40))
  options.maxWindowCount = Math.round(clamp(Number(options.maxWindowCount) || 0, 0, 40))
  options.maxLightCount = Math.round(clamp(Number(options.maxLightCount) || 0, 0, 80))
  options.roomShapeStyle = Math.round(clamp(Number(options.roomShapeStyle) || DEFAULT_OPTIONS.roomShapeStyle, 0, 100))

  const bounds = {
    cols: Math.max(12, Math.round(options.width)),
    rows: Math.max(12, Math.round(options.height)),
  }
  const rng = createRng(options.seed)
  const { hallwayCells, hallways } = buildHallways(bounds, options.hallwayCount, rng)
  const { rooms, occupied, ownerByCell, doorOpenings } = generateRoomsFromHallways(
    bounds,
    hallwayCells,
    options.doorCount,
    options.roomShapeStyle,
    rng
  )
  const rawWalls = buildWalls(ownerByCell)
  const windowOpenings = createWindows(options.maxWindowCount, rawWalls, doorOpenings, rng)
  const allOpenings = [...doorOpenings, ...windowOpenings]
  const openingsByWall = new Map()
  allOpenings.forEach((opening) => {
    if (!openingsByWall.has(opening.wallKey)) openingsByWall.set(opening.wallKey, [])
    openingsByWall.get(opening.wallKey).push(opening)
  })
  const walls = []
  const openingGlyphs = []
  rawWalls.forEach((wall) => {
    const openings = openingsByWall.get(edgeKey(wall.edge)) ?? []
    walls.push(...createWallSegmentsFromOpenings(wall, openings))
    openings.forEach((opening) => {
      const glyph = createOpeningGlyph(wall.edge, opening)
      if (glyph != null) openingGlyphs.push(glyph)
    })
  })
  const lightSpawns = createLightSpawns(occupied, options.maxLightCount, rng)

  return {
    meta: {
      width: options.width,
      height: options.height,
      seed: options.seed,
      roomCount: rooms.length,
      hallwayCount: hallways.length,
      requestedDoorCount: options.doorCount,
      placedDoorCount: doorOpenings.length,
      hasExteriorExit: true,
      lightCount: lightSpawns.length,
      windowCount: windowOpenings.length,
      wallCount: walls.length,
    },
    rooms,
    hallways,
    walls,
    openings: openingGlyphs,
    lightSpawns,
    furniture: [],
  }
}

export function renderFloorPlanSvg(plan, options = {}) {
  const padding = options.padding ?? 1.5
  const width = plan.meta.width + padding * 2
  const height = plan.meta.height + padding * 2
  const wallStroke = options.wallStroke ?? DEFAULT_OPTIONS.wallStroke
  const labelRooms = options.labelRooms ?? true
  const playerStart = options.playerStart ?? { x: plan.meta.width / 2, y: plan.meta.height / 2 }
  const npcSpawns = Array.isArray(options.npcSpawns) ? options.npcSpawns : []
  const lightSpawns = Array.isArray(options.lightSpawns) ? options.lightSpawns : (plan.lightSpawns ?? [])
  const hallwayFill = (plan.hallways ?? [])
    .flatMap((hallway) => hallway.cells ?? [])
    .map((cell) => `<rect x="${cell.x + padding}" y="${cell.y + padding}" width="1" height="1" class="hallway-cell" />`)
    .join('')
  const hallwayLabels = labelRooms
    ? (plan.hallways ?? []).map((hallway) =>
      `<text x="${hallway.labelX + padding}" y="${hallway.labelY + padding}" class="hallway-label">${hallway.id}</text>`).join('')
    : ''
  const roomLabels = labelRooms
    ? (plan.rooms ?? []).map((room) =>
      `<text x="${room.labelX + padding}" y="${room.labelY + padding}" class="room-label">${room.id}</text>`).join('')
    : ''
  const walls = plan.walls.map((wall) => svgLine({
    x1: wall.x1 + padding,
    y1: wall.y1 + padding,
    x2: wall.x2 + padding,
    y2: wall.y2 + padding,
  }, 'wall')).join('')
  const openingLines = plan.openings.map((opening) => svgLine({
    x1: opening.x1 + padding,
    y1: opening.y1 + padding,
    x2: opening.x2 + padding,
    y2: opening.y2 + padding,
  }, opening.type === 'door' ? 'door' : 'window')).join('')
  const metadata = encodePlanMetadata({
    seed: Number(plan.meta.seed),
    padding,
    playerStart: { x: playerStart.x, y: playerStart.y },
    npcSpawns: npcSpawns.map((item, index) => ({
      id: item.id ?? `npc-${index + 1}`,
      x: Number(item.x),
      y: Number(item.y),
    })),
    lightSpawns: lightSpawns.map((item, index) => ({
      id: item.id ?? `light-${index + 1}`,
      x: Number(item.x),
      y: Number(item.y),
      height: Number(item.height) || 2.35,
      intensity: Number(item.intensity) || 1.2,
      range: Number(item.range) || 7.5,
      color: typeof item.color === 'string' && item.color.length > 0 ? item.color : '#ffe8b8',
    })),
    rooms: (plan.rooms ?? []).map((room) => ({
      id: room.id,
      cells: Array.isArray(room.cells)
        ? room.cells.map((cell) => ({ x: cell.x, y: cell.y }))
        : [],
    })),
    hallways: plan.hallways ?? [],
    furniture: [],
  })
  const playerStartSvg = `
<g class="player-start-marker" data-plan-x="${playerStart.x}" data-plan-y="${playerStart.y}">
  <circle class="player-start-dot" cx="${playerStart.x + padding}" cy="${playerStart.y + padding}" r="0.35" />
  <line class="player-start-cross" x1="${playerStart.x + padding - 0.28}" y1="${playerStart.y + padding}" x2="${playerStart.x + padding + 0.28}" y2="${playerStart.y + padding}" />
  <line class="player-start-cross" x1="${playerStart.x + padding}" y1="${playerStart.y + padding - 0.28}" x2="${playerStart.x + padding}" y2="${playerStart.y + padding + 0.28}" />
</g>`.trim()
  const npcStartSvg = npcSpawns.map((item, index) => {
    const x = Number(item.x)
    const y = Number(item.y)
    const cx = x + padding
    const cy = y + padding
    return `
<g class="npc-start-marker" data-id="${item.id ?? `npc-${index + 1}`}" data-plan-x="${x}" data-plan-y="${y}">
  <rect class="npc-start-body" x="${cx - 0.22}" y="${cy - 0.5}" width="0.44" height="1.0" rx="0.22" ry="0.22" />
  <circle class="npc-start-head" cx="${cx}" cy="${cy - 0.52}" r="0.18" />
</g>`.trim()
  }).join('')
  const lightStartSvg = lightSpawns.map((item, index) => {
    const x = Number(item.x)
    const y = Number(item.y)
    const cx = x + padding
    const cy = y + padding
    return `
<g class="light-start-marker" data-id="${item.id ?? `light-${index + 1}`}" data-plan-x="${x}" data-plan-y="${y}">
  <circle class="light-start-core" cx="${cx}" cy="${cy}" r="0.2" />
  <circle class="light-start-ring" cx="${cx}" cy="${cy}" r="0.38" />
</g>`.trim()
  }).join('')

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Generated hallway plan">
  <metadata id="occult-floorplan-meta">${metadata}</metadata>
  <style>
    .bg { fill: #0d1218; }
    .hallway-cell { fill: #1a2531; stroke: none; }
    .wall { stroke: #f4f6f8; stroke-width: ${wallStroke}; stroke-linecap: round; }
    .door { stroke: #6de38b; stroke-width: ${Math.max(0.16, wallStroke * 0.75)}; stroke-linecap: round; }
    .window { stroke: #5ab6ff; stroke-width: ${Math.max(0.18, wallStroke * 0.85)}; stroke-linecap: round; }
    .player-start-marker { cursor: grab; }
    .player-start-dot { fill: #ff69b4; stroke: #af2c75; stroke-width: 0.08; }
    .player-start-cross { stroke: #ffffff; stroke-width: 0.08; stroke-linecap: round; }
    .npc-start-marker { cursor: grab; }
    .npc-start-body { fill: #7dc5ff; stroke: #2a6d99; stroke-width: 0.08; }
    .npc-start-head { fill: #a6d9ff; stroke: #2a6d99; stroke-width: 0.08; }
    .npc-start-marker.is-selected .npc-start-body { fill: #ffd76e; stroke: #fff7d1; stroke-width: 0.14; }
    .npc-start-marker.is-selected .npc-start-head { fill: #ffe7a7; stroke: #fff7d1; stroke-width: 0.14; }
    .light-start-marker { cursor: grab; }
    .light-start-core { fill: #ffe8b8; stroke: #8d6f35; stroke-width: 0.08; }
    .light-start-ring { fill: none; stroke: #ffd56b; stroke-width: 0.08; opacity: 0.9; }
    .hallway-label { fill: #6ea7df; font: 0.75px system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
    .room-label { fill: #93a4b8; font: 0.72px system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
  </style>
  <rect class="bg" x="0" y="0" width="${width}" height="${height}" />
  ${hallwayFill}
  ${walls}
  ${openingLines}
  ${playerStartSvg}
  ${npcStartSvg}
  ${lightStartSvg}
  ${hallwayLabels}
  ${roomLabels}
</svg>`.trim()
}
