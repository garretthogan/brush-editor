/**
 * glb-io — GLB/GLTF save and load
 *
 * Uses Three.js GLTFExporter and GLTFLoader. Exports brush meshes to standard
 * 3D format; loads GLB/GLTF files and returns meshes for integration into the level.
 *
 * Usage:
 *   import { saveGlb, loadGlb } from './lib/glb-io.js'
 *
 *   // Save (exports meshes, triggers download)
 *   await saveGlb(meshes, { filename: 'level.glb' })
 *
 *   // Load (opens file picker, returns Promise<Object3D[] | null>)
 *   const meshes = await loadGlb({ accept: '.glb,.gltf' })
 *   if (meshes) addToLevel(meshes)
 */

import { LoadingManager, TextureLoader, RepeatWrapping } from 'three'
import { Scene } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

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
      const texProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
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
 * Recursively collect all Mesh objects from a container (Object3D, Group, Scene).
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

function createLoaderWithFallback() {
  const failedUrls = new Set()
  const manager = new LoadingManager(undefined, undefined, (url) => {
    failedUrls.add(url)
  })
  const loader = new GLTFLoader(manager)
  return { loader, failedUrls }
}

/**
 * Save meshes to a GLB file (triggers download).
 * @param {import('three').Object3D[]} objects - Meshes or groups to export
 * @param {object} [options]
 * @param {string} [options.filename='level.glb']
 * @param {boolean} [options.binary=true] - true for .glb, false for .gltf
 */
export async function saveGlb(objects, options = {}) {
  const { filename = 'level.glb', binary = true } = options
  const exporter = new GLTFExporter()
  const scene = new Scene()
  scene.name = 'level'
  for (const obj of objects) {
    const clone = obj.clone()
    clone.traverse((child) => {
      if (child.userData?.isOutline) {
        child.parent?.remove(child)
      }
    })
    scene.add(clone)
  }
  const glb = await exporter.parseAsync(scene, {
    binary,
    maxTextureSize: 4096,
  })
  const blob = binary
    ? new Blob([glb], { type: 'model/gltf-binary' })
    : new Blob([JSON.stringify(glb)], { type: 'model/gltf+json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Load a GLB or GLTF file from a URL.
 * Use this for models with external textures—relative paths like Textures/colormap.png
 * resolve correctly against the model URL. For files in public/, use e.g. '/box.glb'.
 * When a texture fails to load, Orange/texture_10.png is applied as fallback.
 * @param {string} url - URL to the .glb or .gltf file
 * @returns {Promise<import('three').Mesh[]|null>} Array of meshes from the file, or null if failed
 */
export async function loadGlbFromUrl(url) {
  try {
    const { loader, failedUrls } = createLoaderWithFallback()
    const gltf = await loader.loadAsync(url)
    if (failedUrls.size > 0) {
      const fallback = getFallbackTexture()
      applyFallbackToMaterials(gltf.scene, fallback)
    }
    return collectMeshes(gltf.scene)
  } catch (err) {
    console.error('Failed to load GLB/GLTF from URL:', err)
    return null
  }
}

/**
 * Load a GLB or GLTF file given a File object.
 * Note: Models with external texture references (e.g. Textures/colormap.png) will fail
 * because blob URLs have no directory context. Use loadGlbFromUrl for such models.
 * @param {File} file - The .glb or .gltf file to load
 * @returns {Promise<import('three').Mesh[]|null>} Array of meshes from the file, or null if failed
 */
export async function loadGlbFromFile(file) {
  try {
    const url = URL.createObjectURL(file)
    const { loader, failedUrls } = createLoaderWithFallback()
    const gltf = await loader.loadAsync(url)
    URL.revokeObjectURL(url)
    if (failedUrls.size > 0) {
      const fallback = getFallbackTexture()
      applyFallbackToMaterials(gltf.scene, fallback)
    }
    return collectMeshes(gltf.scene)
  } catch (err) {
    console.error('Failed to load GLB/GLTF file:', err)
    return null
  }
}

/**
 * Load a GLB or GLTF file (opens file picker).
 * @param {object} [options]
 * @param {string} [options.accept='.glb,.gltf']
 * @returns {Promise<import('three').Mesh[]|null>} Array of meshes from the file, or null if cancelled/failed
 */
export function loadGlb(options = {}) {
  const { accept = '.glb,.gltf' } = options

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      document.body.removeChild(input)
      if (!file) {
        resolve(null)
        return
      }

      loadGlbFromFile(file).then(resolve)
    })

    document.body.appendChild(input)
    input.click()
  })
}
