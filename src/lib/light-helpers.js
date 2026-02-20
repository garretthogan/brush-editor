/**
 * Light helper meshes (visual only; do not cast or receive shadow) and light transform helpers.
 * Depends only on THREE and the light/entry object.
 */

import * as THREE from 'three'

export const LIGHT_HELPER_COLOR = 0xffdd88
export const POINT_LIGHT_HELPER_RADIUS = 0.2
export const AMBIENT_LIGHT_HELPER_SIZE = 0.35
export const SPOT_LIGHT_CONE_LENGTH = 1.2
export const SPOT_LIGHT_CONE_RADIUS = 0.35
export const DIRECTIONAL_LIGHT_HELPER_RADIUS = 0.18
export const DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH = 0.9
export const DIRECTIONAL_LIGHT_HELPER_CONE_RADIUS = 0.25
export const LIGHT_BASE_DIRECTION = new THREE.Vector3(0, -1, 0)

/**
 * @param {THREE.Light} light
 * @returns {THREE.Mesh}
 */
export function createPointLightHelper(light) {
  const geometry = new THREE.SphereGeometry(POINT_LIGHT_HELPER_RADIUS, 12, 8)
  const material = new THREE.MeshBasicMaterial({
    color: light.color?.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * @param {THREE.Light} light
 * @returns {THREE.Mesh}
 */
export function createSpotLightHelper(light) {
  const geometry = new THREE.CylinderGeometry(0, SPOT_LIGHT_CONE_RADIUS, SPOT_LIGHT_CONE_LENGTH, 12)
  const material = new THREE.MeshBasicMaterial({
    color: light.color?.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = -SPOT_LIGHT_CONE_LENGTH / 2
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * @param {THREE.Light} light
 * @returns {THREE.Group}
 */
export function createDirectionalLightHelper(light) {
  const group = new THREE.Group()
  const sphereGeom = new THREE.SphereGeometry(DIRECTIONAL_LIGHT_HELPER_RADIUS, 12, 8)
  const coneGeom = new THREE.CylinderGeometry(0, DIRECTIONAL_LIGHT_HELPER_CONE_RADIUS, DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH, 12)
  const material = new THREE.MeshBasicMaterial({
    color: light.color?.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
  })
  const sphere = new THREE.Mesh(sphereGeom, material)
  const cone = new THREE.Mesh(coneGeom, material)
  cone.position.y = -DIRECTIONAL_LIGHT_HELPER_CONE_LENGTH / 2
  sphere.castShadow = false
  sphere.receiveShadow = false
  cone.castShadow = false
  cone.receiveShadow = false
  group.add(sphere)
  group.add(cone)
  return group
}

/**
 * @param {THREE.Light} light
 * @returns {THREE.Mesh}
 */
export function createAmbientLightHelper(light) {
  const geometry = new THREE.PlaneGeometry(AMBIENT_LIGHT_HELPER_SIZE, AMBIENT_LIGHT_HELPER_SIZE)
  const material = new THREE.MeshBasicMaterial({
    color: light.color?.getHex ? light.color.getHex() : LIGHT_HELPER_COLOR,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * @param {{ light: THREE.Light, helper: THREE.Object3D | null }} entry
 */
export function updateLightHelperColor(entry) {
  if (!entry?.helper) return
  entry.helper.traverse((child) => {
    if (child.material?.color) {
      child.material.color.copy(entry.light.color)
    }
  })
}

/**
 * Update light target position from light quaternion (after rotate gizmo drag).
 * Caller should then update spot/directional helpers and light controls.
 * @param {{ light: THREE.Light, type: string }} entry
 */
export function updateLightDirectionFromRotation(entry) {
  if (!entry || (entry.type !== 'spot' && entry.type !== 'directional')) return
  const light = entry.light
  const dir = LIGHT_BASE_DIRECTION.clone().applyQuaternion(light.quaternion)
  light.target.position.copy(light.position).add(dir)
}

/**
 * Apply scale gizmo to point/spot light distance. Caller should then update light controls.
 * @param {{ light: THREE.Light, type: string }} entry
 * @param {number} baseDistance
 */
export function applyLightScaleToDistance(entry, baseDistance) {
  if (!entry || (entry.type !== 'point' && entry.type !== 'spot')) return
  const light = entry.light
  const base = baseDistance ?? light.distance ?? 0
  const scale = Math.max(light.scale.x, light.scale.y, light.scale.z)
  light.distance = Math.max(0, base * scale)
  light.scale.set(1, 1, 1)
}
