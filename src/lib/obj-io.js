/**
 * obj-io — OBJ/MTL load support
 *
 * Uses Three.js OBJLoader and MTLLoader. Assumes OBJ files have a matching
 * MTL file (same name, .mtl extension) in the same directory.
 * When MTL texture loads fail (e.g. missing Textures/colormap.png), applies
 * Orange/texture_10.png as fallback.
 *
 * Usage:
 *   import { loadObjFromUrl, loadObjFromFile } from './lib/obj-io.js'
 */

import { LoadingManager, TextureLoader, RepeatWrapping } from 'three'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'

const FALLBACK_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/Orange/texture_10.png`

let _fallbackTexture = null

function getFallbackTexture() {
  if (!_fallbackTexture) {
    _fallbackTexture = new TextureLoader().load(FALLBACK_TEXTURE_URL)
    _fallbackTexture.wrapS = _fallbackTexture.wrapT = RepeatWrapping
  }
  return _fallbackTexture
}

function isTextureFailed(texture) {
  if (!texture) return false
  const img = texture.image
  return img && img.naturalWidth === 0
}

function applyFallbackToMaterials(object, fallback) {
  object.traverse((node) => {
    if (!node.isMesh) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const mat of materials) {
      if (!mat) continue
      const texProps = ['map', 'normalMap', 'specularMap', 'alphaMap', 'bumpMap']
      for (const prop of texProps) {
        const tex = mat[prop]
        if (tex && isTextureFailed(tex)) {
          mat[prop] = fallback
        }
      }
      if (mat.map === null && fallback) {
        mat.map = fallback
      }
    }
  })
}

/**
 * Derive MTL URL from OBJ URL (model.obj -> model.mtl, same directory).
 * @param {string} objUrl
 * @returns {string}
 */
function getMtlUrl(objUrl) {
  return objUrl.replace(/\.obj$/i, '.mtl')
}

/**
 * Recursively collect all Mesh objects from a container.
 * @param {import('three').Object3D} obj
 * @returns {import('three').Mesh[]}
 */
function collectMeshes(obj) {
  const meshes = []
  obj.traverse((child) => {
    if (child.isMesh) meshes.push(child)
  })
  return meshes
}

/**
 * Load an OBJ file from a URL.
 * Expects a matching MTL file (same name, .mtl) in the same directory.
 * @param {string} url - URL to the .obj file (e.g. '/model.obj')
 * @returns {Promise<import('three').Mesh[]|null>} Array of meshes, or null if failed
 */
export async function loadObjFromUrl(url) {
  try {
    const failedUrls = new Set()
    const manager = new LoadingManager(
      undefined,
      undefined,
      (failedUrl) => { failedUrls.add(failedUrl) }
    )

    const loadComplete = new Promise((resolve) => {
      manager.onLoad = resolve
    })

    const mtlUrl = getMtlUrl(url)
    const mtlLoader = new MTLLoader(manager)
    mtlLoader.setPath(url.slice(0, url.lastIndexOf('/') + 1))
    let materials = null
    try {
      materials = await mtlLoader.loadAsync(mtlUrl)
    } catch (e) {
      // MTL may not exist; continue without materials
    }
    const objLoader = new OBJLoader(manager)
    if (materials) {
      objLoader.setMaterials(materials)
    }
    const object = await objLoader.loadAsync(url)
    await loadComplete
    if (materials || failedUrls.size > 0) {
      const fallback = getFallbackTexture()
      applyFallbackToMaterials(object, fallback)
    }
    return collectMeshes(object)
  } catch (err) {
    console.error('Failed to load OBJ from URL:', err)
    return null
  }
}

/**
 * Load an OBJ file from File object(s).
 * When both .obj and matching .mtl are provided, loads with materials.
 * @param {File} objFile - The .obj file
 * @param {File} [mtlFile] - Optional .mtl file (same basename as obj)
 * @returns {Promise<import('three').Mesh[]|null>}
 */
export async function loadObjFromFile(objFile, mtlFile = null) {
  try {
    const failedUrls = new Set()
    const manager = new LoadingManager(
      undefined,
      undefined,
      (failedUrl) => { failedUrls.add(failedUrl) }
    )

    const loadComplete = new Promise((resolve) => {
      manager.onLoad = resolve
    })

    let materials = null
    if (mtlFile) {
      const mtlUrl = URL.createObjectURL(mtlFile)
      try {
        const mtlLoader = new MTLLoader(manager)
        materials = await mtlLoader.loadAsync(mtlUrl)
      } finally {
        URL.revokeObjectURL(mtlUrl)
      }
    }
    const objLoader = new OBJLoader(manager)
    if (materials) {
      objLoader.setMaterials(materials)
    }
    const objUrl = URL.createObjectURL(objFile)
    let object
    try {
      object = await objLoader.loadAsync(objUrl)
    } finally {
      URL.revokeObjectURL(objUrl)
    }
    await loadComplete
    if (failedUrls.size > 0) {
      const fallback = getFallbackTexture()
      applyFallbackToMaterials(object, fallback)
    }
    return collectMeshes(object)
  } catch (err) {
    console.error('Failed to load OBJ from file:', err)
    return null
  }
}
