/**
 * arena-generator — Procedural arena layout inspired by SBPCG ideas
 *
 * Produces a coarse grid with walls and open cells, then connects regions,
 * and places simple strategic points (spawns, flags, collision points, cover).
 * Grid: 1 = wall, 0 = open. Dimensions: cols × rows
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createGrid(cols, rows, fillValue = 0) {
  return Array.from({ length: cols }, () => Array(rows).fill(fillValue))
}

function forNeighbors4(x, z, cols, rows, cb) {
  if (x > 0) cb(x - 1, z)
  if (x < cols - 1) cb(x + 1, z)
  if (z > 0) cb(x, z - 1)
  if (z < rows - 1) cb(x, z + 1)
}

function countWallNeighbors(grid, x, z) {
  const cols = grid.length
  const rows = grid[0].length
  let count = 0
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) {
        count++
      } else if (grid[nx][nz] === 1) {
        count++
      }
    }
  }
  return count
}

function floodFillRegions(grid) {
  const cols = grid.length
  const rows = grid[0].length
  const visited = createGrid(cols, rows, false)
  const regions = []

  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      if (grid[x][z] !== 0 || visited[x][z]) continue
      const queue = [[x, z]]
      const cells = []
      visited[x][z] = true
      while (queue.length) {
        const [cx, cz] = queue.shift()
        cells.push([cx, cz])
        forNeighbors4(cx, cz, cols, rows, (nx, nz) => {
          if (grid[nx][nz] !== 0 || visited[nx][nz]) return
          visited[nx][nz] = true
          queue.push([nx, nz])
        })
      }
      regions.push(cells)
    }
  }
  return regions
}

function regionCenter(cells) {
  const sum = cells.reduce((acc, [x, z]) => {
    acc.x += x
    acc.z += z
    return acc
  }, { x: 0, z: 0 })
  return {
    x: Math.round(sum.x / cells.length),
    z: Math.round(sum.z / cells.length),
  }
}

function carveCell(grid, x, z, width = 1) {
  const cols = grid.length
  const rows = grid[0].length
  const w = Math.max(1, Math.floor(width))
  const halfLow = Math.floor((w - 1) / 2)
  const halfHigh = Math.ceil((w - 1) / 2)
  for (let dx = -halfLow; dx <= halfHigh; dx++) {
    for (let dz = -halfLow; dz <= halfHigh; dz++) {
      const nx = x + dx
      const nz = z + dz
      if (nx <= 0 || nx >= cols - 1 || nz <= 0 || nz >= rows - 1) continue
      grid[nx][nz] = 0
    }
  }
}

function carveCorridor(grid, a, b, width = 1) {
  const horizFirst = Math.random() > 0.5
  let x = a.x
  let z = a.z
  const steps = []
  if (horizFirst) {
    while (x !== b.x) {
      x += x < b.x ? 1 : -1
      steps.push([x, z])
    }
    while (z !== b.z) {
      z += z < b.z ? 1 : -1
      steps.push([x, z])
    }
  } else {
    while (z !== b.z) {
      z += z < b.z ? 1 : -1
      steps.push([x, z])
    }
    while (x !== b.x) {
      x += x < b.x ? 1 : -1
      steps.push([x, z])
    }
  }
  steps.forEach(([sx, sz]) => carveCell(grid, sx, sz, width))
}

function computeDistances(grid, start) {
  const cols = grid.length
  const rows = grid[0].length
  const dist = createGrid(cols, rows, -1)
  const queue = [[start.x, start.z]]
  dist[start.x][start.z] = 0

  while (queue.length) {
    const [x, z] = queue.shift()
    forNeighbors4(x, z, cols, rows, (nx, nz) => {
      if (grid[nx][nz] !== 0 || dist[nx][nz] !== -1) return
      dist[nx][nz] = dist[x][z] + 1
      queue.push([nx, nz])
    })
  }
  return dist
}

function farthestCell(dist) {
  let best = null
  for (let x = 0; x < dist.length; x++) {
    for (let z = 0; z < dist[0].length; z++) {
      if (dist[x][z] < 0) continue
      if (!best || dist[x][z] > best.d) best = { x, z, d: dist[x][z] }
    }
  }
  return best
}

function pickFlagNear(dist, minDist, maxDist, used) {
  const target = (minDist + maxDist) / 2
  let best = null
  for (let x = 0; x < dist.length; x++) {
    for (let z = 0; z < dist[0].length; z++) {
      const d = dist[x][z]
      if (d < minDist || d > maxDist) continue
      const key = `${x},${z}`
      if (used.has(key)) continue
      const score = Math.abs(d - target)
      if (!best || score < best.score) best = { x, z, d, score }
    }
  }
  if (best) return best
  return farthestCell(dist)
}

function pickBalancedFlags(distA, distB, minDist, used, count = 2) {
  const candidates = []
  for (let x = 0; x < distA.length; x++) {
    for (let z = 0; z < distA[0].length; z++) {
      const d1 = distA[x][z]
      const d2 = distB[x][z]
      if (d1 < minDist || d2 < minDist) continue
      if (d1 < 0 || d2 < 0) continue
      const key = `${x},${z}`
      if (used.has(key)) continue
      candidates.push({
        x,
        z,
        diff: Math.abs(d1 - d2),
        spread: Math.max(d1, d2),
      })
    }
  }
  candidates.sort((a, b) => a.diff - b.diff || b.spread - a.spread)
  const picked = []
  for (const cell of candidates) {
    if (picked.length === 0) {
      picked.push(cell)
      used.add(`${cell.x},${cell.z}`)
    } else {
      const farEnough = picked.every(
        (p) => Math.abs(p.x - cell.x) + Math.abs(p.z - cell.z) > minDist / 2
      )
      if (farEnough) {
        picked.push(cell)
        used.add(`${cell.x},${cell.z}`)
      }
    }
    if (picked.length >= count) break
  }
  return picked
}

function findCollisionPoints(grid, maxCount = 2) {
  const cols = grid.length
  const rows = grid[0].length
  const center = { x: (cols - 1) / 2, z: (rows - 1) / 2 }
  const points = []
  for (let x = 1; x < cols - 1; x++) {
    for (let z = 1; z < rows - 1; z++) {
      if (grid[x][z] !== 0) continue
      let openNeighbors = 0
      forNeighbors4(x, z, cols, rows, (nx, nz) => {
        if (grid[nx][nz] === 0) openNeighbors++
      })
      if (openNeighbors < 3) continue
      const distToCenter = Math.abs(x - center.x) + Math.abs(z - center.z)
      points.push({ x, z, openNeighbors, distToCenter })
    }
  }
  points.sort((a, b) => b.openNeighbors - a.openNeighbors || a.distToCenter - b.distToCenter)
  return points.slice(0, maxCount)
}

function placeCoverNear(grid, points, used, maxPerPoint = 2) {
  const covers = []
  for (const point of points) {
    const neighbors = []
    forNeighbors4(point.x, point.z, grid.length, grid[0].length, (nx, nz) => {
      if (grid[nx][nz] !== 0) return
      const key = `${nx},${nz}`
      if (used.has(key)) return
      neighbors.push({ x: nx, z: nz })
    })
    neighbors.sort(() => Math.random() - 0.5)
    neighbors.slice(0, maxPerPoint).forEach((cell) => {
      used.add(`${cell.x},${cell.z}`)
      covers.push(cell)
    })
  }
  return covers
}

function buildCandidate(options) {
  const {
    cols,
    rows,
    density,
    buildingCount,
    buildingMinSize,
    buildingMaxSize,
    smoothingPasses,
    corridorWidth,
  } = options
  const grid = createGrid(cols, rows, 0)

  for (let x = 0; x < cols; x++) {
    grid[x][0] = 1
    grid[x][rows - 1] = 1
  }
  for (let z = 0; z < rows; z++) {
    grid[0][z] = 1
    grid[cols - 1][z] = 1
  }

  const attempts = Math.max(1, buildingCount)
  for (let i = 0; i < attempts; i++) {
    const w = Math.floor(
      Math.random() * (buildingMaxSize - buildingMinSize + 1) + buildingMinSize
    )
    const h = Math.floor(
      Math.random() * (buildingMaxSize - buildingMinSize + 1) + buildingMinSize
    )
    const x0 = Math.floor(Math.random() * (cols - w - 2)) + 1
    const z0 = Math.floor(Math.random() * (rows - h - 2)) + 1
    for (let x = x0; x < x0 + w; x++) {
      for (let z = z0; z < z0 + h; z++) {
        grid[x][z] = 1
      }
    }
  }

  for (let x = 1; x < cols - 1; x++) {
    for (let z = 1; z < rows - 1; z++) {
      if (grid[x][z] === 1) continue
      if (Math.random() < density) grid[x][z] = 1
    }
  }

  for (let pass = 0; pass < smoothingPasses; pass++) {
    const next = createGrid(cols, rows, 0)
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) {
        if (x === 0 || z === 0 || x === cols - 1 || z === rows - 1) {
          next[x][z] = 1
          continue
        }
        const wallNeighbors = countWallNeighbors(grid, x, z)
        if (wallNeighbors >= 5) next[x][z] = 1
        else if (wallNeighbors <= 2) next[x][z] = 0
        else next[x][z] = grid[x][z]
      }
    }
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) grid[x][z] = next[x][z]
    }
  }

  const exitWidth = Math.max(1, corridorWidth)
  const exitOffset = Math.floor(exitWidth / 2)
  const useHorizontal = Math.random() > 0.5
  if (useHorizontal) {
    const minX = 1
    const maxX = cols - 2
    const minSeparation = Math.max(1, exitOffset + 1)
    const topX = Math.floor(Math.random() * (maxX - minX + 1)) + minX
    let bottomX = Math.floor(Math.random() * (maxX - minX + 1)) + minX
    let safety = 0
    while (Math.abs(bottomX - topX) < minSeparation && safety < 20) {
      bottomX = Math.floor(Math.random() * (maxX - minX + 1)) + minX
      safety++
    }
    for (let i = -exitOffset; i <= exitOffset; i++) {
      const xTop = clamp(topX + i, minX, maxX)
      const xBottom = clamp(bottomX + i, minX, maxX)
      grid[xTop][0] = 0
      grid[xTop][1] = 0
      grid[xBottom][rows - 1] = 0
      grid[xBottom][rows - 2] = 0
    }
  } else {
    const minZ = 1
    const maxZ = rows - 2
    const minSeparation = Math.max(1, exitOffset + 1)
    const leftZ = Math.floor(Math.random() * (maxZ - minZ + 1)) + minZ
    let rightZ = Math.floor(Math.random() * (maxZ - minZ + 1)) + minZ
    let safety = 0
    while (Math.abs(rightZ - leftZ) < minSeparation && safety < 20) {
      rightZ = Math.floor(Math.random() * (maxZ - minZ + 1)) + minZ
      safety++
    }
    for (let i = -exitOffset; i <= exitOffset; i++) {
      const zLeft = clamp(leftZ + i, minZ, maxZ)
      const zRight = clamp(rightZ + i, minZ, maxZ)
      grid[0][zLeft] = 0
      grid[1][zLeft] = 0
      grid[cols - 1][zRight] = 0
      grid[cols - 2][zRight] = 0
    }
  }

  // Ensure at least one open pocket
  const cx = Math.floor(cols / 2)
  const cz = Math.floor(rows / 2)
  carveCell(grid, cx, cz, 1)

  let regions = floodFillRegions(grid)
  if (regions.length === 0) {
    grid[cx][cz] = 0
    regions = floodFillRegions(grid)
  }

  if (regions.length > 1) {
    const centers = regions.map(regionCenter)
    const edges = []
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dx = centers[i].x - centers[j].x
        const dz = centers[i].z - centers[j].z
        edges.push({ i, j, d: dx * dx + dz * dz })
      }
    }
    edges.sort((a, b) => a.d - b.d)
    const parent = centers.map((_, i) => i)
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    const unite = (a, b) => {
      const pa = find(a)
      const pb = find(b)
      if (pa === pb) return false
      parent[pa] = pb
      return true
    }
    for (const edge of edges) {
      if (unite(edge.i, edge.j)) {
        carveCorridor(grid, centers[edge.i], centers[edge.j], corridorWidth)
      }
    }
  }

  regions = floodFillRegions(grid)
  const openCells = []
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      if (grid[x][z] === 0) openCells.push({ x, z })
    }
  }

  const seed = openCells[Math.floor(Math.random() * openCells.length)] ?? { x: cx, z: cz }
  const distSeed = computeDistances(grid, seed)
  const spawnA = farthestCell(distSeed) ?? seed
  const distA = computeDistances(grid, spawnA)
  const spawnB = farthestCell(distA) ?? seed
  const distB = computeDistances(grid, spawnB)

  const used = new Set([`${spawnA.x},${spawnA.z}`, `${spawnB.x},${spawnB.z}`])
  const minFlag = Math.max(3, Math.floor(Math.min(cols, rows) * 0.15))
  const maxFlag = Math.max(minFlag + 2, Math.floor(Math.min(cols, rows) * 0.35))
  const teamFlagA = pickFlagNear(distA, minFlag, maxFlag, used)
  if (teamFlagA) used.add(`${teamFlagA.x},${teamFlagA.z}`)
  const teamFlagB = pickFlagNear(distB, minFlag, maxFlag, used)
  if (teamFlagB) used.add(`${teamFlagB.x},${teamFlagB.z}`)
  const neutralFlags = pickBalancedFlags(distA, distB, minFlag + 2, used, 2)

  const collisionPoints = findCollisionPoints(grid, 2)
  collisionPoints.forEach((p) => used.add(`${p.x},${p.z}`))
  const covers = placeCoverNear(grid, collisionPoints, used, 2)

  const flags = []
  if (teamFlagA) flags.push({ ...teamFlagA, type: 'team-a' })
  if (teamFlagB) flags.push({ ...teamFlagB, type: 'team-b' })
  neutralFlags.forEach((f) => flags.push({ ...f, type: 'neutral' }))

  const metrics = {
    regions: regions.length,
    collisionCount: collisionPoints.length,
    flagFairness: teamFlagA && teamFlagB ? Math.abs(distA[teamFlagA.x][teamFlagA.z] - distB[teamFlagB.x][teamFlagB.z]) : 999,
    overallFairness: neutralFlags.reduce((acc, f) => acc + Math.abs(distA[f.x][f.z] - distB[f.x][f.z]), 0),
  }

  return {
    grid,
    spawns: [spawnA, spawnB],
    flags,
    collisionPoints,
    covers,
    metrics,
  }
}

function fitnessScore(metrics) {
  const connectivity = metrics.regions === 1 ? 1 : 0
  const collision = metrics.collisionCount >= 1 && metrics.collisionCount <= 2 ? 1 : 0
  const fairness = metrics.flagFairness === 0 ? 1 : 1 / (1 + metrics.flagFairness)
  const overall = metrics.overallFairness === 0 ? 1 : 1 / (1 + metrics.overallFairness)
  return connectivity + collision + fairness + overall
}

/**
 * Generate an arena grid with SBPCG-inspired scoring.
 * @param {object} options
 * @param {number} [options.cols=24]
 * @param {number} [options.rows=24]
 * @param {number} [options.density=0.28] - random wall density 0-0.6
 * @param {number} [options.buildingCount=8]
 * @param {number} [options.buildingMinSize=2]
 * @param {number} [options.buildingMaxSize=6]
 * @param {number} [options.smoothingPasses=2]
 * @param {number} [options.corridorWidth=1]
 * @param {number} [options.candidates=8]
 * @returns {{ grid:number[][], spawns:Array, flags:Array, collisionPoints:Array, covers:Array }}
 */
export function generateArena(options = {}) {
  const {
    cols = 24,
    rows = 24,
    density = 0.28,
    buildingCount = 8,
    buildingMinSize = 2,
    buildingMaxSize = 6,
    smoothingPasses = 2,
    corridorWidth = 1,
    candidates = 8,
  } = options

  const safe = {
    cols: clamp(cols, 8, 64),
    rows: clamp(rows, 8, 64),
    density: clamp(density, 0, 0.6),
    buildingCount: clamp(buildingCount, 0, 40),
    buildingMinSize: clamp(buildingMinSize, 1, 10),
    buildingMaxSize: clamp(buildingMaxSize, 2, 16),
    smoothingPasses: clamp(smoothingPasses, 0, 6),
    corridorWidth: clamp(corridorWidth, 1, 4),
  }
  safe.buildingMaxSize = Math.max(safe.buildingMaxSize, safe.buildingMinSize)

  let best = null
  const runs = clamp(candidates, 1, 20)
  for (let i = 0; i < runs; i++) {
    const candidate = buildCandidate(safe)
    const score = fitnessScore(candidate.metrics)
    if (!best || score > best.score) {
      best = { ...candidate, score }
    }
  }

  return {
    grid: best.grid,
    spawns: best.spawns,
    flags: best.flags,
    collisionPoints: best.collisionPoints,
    covers: best.covers,
  }
}
