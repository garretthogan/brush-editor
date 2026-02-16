/**
 * Hallway-first floor plan generator.
 * Produces one procedural hallway (L/U/S/T) with attached rooms through hallway doors.
 */

const DEFAULT_OPTIONS = {
  width: 36,
  height: 24,
  hallwayCount: 1,
  doorCount: 6,
  maxLightCount: 10,
  roomShapeStyle: 45,
  doorWidth: 1.2,
  windowWidth: 1.6,
  maxWindowCount: 8,
  wallStroke: 0.28,
  minCorridorWidthCells: 3,
  maxCorridorWidthCells: 9,
  seed: Date.now(),
};

const GRID_CELL_SIZE = 1;
const HALLWAY_MARKER = '__hallway__';

function createRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function randomInt(rng, minInclusive, maxInclusive) {
  return Math.floor(rng() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function randomChoice(rng, values) {
  return values[randomInt(rng, 0, values.length - 1)];
}

function randomIntWithGap(rng, minInclusive, maxInclusive, target, minGap = 1) {
  const min = Math.min(minInclusive, maxInclusive);
  const max = Math.max(minInclusive, maxInclusive);
  if (!Number.isFinite(target) || max - min < minGap) {
    return randomInt(rng, min, max);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomInt(rng, min, max);
    if (Math.abs(candidate - target) >= minGap) return candidate;
  }
  const low = target - minGap;
  const high = target + minGap;
  if (low >= min && low <= max) return low;
  if (high >= min && high <= max) return high;
  return randomInt(rng, min, max);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toOddInteger(value) {
  const rounded = Math.max(1, Math.round(value));
  return rounded % 2 === 0 ? rounded + 1 : rounded;
}

function deriveLayoutScale(options, bounds) {
  const area = Math.max(1, bounds.cols * bounds.rows);
  const hallways = Math.max(1, Number(options.hallwayCount) || 1);
  const rooms = Math.max(1, Number(options.doorCount) || 1);
  const sparsity = area / (hallways * rooms);
  return clampNumber(sparsity / 60, 1.15, 4.2);
}

function deriveCorridorWidthCells(options, bounds, rng) {
  const minWidth = toOddInteger(
    clampNumber(
      Number(options.minCorridorWidthCells) || DEFAULT_OPTIONS.minCorridorWidthCells,
      3,
      25
    )
  );
  const maxWidth = toOddInteger(
    clampNumber(
      Number(options.maxCorridorWidthCells) || DEFAULT_OPTIONS.maxCorridorWidthCells,
      3,
      25
    )
  );
  const low = Math.min(minWidth, maxWidth);
  const high = Math.max(minWidth, maxWidth);
  if (low === high) return low;

  // Bias corridor width a bit larger on bigger maps while keeping randomness.
  const area = Math.max(1, bounds.cols * bounds.rows);
  const mapSizeBias = clampNumber((Math.sqrt(area) - 16) / 24, 0, 1);
  const blend = rng() * 0.65 + mapSizeBias * 0.35;
  const sampled = Math.round(low + (high - low) * blend);
  return toOddInteger(clampNumber(sampled, low, high));
}

function normalizeEdge(x1, y1, x2, y2) {
  if (x1 < x2 || (x1 === x2 && y1 <= y2)) {
    return { x1, y1, x2, y2 };
  }
  return { x1: x2, y1: y2, x2: x1, y2: y1 };
}

function edgeKey(edge) {
  return `${edge.x1},${edge.y1}|${edge.x2},${edge.y2}`;
}

function edgeLength(edge) {
  return Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
}

function collectPolylinePath(points) {
  if (points.length === 0) return [];
  const cells = [{ x: points[0].x, y: points[0].y }];
  for (let index = 1; index < points.length; index++) {
    const next = points[index];
    let currentX = cells[cells.length - 1].x;
    let currentY = cells[cells.length - 1].y;
    while (currentX !== next.x) {
      currentX += next.x > currentX ? 1 : -1;
      cells.push({ x: currentX, y: currentY });
    }
    while (currentY !== next.y) {
      currentY += next.y > currentY ? 1 : -1;
      cells.push({ x: currentX, y: currentY });
    }
  }
  return cells;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function parseCellKey(key) {
  const [xRaw, yRaw] = key.split(',');
  return { x: Number(xRaw), y: Number(yRaw) };
}

function createLightSpawnsFromPlanCells(rooms, hallways, maxLightCount, rng) {
  const requested = Math.max(0, Math.round(Number(maxLightCount) || 0));
  if (requested === 0) return [];

  const roomCells = (rooms ?? []).flatMap((room) => room.cells ?? []);
  const hallwayCells = (hallways ?? []).flatMap((hallway) => hallway.cells ?? []);
  const uniqueCells = new Map();
  for (const cell of [...roomCells, ...hallwayCells]) {
    const x = Number(cell?.x);
    const y = Number(cell?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    uniqueCells.set(`${x},${y}`, { x, y });
  }
  const candidates = [...uniqueCells.values()];
  if (candidates.length === 0) return [];

  const targetCount = Math.min(requested, candidates.length);
  const picked = [];
  const remaining = [...candidates];
  const firstIndex = randomInt(rng, 0, remaining.length - 1);
  picked.push(remaining.splice(firstIndex, 1)[0]);
  while (picked.length < targetCount && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistanceSq = -1;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      let nearestDistanceSq = Infinity;
      for (const selected of picked) {
        const dx = candidate.x - selected.x;
        const dy = candidate.y - selected.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) nearestDistanceSq = distanceSq;
      }
      if (nearestDistanceSq > bestDistanceSq) {
        bestDistanceSq = nearestDistanceSq;
        bestIndex = index;
      }
    }
    picked.push(remaining.splice(bestIndex, 1)[0]);
  }

  return picked.map((cell, index) => ({
    id: `light-${index + 1}`,
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    height: 2.35,
    intensity: 1.2,
    range: 7.5,
    color: '#ffe8b8',
  }));
}

function stampHallwayCell(hallwayCells, bounds, x, y, brushRadius) {
  for (let dy = -brushRadius; dy <= brushRadius; dy++) {
    for (let dx = -brushRadius; dx <= brushRadius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= bounds.cols || ny < 0 || ny >= bounds.rows) continue;
      hallwayCells.add(cellKey(nx, ny));
    }
  }
}

function makeCenterlinePoints(shape, bounds, rng, brushRadius = 0) {
  const margin = Math.max(3, brushRadius + 2);
  const minX = margin;
  const maxX = Math.max(minX + 1, bounds.cols - margin - 1);
  const minY = margin;
  const maxY = Math.max(minY + 1, bounds.rows - margin - 1);
  const minSpan = Math.min(4, Math.max(1, Math.floor((Math.min(maxX - minX, maxY - minY)) / 2)));

  if (shape === 'U') {
    const leftX = randomInt(rng, minX, maxX);
    const rightX = randomIntWithGap(rng, minX, maxX, leftX, minSpan);
    const topY = randomInt(rng, minY, maxY);
    const bottomY = randomIntWithGap(rng, minY, maxY, topY, minSpan);
    const minUX = Math.min(leftX, rightX);
    const maxUX = Math.max(leftX, rightX);
    const minUY = Math.min(topY, bottomY);
    const maxUY = Math.max(topY, bottomY);
    return [
      { x: minUX, y: minUY },
      { x: minUX, y: maxUY },
      { x: maxUX, y: maxUY },
      { x: maxUX, y: minUY },
    ];
  }
  if (shape === 'T') {
    const stemX = randomInt(rng, minX, maxX);
    const topY = randomInt(rng, minY, maxY);
    const bottomY = randomIntWithGap(rng, minY, maxY, topY, minSpan);
    const leftX = randomInt(rng, minX, maxX);
    const rightX = randomIntWithGap(rng, minX, maxX, leftX, minSpan);
    const minTY = Math.min(topY, bottomY);
    const maxTY = Math.max(topY, bottomY);
    const minTX = Math.min(leftX, rightX);
    const maxTX = Math.max(leftX, rightX);
    const branchY = randomInt(rng, minTY, maxTY);
    const branchX = clampNumber(stemX, minTX, maxTX);
    return [
      // Retrace through the branch intersection to avoid accidental zig-zag variants.
      { x: branchX, y: minTY },
      { x: branchX, y: branchY },
      { x: minTX, y: branchY },
      { x: branchX, y: branchY },
      { x: maxTX, y: branchY },
      { x: branchX, y: branchY },
      { x: branchX, y: maxTY },
    ];
  }
  if (shape === 'S') {
    const xA = randomInt(rng, minX, maxX);
    const xB = randomIntWithGap(rng, minX, maxX, xA, minSpan);
    const xC = randomIntWithGap(rng, minX, maxX, xB, minSpan);
    const yA = randomInt(rng, minY, maxY);
    const yC = randomIntWithGap(rng, minY, maxY, yA, minSpan);
    const yB = randomIntWithGap(rng, minY, maxY, yC, Math.max(1, minSpan - 1));
    const start = { x: xA, y: yA };
    const bendA = { x: xB, y: yA };
    const bendB = { x: xB, y: yC };
    const bendC = { x: xC, y: yC };
    const end = { x: xC, y: yB };
    return [start, bendA, bendB, bendC, end];
  }
  const xA = randomInt(rng, minX, maxX);
  const xB = randomIntWithGap(rng, minX, maxX, xA, minSpan);
  const yA = randomInt(rng, minY, maxY);
  const yB = randomIntWithGap(rng, minY, maxY, yA, minSpan);
  const elbow = { x: xB, y: yA };
  return [
    { x: xA, y: yA },
    elbow,
    { x: xB, y: yB },
  ];
}

function generateHallwayCells(bounds, shape, corridorWidthCells, rng) {
  const hallwayCells = new Set();
  const brushRadius = Math.max(0, Math.floor((corridorWidthCells - 1) / 2));
  const centerline = makeCenterlinePoints(shape, bounds, rng, brushRadius);
  const pathCells = collectPolylinePath(centerline);
  for (const cell of pathCells) {
    stampHallwayCell(hallwayCells, bounds, cell.x, cell.y, brushRadius);
  }
  return hallwayCells;
}

function buildHallwayGroups(bounds, hallwayCount, corridorWidthCells, rng) {
  const combined = new Set();
  const groups = [];
  const maxAttemptsPerHallway = 12;
  const minUniqueCellsPerHallway = 10;
  const shapes = ['L', 'U', 'S', 'T'];

  for (let index = 0; index < hallwayCount; index++) {
    let placed = false;
    for (let attempt = 0; attempt < maxAttemptsPerHallway; attempt++) {
      const shape = randomChoice(rng, shapes);
      const candidate = generateHallwayCells(bounds, shape, corridorWidthCells, rng);
      if (candidate.size < minUniqueCellsPerHallway) {
        continue;
      }

      for (const key of candidate) {
        combined.add(key);
      }
      groups.push({
        id: `hall-${groups.length + 1}`,
        shape,
        cells: [...candidate].map(parseCellKey),
      });
      placed = true;
      break;
    }

    if (!placed && groups.length === 0) {
      const fallbackShape = randomChoice(rng, shapes);
      const fallback = generateHallwayCells(bounds, fallbackShape, corridorWidthCells, rng);
      for (const key of fallback) {
        combined.add(key);
      }
      groups.push({
        id: 'hall-1',
        shape: fallbackShape,
        cells: [...fallback].map(parseCellKey),
      });
    }
  }

  return { hallwayCells: combined, hallwayGroups: groups };
}

function buildHallwayGrid(bounds, hallwayCells) {
  const grid = Array.from({ length: bounds.rows }, () => Array(bounds.cols).fill(null));
  for (const key of hallwayCells) {
    const [xRaw, yRaw] = key.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (x >= 0 && x < bounds.cols && y >= 0 && y < bounds.rows) {
      grid[y][x] = HALLWAY_MARKER;
    }
  }
  return grid;
}

function buildHallwayOwnershipGrid(bounds, hallwayGroups) {
  const grid = Array.from({ length: bounds.rows }, () => Array(bounds.cols).fill(null));
  for (const group of hallwayGroups) {
    for (const cell of group.cells ?? []) {
      if (
        cell.x >= 0 &&
        cell.x < bounds.cols &&
        cell.y >= 0 &&
        cell.y < bounds.rows
      ) {
        grid[cell.y][cell.x] = group.id;
      }
    }
  }
  return grid;
}

function mergeCollinearWalls(rawWalls) {
  const buckets = new Map();
  for (const wall of rawWalls) {
    const isHorizontal = wall.edge.y1 === wall.edge.y2;
    const axis = isHorizontal ? 'h' : 'v';
    const coord = isHorizontal ? wall.edge.y1 : wall.edge.x1;
    const start = isHorizontal ? wall.edge.x1 : wall.edge.y1;
    const end = isHorizontal ? wall.edge.x2 : wall.edge.y2;
    const key = `${axis}|${coord}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push({ start: Math.min(start, end), end: Math.max(start, end), axis, coord });
  }

  const merged = [];
  for (const list of buckets.values()) {
    list.sort((left, right) => left.start - right.start);
    let current = null;
    for (const item of list) {
      if (current == null) {
        current = { ...item };
        continue;
      }
      if (item.start <= current.end + 1e-6) {
        current.end = Math.max(current.end, item.end);
      } else {
        merged.push(current);
        current = { ...item };
      }
    }
    if (current != null) {
      merged.push(current);
    }
  }

  return merged.map((entry) => ({
    edge: entry.axis === 'h'
      ? normalizeEdge(entry.start, entry.coord, entry.end, entry.coord)
      : normalizeEdge(entry.coord, entry.start, entry.coord, entry.end),
  }));
}

function buildHallwayWalls(bounds, hallwayCells) {
  const hallwayGrid = buildHallwayGrid(bounds, hallwayCells);
  const rawWalls = [];
  const addEdge = (x1, y1, x2, y2) => {
    rawWalls.push({ edge: normalizeEdge(x1, y1, x2, y2) });
  };

  for (let y = 0; y < bounds.rows; y++) {
    for (let x = 0; x < bounds.cols; x++) {
      if (hallwayGrid[y][x] !== HALLWAY_MARKER) continue;

      const north = y > 0 ? hallwayGrid[y - 1][x] : null;
      const south = y + 1 < bounds.rows ? hallwayGrid[y + 1][x] : null;
      const west = x > 0 ? hallwayGrid[y][x - 1] : null;
      const east = x + 1 < bounds.cols ? hallwayGrid[y][x + 1] : null;

      if (north !== HALLWAY_MARKER) addEdge(x, y, x + 1, y);
      if (south !== HALLWAY_MARKER) addEdge(x, y + 1, x + 1, y + 1);
      if (west !== HALLWAY_MARKER) addEdge(x, y, x, y + 1);
      if (east !== HALLWAY_MARKER) addEdge(x + 1, y, x + 1, y + 1);
    }
  }

  return mergeCollinearWalls(rawWalls);
}

function getHallwayIdForWall(edge, hallwayGrid, hallwayOwnershipGrid) {
  if (edge.y1 === edge.y2) {
    const y = edge.y1;
    const sampleX = Math.max(0, Math.floor((edge.x1 + edge.x2) / 2));
    const hallwayAbove = y - 1 >= 0 && hallwayGrid[y - 1]?.[sampleX] === HALLWAY_MARKER;
    const hallwayBelow = y < hallwayGrid.length && hallwayGrid[y]?.[sampleX] === HALLWAY_MARKER;
    if (hallwayBelow && !hallwayAbove) {
      return hallwayOwnershipGrid[y]?.[sampleX] ?? null;
    }
    if (hallwayAbove && !hallwayBelow) {
      return hallwayOwnershipGrid[y - 1]?.[sampleX] ?? null;
    }
    return null;
  }
  const x = edge.x1;
  const sampleY = Math.max(0, Math.floor((edge.y1 + edge.y2) / 2));
  const hallwayLeft = x - 1 >= 0 && hallwayGrid[sampleY]?.[x - 1] === HALLWAY_MARKER;
  const hallwayRight = x < hallwayGrid[0].length && hallwayGrid[sampleY]?.[x] === HALLWAY_MARKER;
  if (hallwayRight && !hallwayLeft) {
    return hallwayOwnershipGrid[sampleY]?.[x] ?? null;
  }
  if (hallwayLeft && !hallwayRight) {
    return hallwayOwnershipGrid[sampleY]?.[x - 1] ?? null;
  }
  return null;
}

function classifyHallwayWallSide(edge, hallwayGrid) {
  if (edge.y1 === edge.y2) {
    const y = edge.y1;
    const sampleX = Math.max(0, Math.floor((edge.x1 + edge.x2) / 2));
    const hallwayAbove = y - 1 >= 0 && hallwayGrid[y - 1]?.[sampleX] === HALLWAY_MARKER;
    const hallwayBelow = y < hallwayGrid.length && hallwayGrid[y]?.[sampleX] === HALLWAY_MARKER;
    if (hallwayBelow && !hallwayAbove) return 'north';
    if (hallwayAbove && !hallwayBelow) return 'south';
    return null;
  }
  const x = edge.x1;
  const sampleY = Math.max(0, Math.floor((edge.y1 + edge.y2) / 2));
  const hallwayLeft = x - 1 >= 0 && hallwayGrid[sampleY]?.[x - 1] === HALLWAY_MARKER;
  const hallwayRight = x < hallwayGrid[0].length && hallwayGrid[sampleY]?.[x] === HALLWAY_MARKER;
  if (hallwayRight && !hallwayLeft) return 'west';
  if (hallwayLeft && !hallwayRight) return 'east';
  return null;
}

function roomCellsOverlap(occupiedCells, roomRect) {
  for (let y = roomRect.y; y < roomRect.y + roomRect.height; y++) {
    for (let x = roomRect.x; x < roomRect.x + roomRect.width; x++) {
      if (occupiedCells.has(cellKey(x, y))) return true;
    }
  }
  return false;
}

function addRoomCellsToOccupied(occupiedCells, roomRect) {
  for (let y = roomRect.y; y < roomRect.y + roomRect.height; y++) {
    for (let x = roomRect.x; x < roomRect.x + roomRect.width; x++) {
      occupiedCells.add(cellKey(x, y));
    }
  }
}

function buildRoomFromDoor(doorOpening, hallwayWall, hallwaySide, bounds, rng, roomSizeScale = 1) {
  const mode = doorOpening.roomSizeMode ?? 'normal';
  const compactMode = mode === 'compact';
  const largeMode = mode === 'large';
  const wallLengthCells = Math.max(1, Math.floor(edgeLength(hallwayWall.edge)));
  const scaledRoomSize = largeMode
    ? roomSizeScale * 1.55
    : compactMode
      ? Math.max(1, roomSizeScale * 0.75)
      : roomSizeScale * 1.3;
  const minFrontage = compactMode
    ? Math.max(4, Math.round((Math.ceil(doorOpening.end - doorOpening.start) + 2) * scaledRoomSize))
    : Math.max(6, Math.round((Math.ceil(doorOpening.end - doorOpening.start) + 5) * scaledRoomSize));
  const maxFrontage = compactMode
    ? Math.max(minFrontage, Math.min(Math.round(12 * scaledRoomSize), wallLengthCells))
    : Math.max(minFrontage, Math.min(Math.round(30 * scaledRoomSize), wallLengthCells));
  if (maxFrontage < minFrontage) {
    return null;
  }

  const frontage = randomInt(rng, minFrontage, maxFrontage);
  const maxDepthByBounds = Math.max(10, Math.floor(Math.min(bounds.cols, bounds.rows) * 0.8));
  const minDepth = compactMode ? 5 : Math.max(9, Math.round(8 * scaledRoomSize));
  const maxDepth = compactMode
    ? Math.min(Math.round(12 * scaledRoomSize), maxDepthByBounds)
    : Math.min(Math.round(30 * scaledRoomSize), maxDepthByBounds);
  if (maxDepth < minDepth) {
    return null;
  }
  const depth = randomInt(rng, minDepth, maxDepth);
  const doorCenter = (doorOpening.start + doorOpening.end) / 2;

  if (hallwayWall.edge.y1 === hallwayWall.edge.y2) {
    const wallY = hallwayWall.edge.y1;
    const doorCenterX = hallwayWall.edge.x1 + doorCenter;
    const wallMin = Math.min(hallwayWall.edge.x1, hallwayWall.edge.x2);
    const wallMax = Math.max(hallwayWall.edge.x1, hallwayWall.edge.x2);
    const x = Math.round(doorCenterX - frontage / 2);
    const minX = Math.max(0, wallMin);
    const maxX = Math.min(bounds.cols - frontage, wallMax - frontage);
    if (maxX < minX) return null;
    const clampedX = clampNumber(x, minX, maxX);
    if (hallwaySide === 'north') {
      const y = wallY - depth;
      if (y < 0) return null;
      return { x: clampedX, y, width: frontage, height: depth, side: 'north' };
    }
    const y = wallY;
    if (y + depth > bounds.rows) return null;
    return { x: clampedX, y, width: frontage, height: depth, side: 'south' };
  }

  const wallX = hallwayWall.edge.x1;
  const doorCenterY = hallwayWall.edge.y1 + doorCenter;
  const wallMin = Math.min(hallwayWall.edge.y1, hallwayWall.edge.y2);
  const wallMax = Math.max(hallwayWall.edge.y1, hallwayWall.edge.y2);
  const y = Math.round(doorCenterY - frontage / 2);
  const minY = Math.max(0, wallMin);
  const maxY = Math.min(bounds.rows - frontage, wallMax - frontage);
  if (maxY < minY) return null;
  const clampedY = clampNumber(y, minY, maxY);
  if (hallwaySide === 'west') {
    const x = wallX - depth;
    if (x < 0) return null;
    return { x, y: clampedY, width: depth, height: frontage, side: 'west' };
  }
  const x = wallX;
  if (x + depth > bounds.cols) return null;
  return { x, y: clampedY, width: depth, height: frontage, side: 'east' };
}

function createRoomCellKeySet(roomRect) {
  const cells = new Set();
  for (let y = roomRect.y; y < roomRect.y + roomRect.height; y++) {
    for (let x = roomRect.x; x < roomRect.x + roomRect.width; x++) {
      cells.add(cellKey(x, y));
    }
  }
  return cells;
}

function buildRoomDataFromCells(roomId, roomCells) {
  const cells = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const key of roomCells) {
    const { x, y } = parseCellKey(key);
    cells.push({ x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x + 0.5;
    sumY += y + 0.5;
  }
  const count = Math.max(1, cells.length);
  return {
    id: roomId,
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cells,
    labelX: sumX / count,
    labelY: sumY / count,
  };
}

function mergeCollinearWallsWithRoomId(rawWalls) {
  const byRoom = new Map();
  for (const wall of rawWalls) {
    if (!byRoom.has(wall.roomId)) {
      byRoom.set(wall.roomId, []);
    }
    byRoom.get(wall.roomId).push({ edge: wall.edge });
  }
  const merged = [];
  for (const [roomId, walls] of byRoom.entries()) {
    const roomWalls = mergeCollinearWalls(walls).map((wall) => ({ edge: wall.edge, roomId }));
    merged.push(...roomWalls);
  }
  return merged;
}

function buildRoomPerimeterWallsFromCells(roomRecords, hallwayCells) {
  const rawWalls = [];
  for (const room of roomRecords) {
    for (const key of room.cells) {
      const { x, y } = parseCellKey(key);
      const northKey = cellKey(x, y - 1);
      const southKey = cellKey(x, y + 1);
      const westKey = cellKey(x - 1, y);
      const eastKey = cellKey(x + 1, y);

      if (!room.cells.has(northKey) && !hallwayCells.has(northKey)) {
        rawWalls.push({ edge: normalizeEdge(x, y, x + 1, y), roomId: room.id });
      }
      if (!room.cells.has(southKey) && !hallwayCells.has(southKey)) {
        rawWalls.push({ edge: normalizeEdge(x, y + 1, x + 1, y + 1), roomId: room.id });
      }
      if (!room.cells.has(westKey) && !hallwayCells.has(westKey)) {
        rawWalls.push({ edge: normalizeEdge(x, y, x, y + 1), roomId: room.id });
      }
      if (!room.cells.has(eastKey) && !hallwayCells.has(eastKey)) {
        rawWalls.push({ edge: normalizeEdge(x + 1, y, x + 1, y + 1), roomId: room.id });
      }
    }
  }
  return mergeCollinearWallsWithRoomId(rawWalls);
}

function countOrthogonalRoomNeighbors(roomCells, x, y) {
  let count = 0;
  if (roomCells.has(cellKey(x, y - 1))) count += 1;
  if (roomCells.has(cellKey(x + 1, y))) count += 1;
  if (roomCells.has(cellKey(x, y + 1))) count += 1;
  if (roomCells.has(cellKey(x - 1, y))) count += 1;
  return count;
}

function countDiagonalRoomNeighbors(roomCells, x, y) {
  let count = 0;
  if (roomCells.has(cellKey(x - 1, y - 1))) count += 1;
  if (roomCells.has(cellKey(x + 1, y - 1))) count += 1;
  if (roomCells.has(cellKey(x + 1, y + 1))) count += 1;
  if (roomCells.has(cellKey(x - 1, y + 1))) count += 1;
  return count;
}

function computeRoomPerimeterFromCells(roomCells) {
  let perimeter = 0;
  for (const key of roomCells) {
    const { x, y } = parseCellKey(key);
    perimeter += 4 - countOrthogonalRoomNeighbors(roomCells, x, y);
  }
  return perimeter;
}

function hasStrongGrowthSupport(room, x, y) {
  const orthCount = countOrthogonalRoomNeighbors(room.cells, x, y);
  if (orthCount >= 2) return true;
  if (orthCount === 0) return false;

  const diagonalCount = countDiagonalRoomNeighbors(room.cells, x, y);
  if (diagonalCount < 1) return false;

  // Prevent one-cell-wide tendrils by requiring a robust anchor when
  // growth touches the room at only one orthogonal edge.
  const anchors = [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ];
  for (const anchor of anchors) {
    if (!room.cells.has(cellKey(anchor.x, anchor.y))) continue;
    if (countOrthogonalRoomNeighbors(room.cells, anchor.x, anchor.y) >= 2) {
      return true;
    }
  }
  return false;
}

function maxPerimeterAreaRatioForRoom(area) {
  if (area < 20) return 3.2;
  if (area < 40) return 2.8;
  if (area < 80) return 2.55;
  return 2.35;
}

function normalizeShapeStyle(styleValue) {
  const numeric = Number(styleValue);
  if (!Number.isFinite(numeric)) return 0.45;
  return clampNumber(numeric / 100, 0, 1);
}

function pickGrowthCandidate(room, candidates, rng, shapeStyle) {
  if (candidates.length === 0) return null;
  const centroidX = Number.isFinite(room.centroidX) ? room.centroidX : 0;
  const centroidY = Number.isFinite(room.centroidY) ? room.centroidY : 0;
  const scoreCandidate = (candidate) => {
    const orth = countOrthogonalRoomNeighbors(room.cells, candidate.x, candidate.y);
    const diag = countDiagonalRoomNeighbors(room.cells, candidate.x, candidate.y);
    const dx = candidate.x + 0.5 - centroidX;
    const dy = candidate.y + 0.5 - centroidY;
    const distance = Math.hypot(dx, dy);
    const compactScore = orth * 3 + diag * 1.4 - distance * 0.45;
    const organicScore = orth * 1.6 + diag * 0.8 + distance * 0.35;
    return compactScore * (1 - shapeStyle) + organicScore * shapeStyle;
  };

  // Sample scoring avoids sorting every candidate on every growth claim.
  const sampleSize = Math.min(
    candidates.length,
    Math.max(8, Math.round(12 + shapeStyle * 16))
  );
  if (sampleSize >= candidates.length) {
    let bestCandidate = candidates[0];
    let bestScore = scoreCandidate(bestCandidate);
    for (let index = 1; index < candidates.length; index++) {
      const candidate = candidates[index];
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    return bestCandidate;
  }

  const sampledIndices = new Set();
  let bestCandidate = null;
  let bestScore = -Infinity;
  while (sampledIndices.size < sampleSize) {
    const pickIndex = randomInt(rng, 0, candidates.length - 1);
    if (sampledIndices.has(pickIndex)) continue;
    sampledIndices.add(pickIndex);
    const candidate = candidates[pickIndex];
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }
  return bestCandidate ?? candidates[0];
}

function isCellClaimableByRoom(x, y, roomId, roomIdByCell, hallwayCells, bounds) {
  if (x < 0 || x >= bounds.cols || y < 0 || y >= bounds.rows) return false;
  const key = cellKey(x, y);
  if (hallwayCells.has(key)) return false;
  if (roomIdByCell.has(key)) return false;

  const neighbors = [
    cellKey(x, y - 1),
    cellKey(x + 1, y),
    cellKey(x, y + 1),
    cellKey(x - 1, y),
  ];
  for (const neighborKey of neighbors) {
    const neighborOwner = roomIdByCell.get(neighborKey);
    if (neighborOwner != null && neighborOwner !== roomId) {
      return false;
    }
  }
  return true;
}

function growRoomCells(roomRecords, roomIdByCell, hallwayCells, bounds, rng, roomSizeScale, roomShapeStyle) {
  const shapeStyle = normalizeShapeStyle(roomShapeStyle);
  const planArea = bounds.cols * bounds.rows;
  const nonHallwayArea = Math.max(1, planArea - hallwayCells.size);
  const targetFillRatio = clampNumber(
    0.58 + Math.max(0, roomSizeScale - 1) * 0.1 + (shapeStyle - 0.5) * 0.16,
    0.5,
    0.86
  );
  const targetRoomCellCount = Math.floor(nonHallwayArea * targetFillRatio);
  let claimedRoomCells = roomIdByCell.size;
  if (claimedRoomCells >= targetRoomCellCount) {
    return;
  }

  const maxPasses = Math.min(
    96,
    Math.max(40, Math.ceil(targetRoomCellCount / Math.max(1, roomRecords.length * 2.2)))
  );
  for (let pass = 0; pass < maxPasses; pass++) {
    let passProgress = false;
    const order = [...roomRecords];
    for (let index = order.length - 1; index > 0; index--) {
      const swapIndex = randomInt(rng, 0, index);
      [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    }

    for (const room of order) {
      if (claimedRoomCells >= targetRoomCellCount) return;
      const candidates = [];
      const candidateKeys = new Set();
      for (const key of room.cells) {
        const { x, y } = parseCellKey(key);
        const neighbors = [
          { x, y: y - 1 },
          { x: x + 1, y },
          { x, y: y + 1 },
          { x: x - 1, y },
        ];
        for (const neighbor of neighbors) {
          const neighborKey = cellKey(neighbor.x, neighbor.y);
          if (candidateKeys.has(neighborKey)) continue;
          if (
            !isCellClaimableByRoom(
              neighbor.x,
              neighbor.y,
              room.id,
              roomIdByCell,
              hallwayCells,
              bounds
            )
          ) {
            continue;
          }
          candidateKeys.add(neighborKey);
          candidates.push(neighbor);
        }
      }

      if (candidates.length === 0) continue;
      const maxClaimsThisPass = Math.min(
        candidates.length,
        Math.max(1, Math.round(roomSizeScale * (1.0 + shapeStyle * 0.9)))
      );
      for (let claim = 0; claim < maxClaimsThisPass; claim++) {
        if (candidates.length === 0 || claimedRoomCells >= targetRoomCellCount) break;
        const picked = pickGrowthCandidate(room, candidates, rng, shapeStyle);
        if (picked == null) break;
        const pickIndex = candidates.findIndex((candidate) => candidate.x === picked.x && candidate.y === picked.y);
        if (pickIndex < 0) continue;
        candidates.splice(pickIndex, 1);
        const pickedKey = cellKey(picked.x, picked.y);
        if (
          !isCellClaimableByRoom(
            picked.x,
            picked.y,
            room.id,
            roomIdByCell,
            hallwayCells,
            bounds
          )
        ) {
          continue;
        }
        const orthNeighbors = countOrthogonalRoomNeighbors(room.cells, picked.x, picked.y);
        const diagonalNeighbors = countDiagonalRoomNeighbors(room.cells, picked.x, picked.y);
        const minOrthogonalSupport = shapeStyle < 0.35 ? 2 : 1;
        if (
          orthNeighbors < minOrthogonalSupport ||
          (orthNeighbors === 1 && diagonalNeighbors === 0) ||
          (orthNeighbors === 1 && !hasStrongGrowthSupport(room, picked.x, picked.y))
        ) {
          continue;
        }
        const projectedArea = room.cells.size + 1;
        const projectedPerimeter = room.perimeter + (4 - orthNeighbors * 2);
        const projectedRatio = projectedPerimeter / projectedArea;
        const ratioAllowance = shapeStyle * 0.3;
        const maxRatio = maxPerimeterAreaRatioForRoom(projectedArea) + ratioAllowance;
        const singleEdgePenalty = orthNeighbors === 1 ? 0.3 : 0;
        if (projectedRatio > maxRatio - singleEdgePenalty) {
          continue;
        }
        room.cells.add(pickedKey);
        roomIdByCell.set(pickedKey, room.id);
        const nextCellCount = room.cellCount + 1;
        room.centroidX = ((room.centroidX * room.cellCount) + picked.x + 0.5) / nextCellCount;
        room.centroidY = ((room.centroidY * room.cellCount) + picked.y + 0.5) / nextCellCount;
        room.cellCount = nextCellCount;
        room.perimeter = projectedPerimeter;
        claimedRoomCells += 1;
        passProgress = true;
      }
    }

    if (!passProgress) break;
  }
}

function generateRoomsFromDoors(
  doorOpenings,
  hallwayWalls,
  hallwayGrid,
  hallwayCells,
  bounds,
  rng,
  roomSizeScale = 1,
  roomShapeStyle = DEFAULT_OPTIONS.roomShapeStyle
) {
  const wallByKey = new Map(hallwayWalls.map((wall) => [edgeKey(wall.edge), wall]));
  const occupiedCells = new Set(hallwayCells);
  const roomRecords = [];
  const roomIdByCell = new Map();
  const connectedDoors = [];
  const connectedDoorKeys = new Set();

  const tryPlaceRoomForDoor = (opening) => {
    const hallwayWall = wallByKey.get(opening.wallKey);
    if (hallwayWall == null) return false;
    const hallwaySide = classifyHallwayWallSide(hallwayWall.edge, hallwayGrid);
    if (hallwaySide == null) return false;
    const preferLargeRooms = roomSizeScale >= 1.2 || doorOpenings.length <= 10;
    const attempts = preferLargeRooms
      ? [
          { ...opening, roomSizeMode: 'large' },
          { ...opening, roomSizeMode: 'normal' },
          { ...opening, roomSizeMode: 'compact' },
        ]
      : [
          { ...opening, roomSizeMode: 'normal' },
          { ...opening, roomSizeMode: 'compact' },
        ];

    let roomRect = null;
    for (const attemptOpening of attempts) {
      const candidate = buildRoomFromDoor(
        attemptOpening,
        hallwayWall,
        hallwaySide,
        bounds,
        rng,
        roomSizeScale
      );
      if (candidate == null) continue;
      if (roomCellsOverlap(occupiedCells, candidate)) continue;
      roomRect = candidate;
      break;
    }
    if (roomRect == null) return false;

    const roomId = `room-${roomRecords.length + 1}`;
    const roomCells = createRoomCellKeySet(roomRect);
    for (const key of roomCells) {
      occupiedCells.add(key);
      roomIdByCell.set(key, roomId);
    }
    roomRecords.push({
      id: roomId,
      cells: roomCells,
      centroidX: roomRect.x + roomRect.width / 2,
      centroidY: roomRect.y + roomRect.height / 2,
      cellCount: roomCells.size,
      perimeter: computeRoomPerimeterFromCells(roomCells),
    });
    connectedDoors.push(opening);
    connectedDoorKeys.add(opening.wallKey);
    return true;
  };

  for (const opening of doorOpenings) {
    tryPlaceRoomForDoor(opening);
  }

  // Backfill hallways that still ended up with no attached room.
  const connectedHallways = new Set(connectedDoors.map((door) => door.hallwayId).filter((id) => id != null));
  const openingsByHall = new Map();
  for (const opening of doorOpenings) {
    const hallId = opening.hallwayId;
    if (hallId == null) continue;
    if (!openingsByHall.has(hallId)) {
      openingsByHall.set(hallId, []);
    }
    openingsByHall.get(hallId).push(opening);
  }
  for (const [hallId, openings] of openingsByHall.entries()) {
    if (connectedHallways.has(hallId)) continue;
    const shuffled = [...openings];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = randomInt(rng, 0, index);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    for (const opening of shuffled) {
      if (connectedDoorKeys.has(opening.wallKey)) continue;
      if (tryPlaceRoomForDoor(opening)) {
        connectedHallways.add(hallId);
        break;
      }
    }
  }

  growRoomCells(roomRecords, roomIdByCell, hallwayCells, bounds, rng, roomSizeScale, roomShapeStyle);
  const rooms = roomRecords.map((room) => buildRoomDataFromCells(room.id, room.cells));
  const roomWalls = buildRoomPerimeterWallsFromCells(roomRecords, hallwayCells);

  // Keep per-room wall ownership metadata for downstream exit selection logic.
  return { rooms, roomWalls, connectedDoors };
}

function generateRoomsWithAdaptiveScale({
  initialDoorOpenings,
  hallwayWalls,
  hallwayGrid,
  hallwayCells,
  bounds,
  options,
  baseRoomSizeScale,
  roomShapeStyle,
  attemptSeed,
}) {
  const scaleCandidates = [
    baseRoomSizeScale,
    baseRoomSizeScale * 0.9,
    baseRoomSizeScale * 0.8,
    Math.max(1, baseRoomSizeScale * 0.7),
  ];
  let best = null;

  for (let index = 0; index < scaleCandidates.length; index++) {
    const roomSizeScale = Math.max(1, scaleCandidates[index]);
    const variantRng = createRng(attemptSeed + (index + 1) * 3571);
    const {
      rooms,
      roomWalls,
      connectedDoors,
    } = generateRoomsFromDoors(
      initialDoorOpenings,
      hallwayWalls,
      hallwayGrid,
      hallwayCells,
      bounds,
      variantRng,
      roomSizeScale,
      roomShapeStyle
    );
    const exteriorRoomExits = chooseExteriorExitOpenings(roomWalls, rooms, options, variantRng);

    const candidate = {
      rooms,
      roomWalls,
      connectedDoors,
      exteriorRoomExits,
    };
    if (
      best == null ||
      candidate.connectedDoors.length > best.connectedDoors.length ||
      (candidate.exteriorRoomExits.length >= 2 && best.exteriorRoomExits.length < 2)
    ) {
      best = candidate;
    }
    if (candidate.connectedDoors.length === options.doorCount && candidate.exteriorRoomExits.length >= 2) {
      return candidate;
    }
  }

  return best ?? { rooms: [], roomWalls: [], connectedDoors: [], exteriorRoomExits: [] };
}

function chooseDoorOpenings(walls, hallwayGroups, options, rng) {
  const doorCandidates = walls.filter((wall) => edgeLength(wall.edge) >= options.doorWidth + 0.8);
  if (doorCandidates.length === 0 || options.doorCount <= 0) {
    return [];
  }
  const picked = [];
  const pickedSet = new Set();
  const maxDoors = Math.min(
    Math.max(options.doorCount * 2, hallwayGroups.length),
    doorCandidates.length
  );

  // Spread doors across hallways when possible, without exceeding requested count.
  const candidatesByHall = new Map();
  for (const candidate of doorCandidates) {
    const hallId = candidate.hallwayId;
    if (hallId == null) continue;
    if (!candidatesByHall.has(hallId)) {
      candidatesByHall.set(hallId, []);
    }
    candidatesByHall.get(hallId).push(candidate);
  }
  const hallwaysToSeed = hallwayGroups.length > maxDoors
    ? [...hallwayGroups].slice(0, maxDoors)
    : hallwayGroups;
  for (const hallway of hallwaysToSeed) {
    if (picked.length >= maxDoors) break;
    const candidates = candidatesByHall.get(hallway.id) ?? [];
    if (candidates.length === 0) continue;
    const candidate = candidates[randomInt(rng, 0, candidates.length - 1)];
    const key = edgeKey(candidate.edge);
    if (pickedSet.has(key)) continue;
    pickedSet.add(key);
    picked.push(candidate);
  }

  while (picked.length < maxDoors) {
    const candidate = doorCandidates[randomInt(rng, 0, doorCandidates.length - 1)];
    const key = edgeKey(candidate.edge);
    if (pickedSet.has(key)) continue;
    pickedSet.add(key);
    picked.push(candidate);
  }

  return picked.map((wall) => {
    const length = edgeLength(wall.edge);
    const remaining = Math.max(0.2, length - options.doorWidth);
    const minOffset = 0.1;
    const maxOffset = Math.max(minOffset, remaining - 0.1);
    const offset = minOffset + rng() * (maxOffset - minOffset);
    return {
      wallKey: edgeKey(wall.edge),
      hallwayId: wall.hallwayId ?? null,
      type: 'door',
      start: offset,
      end: offset + options.doorWidth,
    };
  });
}

function chooseExteriorExitOpenings(roomWalls, rooms, options, rng) {
  const candidates = roomWalls
    .map((wall) => ({
      wallKey: edgeKey(wall.edge),
      edge: wall.edge,
      length: edgeLength(wall.edge),
      roomId: wall.roomId ?? null,
    }))
    .filter((wall) => wall.length >= options.doorWidth + 0.5 && wall.roomId != null);

  if (candidates.length === 0) {
    return [];
  }

  const candidatesByRoom = new Map();
  for (const candidate of candidates) {
    const key = candidate.roomId;
    if (!candidatesByRoom.has(key)) {
      candidatesByRoom.set(key, []);
    }
    candidatesByRoom.get(key).push(candidate);
  }
  const roomIds = [...candidatesByRoom.keys()];
  if (roomIds.length < 2) {
    return [];
  }

  const roomCenterById = new Map(
    (rooms ?? []).map((room) => [
      room.id,
      { x: room.labelX ?? (room.x + room.width / 2), y: room.labelY ?? (room.y + room.height / 2) },
    ])
  );
  let selectedRoomIds = [roomIds[0], roomIds[1]];
  let bestDistance = -1;
  for (let i = 0; i < roomIds.length; i++) {
    for (let j = i + 1; j < roomIds.length; j++) {
      const firstId = roomIds[i];
      const secondId = roomIds[j];
      const firstCenter = roomCenterById.get(firstId);
      const secondCenter = roomCenterById.get(secondId);
      if (firstCenter == null || secondCenter == null) continue;
      const dx = firstCenter.x - secondCenter.x;
      const dy = firstCenter.y - secondCenter.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > bestDistance) {
        bestDistance = distSq;
        selectedRoomIds = [firstId, secondId];
      }
    }
  }
  if (bestDistance < 0 && roomIds.length > 2) {
    // If center metadata is missing, still prefer spread by random pair.
    const first = roomIds[randomInt(rng, 0, roomIds.length - 1)];
    let second = first;
    while (second === first) {
      second = roomIds[randomInt(rng, 0, roomIds.length - 1)];
    }
    selectedRoomIds = [first, second];
  }

  const exits = [];
  for (const roomId of selectedRoomIds) {
    const roomCandidates = candidatesByRoom.get(roomId) ?? [];
    if (roomCandidates.length === 0) continue;
    const chosen = roomCandidates[randomInt(rng, 0, roomCandidates.length - 1)];
    const remaining = Math.max(0.2, chosen.length - options.doorWidth);
    const minOffset = 0.1;
    const maxOffset = Math.max(minOffset, remaining - 0.1);
    const offset = minOffset + rng() * (maxOffset - minOffset);
    exits.push({
      wallKey: chosen.wallKey,
      type: 'door',
      start: offset,
      end: offset + options.doorWidth,
      roomId,
    });
  }
  return exits;
}

function chooseWindowOpenings(roomWalls, hallwayWalls, doorOpenings, options, rng) {
  const maxWindows = Math.max(0, Number(options.maxWindowCount) || 0);
  if (maxWindows <= 0) {
    return [];
  }

  const doorWallKeys = new Set(doorOpenings.map((opening) => opening.wallKey));
  const candidates = [...roomWalls, ...hallwayWalls]
    .map((wall) => ({
      wallKey: edgeKey(wall.edge),
      edge: wall.edge,
      length: edgeLength(wall.edge),
    }))
    .filter((wall) =>
      wall.length >= options.windowWidth + 0.8 &&
      !doorWallKeys.has(wall.wallKey)
    );

  if (candidates.length === 0) {
    return [];
  }

  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = randomInt(rng, 0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const count = Math.min(maxWindows, shuffled.length);
  const openings = [];
  for (let index = 0; index < count; index++) {
    const wall = shuffled[index];
    const remaining = Math.max(0.2, wall.length - options.windowWidth);
    const minOffset = 0.15;
    const maxOffset = Math.max(minOffset, remaining - 0.15);
    const offset = minOffset + rng() * (maxOffset - minOffset);
    openings.push({
      wallKey: wall.wallKey,
      type: 'window',
      start: offset,
      end: offset + options.windowWidth,
    });
  }

  return openings;
}

function createWallSegmentsFromOpenings(wall, openings) {
  const length = edgeLength(wall.edge);
  const sorted = [...openings]
    .sort((left, right) => left.start - right.start)
    .map((opening) => ({
      ...opening,
      start: Math.max(0, Math.min(length, opening.start)),
      end: Math.max(0, Math.min(length, opening.end)),
    }))
    .filter((opening) => opening.end > opening.start);

  const segments = [];
  let cursor = 0;
  for (const opening of sorted) {
    if (opening.start > cursor) {
      segments.push({ start: cursor, end: opening.start });
    }
    cursor = Math.max(cursor, opening.end);
  }
  if (cursor < length) {
    segments.push({ start: cursor, end: length });
  }

  const dx = wall.edge.x2 - wall.edge.x1;
  const dy = wall.edge.y2 - wall.edge.y1;
  const invLength = length === 0 ? 0 : 1 / length;
  return segments
    .filter((segment) => segment.end - segment.start > 0.08)
    .map((segment) => ({
      x1: wall.edge.x1 + dx * segment.start * invLength,
      y1: wall.edge.y1 + dy * segment.start * invLength,
      x2: wall.edge.x1 + dx * segment.end * invLength,
      y2: wall.edge.y1 + dy * segment.end * invLength,
      type: 'wall',
    }));
}

function createOpeningGlyph(edge, opening) {
  const length = edgeLength(edge);
  if (length === 0) return null;
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const invLength = 1 / length;
  return {
    x1: edge.x1 + dx * opening.start * invLength,
    y1: edge.y1 + dy * opening.start * invLength,
    x2: edge.x1 + dx * opening.end * invLength,
    y2: edge.y1 + dy * opening.end * invLength,
    type: opening.type,
  };
}

function buildHallwayMetadata(hallwayGroups) {
  return hallwayGroups
    .filter((group) => Array.isArray(group.cells) && group.cells.length > 0)
    .map((group) => {
      const sum = group.cells.reduce(
        (acc, cell) => ({ x: acc.x + cell.x + 0.5, y: acc.y + cell.y + 0.5 }),
        { x: 0, y: 0 }
      );
      return {
        id: group.id,
        shape: group.shape ?? null,
        labelX: sum.x / group.cells.length,
        labelY: sum.y / group.cells.length,
        cells: group.cells,
      };
    });
}

function generatePlanAttempt(options, bounds, seed) {
  const rng = createRng(seed);
  const corridorWidthCells = deriveCorridorWidthCells(options, bounds, rng);
  const roomSizeScale = deriveLayoutScale(options, bounds);
  const { hallwayCells, hallwayGroups } = buildHallwayGroups(
    bounds,
    options.hallwayCount,
    corridorWidthCells,
    rng
  );
  const hallwayGrid = buildHallwayGrid(bounds, hallwayCells);
  const hallwayOwnershipGrid = buildHallwayOwnershipGrid(bounds, hallwayGroups);
  const hallwayWalls = buildHallwayWalls(bounds, hallwayCells).map((wall) => ({
    ...wall,
    hallwayId: getHallwayIdForWall(wall.edge, hallwayGrid, hallwayOwnershipGrid),
  }));
  const initialDoorOpenings = chooseDoorOpenings(hallwayWalls, hallwayGroups, options, rng);
  const {
    rooms,
    roomWalls,
    connectedDoors,
    exteriorRoomExits,
  } = generateRoomsWithAdaptiveScale({
    initialDoorOpenings,
    hallwayWalls,
    hallwayGrid,
    hallwayCells,
    bounds,
    options,
    baseRoomSizeScale: roomSizeScale,
    roomShapeStyle: options.roomShapeStyle,
    attemptSeed: seed,
  });
  const windowOpenings = chooseWindowOpenings(
    roomWalls,
    hallwayWalls,
    [...connectedDoors, ...exteriorRoomExits],
    options,
    rng
  );

  const openingsByWall = new Map();
  const allOpenings = [...connectedDoors, ...exteriorRoomExits, ...windowOpenings];
  for (const opening of allOpenings) {
    if (!openingsByWall.has(opening.wallKey)) {
      openingsByWall.set(opening.wallKey, []);
    }
    openingsByWall.get(opening.wallKey).push(opening);
  }

  const walls = [];
  const openingGlyphs = [];
  const allWalls = [...hallwayWalls, ...roomWalls];
  for (const wall of allWalls) {
    const key = edgeKey(wall.edge);
    const openings = openingsByWall.get(key) ?? [];
    walls.push(...createWallSegmentsFromOpenings(wall, openings));
    for (const opening of openings) {
      const glyph = createOpeningGlyph(wall.edge, opening);
      if (glyph != null) {
        openingGlyphs.push(glyph);
      }
    }
  }

  return {
    rooms,
    hallways: buildHallwayMetadata(hallwayGroups),
    walls,
    openings: openingGlyphs,
    connectedDoors,
    hasExteriorExit: exteriorRoomExits.length >= 2,
    corridorWidthCells,
  };
}

export function generateFloorPlan(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  options.width = clampNumber(Number(options.width) || DEFAULT_OPTIONS.width, 12, 100);
  options.height = clampNumber(Number(options.height) || DEFAULT_OPTIONS.height, 12, 100);
  options.hallwayCount = Math.round(clampNumber(Number(options.hallwayCount) || 1, 1, 12));
  options.doorCount = Math.round(clampNumber(Number(options.doorCount) || 0, 0, 40));
  options.maxLightCount = Math.round(clampNumber(Number(options.maxLightCount) || 0, 0, 80));
  options.roomShapeStyle = Math.round(
    clampNumber(
      Number(options.roomShapeStyle) || DEFAULT_OPTIONS.roomShapeStyle,
      0,
      100
    )
  );
  options.doorWidth = clampNumber(Number(options.doorWidth) || DEFAULT_OPTIONS.doorWidth, 0.8, 2.5);
  options.maxWindowCount = Math.round(clampNumber(Number(options.maxWindowCount) || 0, 0, 40));
  options.windowWidth = clampNumber(Number(options.windowWidth) || DEFAULT_OPTIONS.windowWidth, 0.8, 2.8);
  options.minCorridorWidthCells = toOddInteger(
    clampNumber(
      Number(options.minCorridorWidthCells) || DEFAULT_OPTIONS.minCorridorWidthCells,
      3,
      25
    )
  );
  options.maxCorridorWidthCells = toOddInteger(
    clampNumber(
      Number(options.maxCorridorWidthCells) || DEFAULT_OPTIONS.maxCorridorWidthCells,
      3,
      25
    )
  );
  if (options.minCorridorWidthCells > options.maxCorridorWidthCells) {
    const swap = options.minCorridorWidthCells;
    options.minCorridorWidthCells = options.maxCorridorWidthCells;
    options.maxCorridorWidthCells = swap;
  }
  const strictDoorCount = options.strictDoorCount !== false;
  const requireExteriorExits = options.requireExteriorExits !== false;

  const bounds = {
    cols: Math.max(12, Math.round(options.width / GRID_CELL_SIZE)),
    rows: Math.max(12, Math.round(options.height / GRID_CELL_SIZE)),
  };
  const maxAttempts = strictDoorCount || requireExteriorExits ? 48 : 12;
  let bestAttempt = null;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
    const attemptSeed = Number(options.seed) + attemptIndex * 7919;
    const attempt = generatePlanAttempt(options, bounds, attemptSeed);
    if (
      bestAttempt == null ||
      attempt.connectedDoors.length > bestAttempt.connectedDoors.length ||
      (attempt.hasExteriorExit && !bestAttempt.hasExteriorExit)
    ) {
      bestAttempt = attempt;
    }
    if (attempt.connectedDoors.length === options.doorCount && attempt.hasExteriorExit) {
      bestAttempt = attempt;
      break;
    }
  }

  if (bestAttempt == null) {
    throw new Error('Failed to generate a hallway layout.');
  }
  if (strictDoorCount && bestAttempt.connectedDoors.length !== options.doorCount) {
    throw new Error(
      `Could not place ${options.doorCount} room-connected doors. ` +
      'Try fewer doors, fewer hallways, or larger map dimensions.'
    );
  }
  if (requireExteriorExits && !bestAttempt.hasExteriorExit) {
    throw new Error(
      'Could not place at least 2 exterior exits on different rooms. Try regenerating or increasing map size.'
    );
  }

  const rooms = bestAttempt.rooms;
  const hallways = bestAttempt.hallways;
  const walls = bestAttempt.walls;
  const openingGlyphs = bestAttempt.openings;
  const connectedDoors = bestAttempt.connectedDoors;
  const lightRng = createRng(Number(options.seed) + 19211);
  const lightSpawns = createLightSpawnsFromPlanCells(
    rooms,
    hallways,
    options.maxLightCount,
    lightRng
  );
  return {
    meta: {
      width: options.width,
      height: options.height,
      seed: options.seed,
      roomCount: rooms.length,
      hallwayCount: hallways.length,
      requestedDoorCount: options.doorCount,
      placedDoorCount: connectedDoors.length,
      hasExteriorExit: bestAttempt.hasExteriorExit,
      corridorWidthCells: bestAttempt.corridorWidthCells,
      lightCount: lightSpawns.length,
      windowCount: openingGlyphs.filter((opening) => opening.type === 'window').length,
      wallCount: walls.length,
    },
    rooms,
    hallways,
    walls,
    openings: openingGlyphs,
    lightSpawns,
    furniture: [],
  };
}

function svgLine(line, className) {
  return `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" class="${className}" />`;
}

function encodePlanMetadata(metadata) {
  return btoa(encodeURIComponent(JSON.stringify(metadata)));
}

function svgPlayerStart(playerStart, padding) {
  const cx = playerStart.x + padding;
  const cy = playerStart.y + padding;
  return `
<g class="player-start-marker" data-plan-x="${playerStart.x}" data-plan-y="${playerStart.y}">
  <circle class="player-start-dot" cx="${cx}" cy="${cy}" r="0.35" />
  <line class="player-start-cross" x1="${cx - 0.28}" y1="${cy}" x2="${cx + 0.28}" y2="${cy}" />
  <line class="player-start-cross" x1="${cx}" y1="${cy - 0.28}" x2="${cx}" y2="${cy + 0.28}" />
</g>`.trim();
}

function svgNpcStart(item, padding) {
  const cx = item.x + padding;
  const cy = item.y + padding;
  return `
<g class="npc-start-marker" data-id="${item.id}" data-plan-x="${item.x}" data-plan-y="${item.y}">
  <rect class="npc-start-body" x="${cx - 0.22}" y="${cy - 0.5}" width="0.44" height="1.0" rx="0.22" ry="0.22" />
  <circle class="npc-start-head" cx="${cx}" cy="${cy - 0.52}" r="0.18" />
</g>`.trim();
}

function svgLightStart(item, padding) {
  const cx = item.x + padding;
  const cy = item.y + padding;
  return `
<g class="light-start-marker" data-id="${item.id}" data-plan-x="${item.x}" data-plan-y="${item.y}">
  <circle class="light-start-core" cx="${cx}" cy="${cy}" r="0.2" />
  <circle class="light-start-ring" cx="${cx}" cy="${cy}" r="0.38" />
</g>`.trim();
}

export function renderFloorPlanSvg(plan, options = {}) {
  const padding = options.padding ?? 1.5;
  const width = plan.meta.width + padding * 2;
  const height = plan.meta.height + padding * 2;
  const wallStroke = options.wallStroke ?? DEFAULT_OPTIONS.wallStroke;
  const labelRooms = options.labelRooms ?? true;
  const playerStart = options.playerStart ?? { x: plan.meta.width / 2, y: plan.meta.height / 2 };
  const npcSpawns = Array.isArray(options.npcSpawns) ? options.npcSpawns : [];
  const lightSpawns = Array.isArray(options.lightSpawns) ? options.lightSpawns : (plan.lightSpawns ?? []);

  const hallwayFill = (plan.hallways ?? [])
    .flatMap((hallway) => hallway.cells ?? [])
    .map((cell) => `<rect x="${cell.x + padding}" y="${cell.y + padding}" width="1" height="1" class="hallway-cell" />`)
    .join('');
  const hallwayLabels = labelRooms
    ? (plan.hallways ?? []).map((hallway) =>
        `<text x="${hallway.labelX + padding}" y="${hallway.labelY + padding}" class="hallway-label">${hallway.id}</text>`
      ).join('')
    : '';
  const roomLabels = labelRooms
    ? (plan.rooms ?? []).map((room) =>
        `<text x="${room.labelX + padding}" y="${room.labelY + padding}" class="room-label">${room.id}</text>`
      ).join('')
    : '';
  const walls = plan.walls.map((wall) => svgLine({
    x1: wall.x1 + padding,
    y1: wall.y1 + padding,
    x2: wall.x2 + padding,
    y2: wall.y2 + padding,
  }, 'wall')).join('');
  const openingLines = plan.openings.map((opening) => svgLine({
    x1: opening.x1 + padding,
    y1: opening.y1 + padding,
    x2: opening.x2 + padding,
    y2: opening.y2 + padding,
  }, opening.type === 'door' ? 'door' : 'window')).join('');
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
  });
  const playerStartSvg = svgPlayerStart(playerStart, padding);
  const npcStartSvg = npcSpawns.map((item, index) => svgNpcStart({
    id: item.id ?? `npc-${index + 1}`,
    x: Number(item.x),
    y: Number(item.y),
  }, padding)).join('');
  const lightStartSvg = lightSpawns.map((item, index) => svgLightStart({
    id: item.id ?? `light-${index + 1}`,
    x: Number(item.x),
    y: Number(item.y),
  }, padding)).join('');

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
    .hallway-label {
      fill: #6ea7df;
      font: 0.75px system-ui, sans-serif;
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .room-label {
      fill: #93a4b8;
      font: 0.72px system-ui, sans-serif;
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
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
</svg>`.trim();
}
