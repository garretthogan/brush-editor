/**
 * Level data format: serialize to / parse from plain objects.
 * Does not create meshes; main applies parsed data to scene.
 */

import { isCsgBrush } from '../ecs/queries.js'

/**
 * @param {() => Array<{ userData: object, position: { toArray: () => number[] }, rotation: { toArray: () => number[] } }>} getBrushes
 * @param {() => Array<{ light: { color: { getHexString: () => string }, intensity: number, position: { toArray: () => number[] }, distance?: number, decay?: number, angle?: number, penumbra?: number, target?: { position: { toArray: () => number[] } } }, type: string }>} getLights
 * @param {() => { turbidity?: number, rayleigh?: number, mieCoefficient?: number, mieDirectionalG?: number, elevation?: number, azimuth?: number, exposure?: number, sunIntensity?: number, sunColor?: string }} getSkyboxState
 * @returns {{ version: number, brushes: object[], lights: object[], skybox?: object }}
 */
export function serializeLevelData(getBrushes, getLights, getSkyboxState) {
  const brushes = getBrushes()
  const lights = getLights()
  return {
    version: 2,
    brushes: brushes
      .filter(
        (m) =>
          m.userData.type !== 'imported' &&
          !m.userData.isLevelBuilderVolume &&
          !m.userData.isArenaPreview &&
          !m.userData.isMazePreview
      )
      .map((m) => {
        const base = {
          id: m.userData.id,
          type: m.userData.type || 'box',
          position: m.position.toArray(),
          rotation: m.rotation.toArray().slice(0, 3),
        }
        if (m.userData.textureKey) base.textureKey = m.userData.textureKey
        if (typeof m.userData.textureIndex === 'number') base.textureIndex = m.userData.textureIndex
        if (base.type === 'cylinder') {
          base.radius = m.userData.radius
          base.height = m.userData.height
        } else if (base.type === 'ramp' && m.userData.rampPoints) {
          base.rampPoints = m.userData.rampPoints.map((p) => [...p])
          base.rampScale = m.userData.rampScale ?? 1
        } else if (m.userData.size) {
          base.size = [...m.userData.size]
        }
        if (isCsgBrush(m) && m.userData.csgOperation) base.csgOperation = m.userData.csgOperation
        if (m.userData.isUserBrush === true) base.isUserBrush = true
        return base
      }),
    lights: lights.map((entry) => {
      const light = entry.light
      const base = {
        type: entry.type,
        color: `#${light.color.getHexString()}`,
        intensity: light.intensity,
        position: light.position.toArray(),
      }
      if (entry.type === 'point' || entry.type === 'spot') {
        base.distance = light.distance
        base.decay = light.decay
      }
      if (entry.type === 'spot') {
        base.angle = light.angle
        base.penumbra = light.penumbra
        base.target = light.target?.position?.toArray()
      }
      if (entry.type === 'directional') {
        base.target = light.target?.position?.toArray()
      }
      return base
    }),
    skybox: getSkyboxState?.(),
  }
}

/**
 * @param {unknown} data
 * @returns {{ version?: number, brushes: unknown[], lights?: unknown[], skybox?: object } | null}
 */
export function parseLevelData(data) {
  const d = /** @type {{ brushes?: unknown[], lights?: unknown[], version?: number, skybox?: object }} */ (data)
  if (!data || typeof data !== 'object' || !Array.isArray(d.brushes)) return null
  return {
    version: d.version,
    brushes: d.brushes,
    lights: Array.isArray(d.lights) ? d.lights : [],
    skybox: d.skybox != null && typeof d.skybox === 'object' ? d.skybox : undefined,
  }
}

export function getSkyboxState() {
  return {
    turbidity: parseFloat(document.getElementById('sky-turbidity')?.value ?? '10'),
    rayleigh: parseFloat(document.getElementById('sky-rayleigh')?.value ?? '3'),
    mieCoefficient: parseFloat(document.getElementById('sky-mie')?.value ?? '0.005'),
    mieDirectionalG: parseFloat(document.getElementById('sky-mie-g')?.value ?? '0.7'),
    elevation: parseFloat(document.getElementById('sky-elevation')?.value ?? '2'),
    azimuth: parseFloat(document.getElementById('sky-azimuth')?.value ?? '180'),
    exposure: parseFloat(document.getElementById('sky-exposure')?.value ?? '0.5'),
    sunIntensity: parseFloat(document.getElementById('sun-intensity')?.value ?? '1'),
    sunColor: document.getElementById('sun-color')?.value ?? '#ffffff',
  }
}

/**
 * Write skybox state to DOM. Caller should call applySkyParams() after if needed.
 * @param {{ turbidity?: number, rayleigh?: number, mieCoefficient?: number, mieDirectionalG?: number, elevation?: number, azimuth?: number, exposure?: number, sunIntensity?: number, sunColor?: string } | null} state
 */
export function setSkyboxState(state) {
  if (!state || typeof state !== 'object') return
  const set = (id, value) => {
    const el = document.getElementById(id)
    if (!el) return
    el.value = value
    const valueEl = document.getElementById(`${id}-value`)
    if (valueEl) valueEl.textContent = value
  }
  if (state.turbidity != null) set('sky-turbidity', state.turbidity)
  if (state.rayleigh != null) set('sky-rayleigh', state.rayleigh)
  if (state.mieCoefficient != null) set('sky-mie', state.mieCoefficient)
  if (state.mieDirectionalG != null) set('sky-mie-g', state.mieDirectionalG)
  if (state.elevation != null) set('sky-elevation', state.elevation)
  if (state.azimuth != null) set('sky-azimuth', state.azimuth)
  if (state.exposure != null) set('sky-exposure', state.exposure)
  if (state.sunIntensity != null) set('sun-intensity', state.sunIntensity)
  if (state.sunColor != null) {
    const colorEl = document.getElementById('sun-color')
    if (colorEl) colorEl.value = state.sunColor
  }
}
