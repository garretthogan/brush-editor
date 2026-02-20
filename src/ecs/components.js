/**
 * Component names and helpers for reading/writing component data on mesh.userData.
 * Brush and Mesh "components" are backed by the same userData used by CSG, scene list, and serialization.
 */

export const COMPONENT = {
  Brush: 'Brush',
  Mesh: 'Mesh',
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {boolean}
 */
export function hasBrushComponent(mesh) {
  return Boolean(mesh?.userData?.isBrush)
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {boolean}
 */
export function hasMeshComponent(mesh) {
  return Boolean(mesh?.userData && (mesh.userData.type || mesh.userData.size != null))
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {{ csgOperation?: string, isUserBrush?: boolean, subtype?: string, generator?: string, generatorGroup?: string, textureKey?: string, textureIndex?: number }}
 */
export function getBrushComponent(mesh) {
  if (!mesh?.userData) return {}
  const u = mesh.userData
  return {
    csgOperation: u.csgOperation,
    isUserBrush: u.isUserBrush,
    subtype: u.subtype,
    generator: u.generator,
    generatorGroup: u.generatorGroup,
    textureKey: u.textureKey,
    textureIndex: u.textureIndex,
  }
}

/**
 * @param {THREE.Object3D} mesh
 * @param {Partial<ReturnType<typeof getBrushComponent>>} data
 */
export function setBrushComponent(mesh, data) {
  if (!mesh?.userData) return
  const u = mesh.userData
  if (data.csgOperation !== undefined) u.csgOperation = data.csgOperation
  if (data.isUserBrush !== undefined) u.isUserBrush = data.isUserBrush
  if (data.subtype !== undefined) u.subtype = data.subtype
  if (data.generator !== undefined) u.generator = data.generator
  if (data.generatorGroup !== undefined) u.generatorGroup = data.generatorGroup
  if (data.textureKey !== undefined) u.textureKey = data.textureKey
  if (data.textureIndex !== undefined) u.textureIndex = data.textureIndex
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {{ type?: string, size?: number[], radius?: number, height?: number }}
 */
export function getMeshComponent(mesh) {
  if (!mesh?.userData) return {}
  const u = mesh.userData
  return {
    type: u.type,
    size: u.size ? [...u.size] : undefined,
    radius: u.radius,
    height: u.height,
  }
}

/**
 * @param {THREE.Object3D} mesh
 * @returns {string | null} entity id from userData.id
 */
export function getEntityId(mesh) {
  return mesh?.userData?.id ?? null
}

/**
 * @param {THREE.Object3D} mesh
 * @param {string} id
 */
export function setEntityId(mesh, id) {
  if (mesh?.userData) mesh.userData.id = id
}
