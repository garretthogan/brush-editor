/**
 * Entity registry: stores entities as { id, mesh }.
 * Component data remains on mesh.userData for CSG, serialization, and scene list compatibility.
 */

import { hasBrushComponent, getEntityId, setEntityId } from './components.js'

/**
 * @typedef {{ id: string, mesh: THREE.Object3D }} Entity
 */

export class EntityRegistry {
  constructor() {
    /** @type {Entity[]} */
    this._entities = []
  }

  /**
   * Register a mesh as an entity. Assigns userData.id if missing.
   * @param {THREE.Object3D} mesh
   * @param {string} [id] - Optional id; if omitted, uses mesh.userData.id or generates one.
   * @returns {Entity}
   */
  register(mesh, id = getEntityId(mesh) ?? crypto.randomUUID()) {
    setEntityId(mesh, id)
    const entity = { id, mesh }
    this._entities.push(entity)
    return entity
  }

  /**
   * Remove an entity by id. Caller is responsible for scene.remove and dispose.
   * @param {string} id
   * @returns {Entity | null}
   */
  removeEntity(id) {
    const idx = this._entities.findIndex((e) => e.id === id)
    if (idx === -1) return null
    const [entity] = this._entities.splice(idx, 1)
    return entity
  }

  /**
   * @param {string} id
   * @returns {Entity | null}
   */
  getEntity(id) {
    return this._entities.find((e) => e.id === id) ?? null
  }

  /**
   * @returns {Entity[]}
   */
  getAllEntities() {
    return [...this._entities]
  }

  /**
   * All meshes in registration order (for CSG, raycaster, serialization).
   * @returns {THREE.Object3D[]}
   */
  getAllMeshes() {
    return this._entities.map((e) => e.mesh)
  }

  /**
   * @param {string} componentName - 'Brush' | 'Mesh'
   * @returns {Entity[]}
   */
  getEntitiesWithComponent(componentName) {
    if (componentName === 'Brush') {
      return this._entities.filter((e) => hasBrushComponent(e.mesh))
    }
    return this._entities
  }

  /**
   * @param {string} groupId - e.g. userData.generatorGroup
   * @returns {Entity[]}
   */
  getEntitiesInGroup(groupId) {
    return this._entities.filter((e) => e.mesh?.userData?.generatorGroup === groupId)
  }

  /**
   * Find entity by mesh reference.
   * @param {THREE.Object3D} mesh
   * @returns {Entity | null}
   */
  getEntityByMesh(mesh) {
    return this._entities.find((e) => e.mesh === mesh) ?? null
  }

  /**
   * Clear all entities. Caller is responsible for scene.remove and dispose of meshes.
   */
  clear() {
    this._entities.length = 0
  }
}
