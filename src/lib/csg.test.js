import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import {
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
  CSG_OP_VALUES,
  getCsgOperationConstant,
  getBrushWorldBox,
  evaluateCsg,
} from './csg.js'

describe('getCsgOperationConstant', () => {
  it('returns ADDITION for key ADDITION', () => {
    expect(getCsgOperationConstant('ADDITION')).toBe(ADDITION)
  })
  it('returns SUBTRACTION for key SUBTRACTION', () => {
    expect(getCsgOperationConstant('SUBTRACTION')).toBe(SUBTRACTION)
  })
  it('returns INTERSECTION for key INTERSECTION', () => {
    expect(getCsgOperationConstant('INTERSECTION')).toBe(INTERSECTION)
  })
  it('returns ADDITION for unknown key', () => {
    expect(getCsgOperationConstant('UNKNOWN')).toBe(ADDITION)
  })
  it('returns ADDITION for undefined', () => {
    expect(getCsgOperationConstant(undefined)).toBe(ADDITION)
  })
})

describe('getBrushWorldBox', () => {
  it('returns a Box3 that contains the mesh', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    )
    mesh.position.set(1, 2, 3)
    mesh.updateMatrixWorld(true)
    const box = getBrushWorldBox(mesh)
    expect(box).toBeInstanceOf(THREE.Box3)
    expect(box.min.x).toBeLessThanOrEqual(box.max.x)
    expect(box.containsPoint(new THREE.Vector3(1, 2, 3))).toBe(true)
  })
})

describe('evaluateCsg', () => {
  const isCsgBrush = (m) => m?.userData?.type === 'box' || m?.userData?.type === 'cylinder'
  const getBox = getBrushWorldBox
  let showToast
  let createBrushMaterial
  let resolveBrushTexture
  let resolveBrushTextureInfo
  let evaluator

  beforeEach(() => {
    showToast = vi.fn()
    createBrushMaterial = vi.fn(() => ({}))
    resolveBrushTexture = vi.fn(() => null)
    resolveBrushTextureInfo = vi.fn(() => ({}))
    evaluator = {
      useGroups: false,
      evaluate: vi.fn(),
    }
  })

  function makeDummyResultMesh() {
    const geom = new THREE.BufferGeometry()
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.drawRange = { start: 0, count: 3 }
    const mesh = new THREE.Mesh(geom, null)
    mesh.visible = true
    return mesh
  }

  it('returns resultMesh null and empty csgParticipating when no subtractions or intersections', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), null)
    wall.userData = { type: 'box', isUserBrush: true, csgOperation: 'ADDITION' }
    const brushes = [wall]
    const out = evaluateCsg({
      brushes,
      isCsgBrush,
      getBrushWorldBox: getBox,
      evaluator,
      createBrushMaterial,
      resolveBrushTexture,
      resolveBrushTextureInfo,
      useLitMaterials: false,
      showToast,
    })
    expect(out).not.toBeUndefined()
    expect(out.resultMesh).toBeNull()
    expect(out.restoreVisibility).toBeTypeOf('function')
    expect(out.csgParticipating.size).toBe(0)
  })

  it('returns resultMesh null when subtractions exist but no baseCandidates', () => {
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 8), null)
    cylinder.position.set(0, 0, 0)
    cylinder.updateMatrixWorld(true)
    cylinder.userData = { type: 'cylinder', isUserBrush: true, csgOperation: 'SUBTRACTION' }
    const brushes = [cylinder]
    const out = evaluateCsg({
      brushes,
      isCsgBrush,
      getBrushWorldBox: getBox,
      evaluator,
      createBrushMaterial,
      resolveBrushTexture,
      resolveBrushTextureInfo,
      useLitMaterials: false,
      showToast,
    })
    expect(out).not.toBeUndefined()
    expect(out.resultMesh).toBeNull()
    expect(out.csgParticipating.size).toBe(0)
  })

  it('returns resultMesh and csgParticipating when baseCandidates and subtractions exist', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), null)
    wall.position.set(0, 0, 0)
    wall.updateMatrixWorld(true)
    wall.userData = { type: 'box', subtype: 'maze-wall', isUserBrush: true, csgOperation: 'ADDITION' }

    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 8), null)
    cylinder.position.set(0, 0, 0)
    cylinder.updateMatrixWorld(true)
    cylinder.userData = { type: 'cylinder', isUserBrush: true, csgOperation: 'SUBTRACTION' }

    const resultMesh = makeDummyResultMesh()
    evaluator.evaluate.mockReturnValue(resultMesh)

    const brushes = [wall, cylinder]
    const out = evaluateCsg({
      brushes,
      isCsgBrush,
      getBrushWorldBox: getBox,
      evaluator,
      createBrushMaterial,
      resolveBrushTexture,
      resolveBrushTextureInfo,
      useLitMaterials: false,
      showToast,
    })

    expect(out).not.toBeUndefined()
    expect(out.resultMesh).toBe(resultMesh)
    expect(out.restoreVisibility).toBeTypeOf('function')
    expect(out.csgParticipating).toBeInstanceOf(Set)
    expect(out.csgParticipating.has(wall)).toBe(true)
    expect(out.csgParticipating.has(cylinder)).toBe(true)
    expect(out.csgParticipating.size).toBe(2)
  })

  it('excludes maze-floor from csgParticipating when it intersects opBox', () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), null)
    floor.position.set(0, 0, 0)
    floor.updateMatrixWorld(true)
    floor.userData = { type: 'box', subtype: 'maze-floor', isUserBrush: false }

    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), null)
    wall.position.set(0, 0, 0)
    wall.updateMatrixWorld(true)
    wall.userData = { type: 'box', subtype: 'maze-wall', isUserBrush: false }

    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 8), null)
    cylinder.position.set(0, 0, 0)
    cylinder.updateMatrixWorld(true)
    cylinder.userData = { type: 'cylinder', isUserBrush: true, csgOperation: 'SUBTRACTION' }

    const resultMesh = makeDummyResultMesh()
    evaluator.evaluate.mockReturnValue(resultMesh)

    const brushes = [floor, wall, cylinder]
    const out = evaluateCsg({
      brushes,
      isCsgBrush,
      getBrushWorldBox: getBox,
      evaluator,
      createBrushMaterial,
      resolveBrushTexture,
      resolveBrushTextureInfo,
      useLitMaterials: false,
      showToast,
    })

    expect(out.resultMesh).toBe(resultMesh)
    expect(out.csgParticipating.has(floor)).toBe(false)
    expect(out.csgParticipating.has(wall)).toBe(true)
    expect(out.csgParticipating.has(cylinder)).toBe(true)
  })
})
