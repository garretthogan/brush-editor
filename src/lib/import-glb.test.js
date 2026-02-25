import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { createImportSystem } from './import-glb.js'

const stubTexture = {}

vi.mock('./materials.js', () => ({
  getTextureByIndex: () => stubTexture,
  getTextureForImportedMesh: () => stubTexture,
  getTextureWithWorldRepeat: () => stubTexture,
  getRandomDarkTextureIndex: () => 0,
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

  it('adds box as single imported mesh and pushes to brushes and scene', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'box', subtype: 'maze-wall' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(scene.children).toHaveLength(1)
    expect(brushes).toHaveLength(1)
    expect(brushes[0].userData.type).toBe('imported')
    expect(brushes[0].userData.isBrush).toBe(true)
    expect(brushes[0].userData.isUserBrush).toBe(true)
  })

  it('adds cylinder as single imported mesh', () => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 2, 8),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'cylinder', csgOperation: 'SUBTRACTION' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(brushes).toHaveLength(1)
    expect(brushes[0].userData.type).toBe('imported')
  })

  it('adds each mesh as separate imported brush with random Dark texture', () => {
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
    expect(brushes[0].userData.type).toBe('imported')
    expect(brushes[1].userData.type).toBe('imported')
    expect(typeof brushes[0].userData.textureIndex).toBe('number')
    expect(typeof brushes[1].userData.textureIndex).toBe('number')
  })

  it('keeps player_start as separate mesh, adds each other mesh as separate imported brush', () => {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.2, 10),
      new THREE.MeshBasicMaterial()
    )
    floor.userData = { type: 'maze-floor' }
    const start = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    start.userData = { type: 'player_start' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([floor, start])
    expect(brushes).toHaveLength(2)
    const imported = brushes.find((b) => b.userData.type === 'imported')
    const playerStart = brushes.find((b) => b.userData.type === 'player_start')
    expect(imported).toBeDefined()
    expect(playerStart).toBeDefined()
  })

  it('calls onBrushesChanged with callback when provided', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
    mesh.userData = { type: 'imported' }
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
    mesh.userData = { type: 'imported' }
    const { addImportedMeshes } = createSystem()
    addImportedMeshes([mesh])
    expect(pushUndoState).toHaveBeenCalledTimes(1)
    expect(selectBrush).toHaveBeenCalledWith(null)
    expect(updateBrushMaterials).toHaveBeenCalledWith(false)
    expect(updateSceneList).toHaveBeenCalledTimes(1)
  })
})
