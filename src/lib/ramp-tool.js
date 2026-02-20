/**
 * Ramp creator tool: four-point selection (two per end), preview, place.
 * Receives scene, pickPoint3D, addRampBrushFrom4Points, createRampGeometryFrom4Points, etc. from main.
 */

import * as THREE from 'three'

const RAMP_MARKER_COLORS = { A: 0x00ff00, B: 0x00cc00, C: 0xff8800, D: 0xff6600 }

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   viewport: HTMLElement,
 *   pickRectElement: HTMLElement,
 *   pickPoint3D: (event: PointerEvent) => number[] | null,
 *   pickPoint3DFromCoords: (clientX: number, clientY: number) => number[] | null,
 *   createRampGeometryFrom4Points: (a: number[], b: number[], c: number[], d: number[], scale: number) => THREE.BufferGeometry,
 *   addRampBrushFrom4Points: (a: number[], b: number[], c: number[], d: number[], scale: number) => THREE.Mesh,
 *   pushUndoState: () => void,
 *   showToast: (msg: string | { type: string }) => void,
 *   selectBrush: (mesh: THREE.Object3D | null) => void,
 *   setCurrentTool: (tool: string) => void,
 *   setTransformMode: (mode: string) => void,
 *   focusCameraOnObject: (obj: THREE.Object3D) => void,
 *   setEditorMode: (mode: string) => void,
 *   CM_PER_UNIT: number,
 *   getBrushes: () => THREE.Object3D[],
 *   setRampCreatorActive?: (active: boolean) => void,
 * }} context
 * @returns {{ startRampCreator: () => void, cancelRampCreator: () => void, isRampCreatorActive: () => boolean, handleRampCreatorPick: (event: PointerEvent) => void, updateRampPreview: () => void, updateRampCreatorStatus: () => void, placeRampFromCreator: () => void, undoRampPoint: () => void, updateRampCursorPreview: (clientX: number, clientY: number) => void }}
 */
export function createRampCreator(context) {
  const {
    scene,
    viewport,
    pickRectElement,
    pickPoint3D,
    pickPoint3DFromCoords,
    createRampGeometryFrom4Points,
    addRampBrushFrom4Points,
    pushUndoState,
    showToast,
    selectBrush,
    setCurrentTool,
    setTransformMode,
    focusCameraOnObject,
    setEditorMode,
    CM_PER_UNIT,
    getBrushes,
    setRampCreatorActive,
  } = context

  const rampCreatorState = { active: false, pointA: null, pointB: null, pointC: null, pointD: null }
  const rampUndoStack = []
  const rampPointMarkers = []
  let rampPreviewMesh = null
  let rampCursorPreview = null

  function addRampPointMarker(point, label) {
    const geometry = new THREE.SphereGeometry(0.15, 16, 12)
    const material = new THREE.MeshBasicMaterial({
      color: RAMP_MARKER_COLORS[label] ?? 0xffffff,
      transparent: true,
      opacity: 0.9,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(point[0], point[1], point[2])
    mesh.userData.rampMarker = true
    mesh.userData.markerLabel = label
    scene.add(mesh)
    rampPointMarkers.push(mesh)
    return mesh
  }

  function clearRampPointMarkers() {
    rampPointMarkers.forEach((m) => {
      scene.remove(m)
      m.geometry.dispose()
      m.material.dispose()
    })
    rampPointMarkers.length = 0
  }

  function updateRampPreview() {
    if (rampPreviewMesh) {
      scene.remove(rampPreviewMesh)
      rampPreviewMesh.geometry.dispose()
      rampPreviewMesh.material.dispose()
      rampPreviewMesh = null
    }
    if (!rampCreatorState.pointA || !rampCreatorState.pointB || !rampCreatorState.pointC || !rampCreatorState.pointD) return
    const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
    const geometry = createRampGeometryFrom4Points(
      rampCreatorState.pointA,
      rampCreatorState.pointB,
      rampCreatorState.pointC,
      rampCreatorState.pointD,
      rampScale
    )
    const material = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    rampPreviewMesh = new THREE.Mesh(geometry, material)
    rampPreviewMesh.userData.rampPreview = true
    rampPreviewMesh.renderOrder = -1
    scene.add(rampPreviewMesh)
  }

  function clearRampPreview() {
    if (rampPreviewMesh) {
      scene.remove(rampPreviewMesh)
      rampPreviewMesh.geometry.dispose()
      rampPreviewMesh.material.dispose()
      rampPreviewMesh = null
    }
  }

  function ensureRampCursorPreview() {
    if (rampCursorPreview) return rampCursorPreview
    const geometry = new THREE.SphereGeometry(0.12, 12, 8)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
    })
    rampCursorPreview = new THREE.Mesh(geometry, material)
    rampCursorPreview.visible = false
    rampCursorPreview.userData.rampCursorPreview = true
    rampCursorPreview.renderOrder = 10
    rampCursorPreview.material.depthWrite = false
    scene.add(rampCursorPreview)
    return rampCursorPreview
  }

  function updateRampCursorPreview(clientX, clientY) {
    if (!rampCreatorState.active) return
    const preview = ensureRampCursorPreview()
    const rect = pickRectElement.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      preview.visible = false
      return
    }
    const pt = pickPoint3DFromCoords(clientX, clientY)
    if (pt) {
      preview.position.set(pt[0], pt[1], pt[2])
      preview.visible = true
    } else {
      preview.visible = false
    }
  }

  function startRampCreator() {
    setEditorMode('brush')
    selectBrush(null)
    rampCreatorState.active = true
    setRampCreatorActive?.(true)
    rampCreatorState.pointA = null
    rampCreatorState.pointB = null
    rampCreatorState.pointC = null
    rampCreatorState.pointD = null
    document.getElementById('ramp-creator-panel')?.classList.remove('hidden')
    document.getElementById('panel-brush-tools')?.closest('.panel')?.classList.remove('collapsed')
    updateRampCreatorStatus()
    document.getElementById('btn-ramp-place').disabled = true
    showToast('Click first point of low end (e.g. left corner).', { type: 'info' })
  }

  function undoRampPoint() {
    if (rampUndoStack.length === 0) return
    const prev = rampUndoStack.pop()
    rampCreatorState.pointA = prev.pointA
    rampCreatorState.pointB = prev.pointB
    rampCreatorState.pointC = prev.pointC
    rampCreatorState.pointD = prev.pointD
    clearRampPointMarkers()
    if (prev.pointA) addRampPointMarker(prev.pointA, 'A')
    if (prev.pointB) addRampPointMarker(prev.pointB, 'B')
    if (prev.pointC) addRampPointMarker(prev.pointC, 'C')
    if (prev.pointD) addRampPointMarker(prev.pointD, 'D')
    updateRampPreview()
    updateRampCreatorStatus()
    document.getElementById('btn-ramp-place').disabled = !prev.pointA || !prev.pointB || !prev.pointC || !prev.pointD
    showToast(prev.pointD ? 'Removed point D.' : prev.pointC ? 'Removed point C.' : prev.pointB ? 'Removed point B.' : 'Removed point A.', { type: 'info' })
  }

  function cancelRampCreator() {
    rampCreatorState.active = false
    setRampCreatorActive?.(false)
    rampCreatorState.pointA = null
    rampCreatorState.pointB = null
    rampCreatorState.pointC = null
    rampCreatorState.pointD = null
    rampUndoStack.length = 0
    clearRampPointMarkers()
    clearRampPreview()
    if (rampCursorPreview) rampCursorPreview.visible = false
    document.getElementById('ramp-creator-panel')?.classList.add('hidden')
  }

  function updateRampCreatorStatus() {
    const status = document.getElementById('ramp-creator-status')
    if (!status) return
    const { pointA, pointB, pointC, pointD } = rampCreatorState
    if (!pointA) {
      status.textContent = '1/4: Click first point of low end'
    } else if (!pointB) {
      status.textContent = '2/4: Click second point of low end'
    } else if (!pointC) {
      status.textContent = '3/4: Click first point of high end'
    } else if (!pointD) {
      status.textContent = '4/4: Click second point of high end'
    } else {
      const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
      const a = new THREE.Vector3(pointA[0], pointA[1], pointA[2])
      const b = new THREE.Vector3(pointB[0], pointB[1], pointB[2])
      const c = new THREE.Vector3(pointC[0], pointC[1], pointC[2])
      const d = new THREE.Vector3(pointD[0], pointD[1], pointD[2])
      const lowCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
      const highCenter = new THREE.Vector3().addVectors(c, d).multiplyScalar(0.5)
      const rampDir = new THREE.Vector3().subVectors(highCenter, lowCenter)
      const rampRun = Math.sqrt(rampDir.x * rampDir.x + rampDir.z * rampDir.z)
      const rampRise = rampDir.y
      const slopeAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(rampRise, rampRun))
      const runM = (rampRun * CM_PER_UNIT / 100).toFixed(1)
      const riseM = (rampRise * CM_PER_UNIT / 100).toFixed(1)
      const lowW = a.distanceTo(b) * CM_PER_UNIT / 100
      const highW = c.distanceTo(d) * CM_PER_UNIT / 100
      status.textContent = `Preview: ${lowW.toFixed(1)}–${highW.toFixed(1)}m × ${runM}m run × ${riseM}m rise, ${slopeAngleDeg.toFixed(1)}° slope. Place Ramp.`
    }
  }

  function handleRampCreatorPick(event) {
    if (event.button !== 0) return
    if (viewport && !viewport.contains(event.target)) return
    const pt = pickPoint3D(event)
    if (!pt) {
      showToast('Click on the floor, a wall, or the ground to place a point.', { type: 'info' })
      return
    }
    const { pointA, pointB, pointC, pointD } = rampCreatorState
    if (!pointA) {
      rampUndoStack.push({ pointA: null, pointB: null, pointC: null, pointD: null })
      rampCreatorState.pointA = pt
      addRampPointMarker(pt, 'A')
      showToast('Low end point 1 (green). Click second point of low end.', { type: 'success' })
    } else if (!pointB) {
      rampUndoStack.push({ pointA: [...pointA], pointB: null, pointC: null, pointD: null })
      rampCreatorState.pointB = pt
      addRampPointMarker(pt, 'B')
      showToast('Low end complete. Click first point of high end (orange). Undo to remove last point.', { type: 'success' })
    } else if (!pointC) {
      rampUndoStack.push({ pointA: [...pointA], pointB: [...pointB], pointC: null, pointD: null })
      rampCreatorState.pointC = pt
      addRampPointMarker(pt, 'C')
      showToast('High end point 1. Click second point of high end. Undo to remove last point.', { type: 'success' })
    } else if (!pointD) {
      rampUndoStack.push({ pointA: [...pointA], pointB: [...pointB], pointC: [...pointC], pointD: null })
      rampCreatorState.pointD = pt
      addRampPointMarker(pt, 'D')
      updateRampPreview()
      showToast('All 4 points set. Adjust scale or click Place Ramp. Undo to remove last point.', { type: 'success' })
    } else {
      rampCreatorState.pointA = pt
      rampCreatorState.pointB = null
      rampCreatorState.pointC = null
      rampCreatorState.pointD = null
      clearRampPointMarkers()
      clearRampPreview()
      addRampPointMarker(pt, 'A')
      showToast('Reset. Click first point of low end.', { type: 'info' })
    }
    updateRampCreatorStatus()
    const allFour = rampCreatorState.pointA && rampCreatorState.pointB && rampCreatorState.pointC && rampCreatorState.pointD
    document.getElementById('btn-ramp-place').disabled = !allFour
  }

  function placeRampFromCreator() {
    const { pointA, pointB, pointC, pointD } = rampCreatorState
    if (!pointA || !pointB || !pointC || !pointD) return
    const rampScale = parseFloat(document.getElementById('ramp-scale')?.value ?? '100') / 100
    pushUndoState()
    addRampBrushFrom4Points(pointA, pointB, pointC, pointD, rampScale)
    const brushes = getBrushes()
    const mesh = brushes[brushes.length - 1]
    selectBrush(mesh)
    setCurrentTool('translate')
    setTransformMode('translate')
    focusCameraOnObject(mesh)
    cancelRampCreator()
    showToast('Ramp placed.', { type: 'success' })
  }

  function isRampCreatorActive() {
    return rampCreatorState.active
  }

  function hasRampUndo() {
    return rampUndoStack.length > 0
  }

  return {
    startRampCreator,
    cancelRampCreator,
    isRampCreatorActive,
    hasRampUndo,
    handleRampCreatorPick,
    updateRampPreview,
    updateRampCreatorStatus,
    placeRampFromCreator,
    undoRampPoint,
    updateRampCursorPreview,
  }
}
