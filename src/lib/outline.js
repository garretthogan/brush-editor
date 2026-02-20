/**
 * Outline system for selection highlight. Creates edge outlines on meshes.
 * Factory returns add/remove/refresh and resolution update; main owns brush list and calls per-mesh.
 */

import * as THREE from 'three'

const useFatLines = !/Win/i.test(typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent) : '')

/**
 * @param {{
 *   LineSegments2: typeof import('three/addons/lines/LineSegments2.js').LineSegments2,
 *   LineSegmentsGeometry: typeof import('three/addons/lines/LineSegmentsGeometry.js').LineSegmentsGeometry,
 *   LineMaterial: typeof import('three/addons/lines/LineMaterial.js').LineMaterial,
 *   color: number,
 *   getOutlineWidth: () => number,
 *   getViewport: () => HTMLElement,
 * }} options
 * @returns {{ addOutline: (mesh: THREE.Object3D) => void, removeOutline: (mesh: THREE.Object3D) => void, refreshOutline: (mesh: THREE.Object3D) => void, setOutlineResolution: (mesh: THREE.Object3D, width: number, height: number) => void }}
 */
export function createOutlineSystem(options) {
  const { LineSegments2, LineSegmentsGeometry, LineMaterial, color, getOutlineWidth, getViewport } = options

  function addOutline(mesh) {
    if (mesh.userData.outline || getOutlineWidth() <= 0) return
    const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
    let outline
    if (useFatLines) {
      try {
        const outlineGeom = new LineSegmentsGeometry()
        outlineGeom.fromEdgesGeometry(edges)
        edges.dispose()
        const viewport = getViewport()
        const vw = Math.max(1, viewport?.clientWidth ?? 1)
        const vh = Math.max(1, viewport?.clientHeight ?? 1)
        const outlineMat = new LineMaterial({
          color,
          linewidth: getOutlineWidth(),
        })
        outlineMat.resolution.set(vw, vh)
        outline = new LineSegments2(outlineGeom, outlineMat)
      } catch (_) {
        outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color }))
      }
    } else {
      outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color }))
    }
    outline.raycast = () => {}
    outline.renderOrder = 1
    outline.userData.isOutline = true
    mesh.add(outline)
    mesh.userData.outline = outline
  }

  function removeOutline(mesh) {
    const outline = mesh?.userData?.outline
    if (outline) {
      mesh.remove(outline)
      outline.geometry?.dispose?.()
      outline.material?.dispose?.()
      mesh.userData.outline = null
    }
  }

  function refreshOutline(mesh) {
    const outline = mesh?.userData?.outline
    if (!outline) return
    outline.geometry.dispose()
    const edges = new THREE.EdgesGeometry(mesh.geometry, 1)
    if (outline instanceof LineSegments2) {
      const outlineGeom = new LineSegmentsGeometry()
      outlineGeom.fromEdgesGeometry(edges)
      edges.dispose()
      outline.geometry = outlineGeom
    } else {
      outline.geometry = edges
    }
  }

  function setOutlineResolution(mesh, width, height) {
    const outline = mesh?.userData?.outline
    if (outline?.material?.resolution) {
      outline.material.resolution.set(width, height)
    }
  }

  return { addOutline, removeOutline, refreshOutline, setOutlineResolution }
}
