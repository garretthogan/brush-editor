/**
 * Brush mesh and geometry helpers: box/cylinder CSG brushes and player start marker.
 * Uses materials.js for texture and createBrushMaterial; three-bvh-csg Brush for CSG.
 */

import * as THREE from 'three'
import { Brush } from 'three-bvh-csg'
import { createBrushMaterial, resolveBrushTexture, resolveBrushTextureInfo } from './materials.js'

export function setCylinderUVs(geometry, radius, height, radialSegments = 16, heightSegments = 1) {
  const uv = geometry.attributes.uv
  if (!uv) return
  const circumference = 2 * Math.PI * radius
  const torsoCount = (radialSegments + 1) * (heightSegments + 1)
  for (let i = 0; i < torsoCount; i++) {
    const uVal = uv.getX(i)
    const vVal = uv.getY(i)
    uv.setXY(i, uVal * circumference, vVal * height)
  }
  const capScale = 2 * radius
  for (let cap = 0; cap < 2; cap++) {
    const start = torsoCount + cap * (2 * radialSegments + 1)
    const end = start + 2 * radialSegments + 1
    for (let i = start; i < end; i++) {
      const uVal = uv.getX(i)
      const vVal = uv.getY(i)
      uv.setXY(i, 0.5 + (uVal - 0.5) * capScale, 0.5 + (vVal - 0.5) * capScale)
    }
  }
  uv.needsUpdate = true
}

export function setBoxUVs(geometry, sx, sy, sz) {
  const uv = geometry.attributes.uv
  if (!uv) return
  const faceDims = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy],
  ]
  for (let f = 0; f < 6; f++) {
    const [w, h] = faceDims[f]
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      const uVal = uv.getX(i)
      const vVal = uv.getY(i)
      uv.setXY(i, uVal * w, vVal * h)
    }
  }
  uv.needsUpdate = true
}

/**
 * @param {[number, number, number]} size
 * @param {[number, number, number]} position
 * @param {number} depthBias
 * @param {{ key?: string, index?: number } | null} textureInfo
 * @param {boolean} useLitMaterials
 * @returns {import('three-bvh-csg').Brush}
 */
export function createBrushMesh(size = [2, 2, 2], position = [0, 1, 0], depthBias = 0, textureInfo = null, useLitMaterials = false) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
  setBoxUVs(geometry, size[0], size[1], size[2])
  const resolvedInfo = resolveBrushTextureInfo(textureInfo)
  const texture = resolveBrushTexture(resolvedInfo)
  const material = createBrushMaterial(texture, depthBias, useLitMaterials)
  const mesh = new Brush(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'box'
  mesh.userData.size = [...size]
  mesh.userData.csgOperation = 'ADDITION'
  if (resolvedInfo.key) mesh.userData.textureKey = resolvedInfo.key
  if (typeof resolvedInfo.index === 'number') mesh.userData.textureIndex = resolvedInfo.index
  return mesh
}

/**
 * @param {number} radius
 * @param {number} height
 * @param {[number, number, number]} position
 * @param {number} depthBias
 * @param {{ key?: string, index?: number } | null} textureInfo
 * @param {boolean} useLitMaterials
 * @returns {import('three-bvh-csg').Brush}
 */
export function createCylinderMesh(radius = 1, height = 2, position = [0, 1, 0], depthBias = 0, textureInfo = null, useLitMaterials = false) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16, 1)
  setCylinderUVs(geometry, radius, height, 16, 1)
  const resolvedInfo = resolveBrushTextureInfo(textureInfo)
  const texture = resolveBrushTexture(resolvedInfo)
  const material = createBrushMaterial(texture, depthBias, useLitMaterials)
  const mesh = new Brush(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = useLitMaterials
  mesh.receiveShadow = useLitMaterials
  mesh.userData.isBrush = true
  mesh.userData.type = 'cylinder'
  mesh.userData.radius = radius
  mesh.userData.height = height
  mesh.userData.csgOperation = 'ADDITION'
  if (resolvedInfo.key) mesh.userData.textureKey = resolvedInfo.key
  if (typeof resolvedInfo.index === 'number') mesh.userData.textureIndex = resolvedInfo.index
  return mesh
}

const PLAYER_HEIGHT_UNITS = 1.75
const PLAYER_RADIUS_UNITS = 0.25

/**
 * @param {[number, number, number]} position
 * @returns {THREE.Mesh}
 */
export function createPlayerStartMesh(position = [0, 0, 0]) {
  const coneGeom = new THREE.ConeGeometry(PLAYER_RADIUS_UNITS, PLAYER_HEIGHT_UNITS, 12)
  const material = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.9,
  })
  const mesh = new THREE.Mesh(coneGeom, material)
  mesh.name = 'player_start'
  mesh.position.set(...position)
  mesh.userData.isBrush = true
  mesh.userData.type = 'player_start'
  mesh.userData.id = crypto.randomUUID()
  mesh.userData.isUserBrush = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}
