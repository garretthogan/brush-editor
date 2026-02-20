/**
 * Pure predicates and query helpers for mesh userData.
 * Used by main, CSG, and level-builder logic.
 */

export const LEVEL_BUILDER_VOLUME_TYPES = new Set(['maze', 'maze-arena', 'arena'])

/**
 * @param {THREE.Object3D} mesh
 * @returns {boolean}
 */
export function isLevelBuilderVolume(mesh) {
  return Boolean(mesh?.userData?.isLevelBuilderVolume) && LEVEL_BUILDER_VOLUME_TYPES.has(mesh.userData.levelBuilderType)
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {boolean}
 */
export function isCsgBrush(mesh) {
  return Boolean(mesh && (mesh.userData?.type === 'box' || mesh.userData?.type === 'cylinder'))
}
