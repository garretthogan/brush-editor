/**
 * maze-generator — Produces a logical grid matrix from control parameters
 *
 * Standalone module with no dependencies. Uses recursive backtracker (DFS).
 * Grid: 1 = wall, 0 = passage. Dimensions: (cols*2+1) × (rows*2+1)
 *
 * Usage:
 *   import { generateMaze } from './lib/maze-generator.js'
 *   const { grid, cols, rows } = generateMaze({ cols: 10, rows: 10, ... })
 */

/**
 * Generate a maze grid matrix.
 * @param {object} options
 * @param {number} [options.cols=10] - Number of cell columns
 * @param {number} [options.rows=10] - Number of cell rows
 * @param {number} options.exitWidth - Width of exit in cells (1–9)
 * @param {number} options.centerRoomSize - Center room size (1–6)
 * @param {string} options.layout - 'center-out' | 'out-out'
 * @returns {{ grid: number[][], cols: number, rows: number }}
 */
export function generateMaze(options = {}) {
  const {
    cols = 10,
    rows = 10,
    exitWidth = 1,
    centerRoomSize = 1,
    layout = 'center-out',
  } = options

  const centerStart = layout === 'center-out'
  const w = cols * 2 + 1
  const h = rows * 2 + 1

  const grid = Array(w)
    .fill(null)
    .map(() => Array(h).fill(1))

  const cx = Math.floor(w / 2) | 1
  const cz = Math.floor(h / 2) | 1
  const r = centerStart ? Math.min(centerRoomSize - 1, 3) : 0
  const roomLeft = cx - 2 * r - 1
  const roomRight = cx + 2 * r + 1
  const roomBottom = cz - 2 * r - 1
  const roomTop = cz + 2 * r + 1
  const roomDoorX = cx + 2 * r + 1
  const roomDoorZ = cz

  const roomLeftDoorZ = cz
  function isRoomBoundaryWall(wx, wz) {
    if (!centerStart || r === 0) return false
    if (wx === roomDoorX && wz === roomDoorZ) return false
    if (wx === roomLeft && wz === roomLeftDoorZ) return false
    if (wx === roomLeft && wz >= cz - 2 * r && wz <= cz + 2 * r) return true
    if (wx === roomRight && wz >= cz - 2 * r && wz <= cz + 2 * r) return true
    if (wz === roomBottom && wx >= cx - 2 * r && wx <= cx + 2 * r) return true
    if (wz === roomTop && wx >= cx - 2 * r && wx <= cx + 2 * r) return true
    return false
  }

  function carve(x, z) {
    grid[x][z] = 0
    const dirs = [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    ]
    dirs.sort(() => Math.random() - 0.5)
    for (const [dx, dz] of dirs) {
      const nx = x + dx
      const nz = z + dz
      if (nx > 0 && nx < w - 1 && nz > 0 && nz < h - 1 && grid[nx][nz] === 1) {
        const wx = (x + nx) / 2
        const wz = (z + nz) / 2
        if (isRoomBoundaryWall(wx, wz)) continue
        grid[wx][wz] = 0
        carve(nx, nz)
      }
    }
  }

  if (centerStart) {
    for (let dx = -2 * r; dx <= 2 * r; dx += 2) {
      for (let dz = -2 * r; dz <= 2 * r; dz += 2) {
        const nx = cx + dx
        const nz = cz + dz
        if (nx >= 1 && nx <= w - 2 && nz >= 1 && nz <= h - 2) {
          grid[nx][nz] = 0
          if (nx <= cx + 2 * r - 2) grid[nx + 1][nz] = 0
          if (nx >= cx - 2 * r + 2) grid[nx - 1][nz] = 0
          if (nz <= cz + 2 * r - 2) grid[nx][nz + 1] = 0
          if (nz >= cz - 2 * r + 2) grid[nx][nz - 1] = 0
        }
      }
    }
    const edge = Math.min(2 * r + 2, w - 2 - cx, cx - 1, h - 2 - cz, cz - 1)
    grid[roomDoorX][roomDoorZ] = 0
    grid[roomLeft][roomLeftDoorZ] = 0
    carve(cx - edge, cz)
    carve(cx + edge, cz)
  } else {
    carve(1, 1)
  }

  if (centerStart) {
    const edges = [
      { horiz: true, a: 0 },
      { horiz: true, a: h - 1 },
      { horiz: false, a: 0 },
      { horiz: false, a: w - 1 },
    ]
    const edge = edges[Math.floor(Math.random() * edges.length)]
    for (let i = 0; i < exitWidth; i++) {
      const offset = 2 * (i - Math.floor(exitWidth / 2))
      if (edge.horiz) {
        const ex = cx + offset
        if (ex >= 1 && ex <= w - 2) grid[ex][edge.a] = 0
      } else {
        const ez = cz + offset
        if (ez >= 1 && ez <= h - 2) grid[edge.a][ez] = 0
      }
    }
  } else {
    const pairs = [
      { horiz: true, a: 0, b: h - 1 },
      { horiz: false, a: 0, b: w - 1 },
    ]
    const pair = pairs[Math.floor(Math.random() * pairs.length)]
    for (let i = 0; i < exitWidth; i++) {
      const offset = 2 * (i - Math.floor(exitWidth / 2))
      if (pair.horiz) {
        const ex = cx + offset
        if (ex >= 1 && ex <= w - 2) {
          grid[ex][pair.a] = 0
          grid[ex][pair.b] = 0
        }
      } else {
        const ez = cz + offset
        if (ez >= 1 && ez <= h - 2) {
          grid[pair.a][ez] = 0
          grid[pair.b][ez] = 0
        }
      }
    }
  }

  return { grid, cols, rows }
}
