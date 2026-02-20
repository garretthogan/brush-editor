import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { createImportSystem } from './import-glb.js'

const stubTexture = {}

vi.mock('./materials.js', () => ({
  getTextureByIndex: () => stubTexture,
  TEXTURE_INDEX: {
    mazeFloor: 0,
    mazeWall: 1,
    arenaBase: 0,
    arenaObstacle: 2,
  },
}))

describe('createImportSystem / addImportedMeshes', () => {
  let scene
  let brushes
  let pushUndoState
  let updateBrushMaterials
  let updateSceneList
  let selectBrush
  let onBrushesChanged

  beforeEach(() => {
    scene = new THREE.Scene()
    brushes = []
    pushUndoState = vi.fn()
    updateBrushMaterials = vi.fn()
    updateSceneList = vi.fn()
    selectBrush = vi.fn()
    onBrushesChanged = vi.fn()
  })

  function createSystem(overrides = {}) {
    return createImportSystem({
      loadGlbSceneFromFile: vi.fn(),
      loadTextureForSpawn: () => stubTexture,
      pushUndoState,
      updateBrushMaterials,
      updateSceneList,
      selectBrush,
      brushes,
      scene,
      getUseLitMaterials: () => false,
      addImportedLight: vi.fn(),
      showToast: vi.fn(),
      onBrushesChanged,
      setImportLoading: vi.fn(),
      ...overrides,
    })
  }

  it('adds nothing when meshes is empty', () => {
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([])
    expect(scene.children).toHaveLength(0)
    expect(brushes).toHaveLength(0)
    expect(pushUndoState).not.toHaveBeenCalled()
  })

  it('adds box as Brush and pushes to brushes and scene', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'box', subtype: 'maze-wall' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(scene.children).toHaveLength(1)
    expect(brushes).toHaveLength(1)
    expect(brushes[0].userData.type).toBe('box')
    expect(brushes[0].userData.subtype).toBe('maze-wall')
    expect(brushes[0].userData.isBrush).toBe(true)
    expect(brushes[0].userData.isUserBrush).toBe(true)
  })

  it('adds cylinder as Brush with csgOperation preserved', () => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 2, 8),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'cylinder', csgOperation: 'SUBTRACTION' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(brushes).toHaveLength(1)
    expect(brushes[0].userData.type).toBe('cylinder')
    expect(brushes[0].userData.csgOperation).toBe('SUBTRACTION')
  })

  it('adds maze-floor and maze-wall with correct userData subtype', () => {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.2, 10),
      new THREE.MeshBasicMaterial()
    )
    floor.userData = { type: 'box', subtype: 'maze-floor' }
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    )
    wall.userData = { type: 'box', subtype: 'maze-wall' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([floor, wall])
    expect(brushes).toHaveLength(2)
    const subtypes = brushes.map((b) => b.userData.subtype).sort()
    expect(subtypes).toEqual(['maze-floor', 'maze-wall'])
  })

  it('calls onBrushesChanged with callback when provided', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'box' }
    const { addImportedMeshes } = createSystem()
    const onSceneReady = vi.fn()
    addImportedMeshes([mesh], onSceneReady)
    expect(onBrushesChanged).toHaveBeenCalledWith(onSceneReady)
  })

  it('calls pushUndoState, selectBrush(null), updateBrushMaterials, updateSceneList', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'box' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(pushUndoState).toHaveBeenCalledTimes(1)
    expect(selectBrush).toHaveBeenCalledWith(null)
    expect(updateBrushMaterials).toHaveBeenCalledWith(false)
    expect(updateSceneList).toHaveBeenCalledTimes(1)
  })
})
