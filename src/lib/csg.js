/**
 * CSG constants and pure geometry helpers.
 * See https://github.com/gkjohnson/three-bvh-csg
 */

import * as THREE from 'three'
import { ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'

export { ADDITION, SUBTRACTION, INTERSECTION }

/** CSG operation keys for UI and serialization. */
export const CSG_OP_VALUES = { ADDITION, SUBTRACTION, INTERSECTION }

/**
 * @param {string} key
 * @returns {typeof ADDITION}
 */
export function getCsgOperationConstant(key) {
  return CSG_OP_VALUES[key] ?? ADDITION
}

/**
 * Compute world-space AABB for a mesh. Pure: no scene mutation.
 * @param {THREE.Object3D} mesh
 * @returns {THREE.Box3}
 */
export function getBrushWorldBox(mesh) {
  const box = new THREE.Box3()
  return box.setFromObject(mesh)
}

/**
 * Compute combined CSG result from box/cylinder brushes. Does not mutate scene; caller adds/removes result mesh.
 * @param {{
 *   brushes: THREE.Object3D[],
 *   isCsgBrush: (m: THREE.Object3D) => boolean,
 *   getBrushWorldBox: (m: THREE.Object3D) => THREE.Box3,
 *   evaluator: { useGroups: boolean, evaluate: (a: unknown, b: unknown, op: number) => unknown },
 *   createBrushMaterial: (texture: unknown, depthBias: number, useLit: boolean) => unknown,
 *   resolveBrushTexture: (info: unknown) => unknown,
 *   resolveBrushTextureInfo: (info: unknown) => unknown,
 *   useLitMaterials: boolean,
 *   showToast: (msg: string | { type: string }) => void,
 * }} options
 * @param {(result: { resultMesh: THREE.Mesh | null, restoreVisibility: () => void }) => void} [onResult] - If provided and work is deferred (to show toast), result is passed here; otherwise result is returned.
 * @returns {{ resultMesh: THREE.Mesh | null, restoreVisibility: () => void } | undefined}
 */
export function evaluateCsg(options, onResult) {
  const {
    brushes,
    isCsgBrush,
    getBrushWorldBox: getBox,
    evaluator,
    createBrushMaterial,
    resolveBrushTexture,
    resolveBrushTextureInfo,
    useLitMaterials,
    showToast,
  } = options

  const allCsg = brushes.filter(isCsgBrush)
  const csgBrushes = allCsg.filter((b) => b.userData.isUserBrush === true)
  const nonUserCsgBrushes = allCsg.filter((b) => !b.userData.isUserBrush)

  const restoreAllCsgVisibility = () => {
    allCsg.forEach((b) => {
      b.visible = true
      if (b.material) b.material.visible = true
    })
  }

  const userAdditions = csgBrushes.filter((b) => (b.userData.csgOperation ?? 'ADDITION') === 'ADDITION')
  const subtractions = csgBrushes.filter((b) => (b.userData.csgOperation ?? 'ADDITION') === 'SUBTRACTION')
  const intersections = csgBrushes.filter((b) => (b.userData.csgOperation ?? 'ADDITION') === 'INTERSECTION')

  if (subtractions.length === 0 && intersections.length === 0) {
    return { resultMesh: null, restoreVisibility: restoreAllCsgVisibility, csgParticipating: new Set() }
  }

  const opBrushes = [...subtractions, ...intersections]
  const opBox = new THREE.Box3()
  for (const b of opBrushes) {
    opBox.union(getBox(b))
  }
  opBox.expandByScalar(0.01)
  const nearNonUser = nonUserCsgBrushes.filter(
    (b) =>
      opBox.intersectsBox(getBox(b)) &&
      b.userData?.subtype !== 'maze-floor' &&
      b.userData?.subtype !== 'arena-floor'
  )
  const notFloor = (b) =>
    b.userData?.subtype !== 'maze-floor' && b.userData?.subtype !== 'arena-floor'
  const baseCandidates = [...nearNonUser, ...userAdditions.filter(notFloor)]

  if (baseCandidates.length === 0) {
    return { resultMesh: null, restoreVisibility: restoreAllCsgVisibility, csgParticipating: new Set() }
  }

  const runHeavyWork = () => {
    try {
    evaluator.useGroups = false
    allCsg.forEach((b) => b.updateMatrixWorld(true))

    let result = null
    for (const brush of baseCandidates) {
      if (result === null) {
        result = evaluator.evaluate(brush, brush, ADDITION)
      } else {
        result = evaluator.evaluate(result, brush, ADDITION)
      }
    }
    for (const brush of subtractions) {
      result = evaluator.evaluate(result, brush, SUBTRACTION)
    }
    for (const brush of intersections) {
      result = evaluator.evaluate(result, brush, INTERSECTION)
    }

    const hasValidGeometry =
      result?.geometry?.attributes?.position && result.geometry.attributes.position.count > 0
    if (!result || !hasValidGeometry) {
      return { resultMesh: null, restoreVisibility: restoreAllCsgVisibility, csgParticipating: new Set() }
    }

    const geom = result.geometry
    if (geom.drawRange && geom.attributes.position) {
      geom.drawRange.start = 0
      geom.drawRange.count = geom.index ? geom.index.count : geom.attributes.position.count
    }

    const textureSource =
      baseCandidates.find(
        (b) => b.userData?.subtype === 'maze-wall' || b.userData?.subtype === 'arena-obstacle'
      ) ?? baseCandidates[0]
    const textureInfo = textureSource
      ? (textureSource.userData?.textureKey
          ? { key: textureSource.userData.textureKey }
          : { index: textureSource.userData.textureIndex })
      : null
    const texture = resolveBrushTexture(resolveBrushTextureInfo(textureInfo))
    result.material = createBrushMaterial(texture, 0, useLitMaterials)
    result.material.visible = true
    result.castShadow = useLitMaterials
    result.receiveShadow = useLitMaterials
    result.visible = true

    const csgParticipating = new Set([...baseCandidates, ...subtractions, ...intersections])
    const restoreVisibility = () => {
      allCsg.forEach((b) => {
        b.visible = true
        if (b.material) {
          b.material.visible = !csgParticipating.has(b)
        }
      })
    }
    return { resultMesh: result, restoreVisibility, csgParticipating }
    } catch (_) {
      return { resultMesh: null, restoreVisibility: restoreAllCsgVisibility, csgParticipating: new Set() }
    }
  }

  if (baseCandidates.length > 20) {
    showToast('Computing CSG…', { type: 'info' })
    if (onResult) {
      // Wait for next paint (toast is in DOM), then run heavy work in following task
      requestAnimationFrame(() => {
        setTimeout(() => {
          onResult(runHeavyWork())
        }, 0)
      })
      return undefined
    }
  }

  return runHeavyWork()
}
