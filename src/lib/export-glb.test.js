import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { buildObjectsToExport, mergeBakedMeshes } from './export-glb.js'

describe('buildObjectsToExport', () => {
  const getNull = () => null
  const getEmptySet = () => new Set()
  const isCsgBrush = (obj) => obj.isCsgBrush === true

  it('returns selected when bakeCsg is false', () => {
    const selected = [{ id: 1 }, { id: 2 }]
    const out = buildObjectsToExport(selected, false, getNull, getEmptySet, isCsgBrush)
    expect(out).toEqual(selected)
    expect(out).not.toBe(selected)
  })

  it('bake on: no result mesh, no CSG in selected returns only non-CSG objects', () => {
    const light = { isCsgBrush: false }
    const selected = [light]
    const out = buildObjectsToExport(selected, true, getNull, getEmptySet, isCsgBrush)
    expect(out).toEqual([light])
  })

  it('bake on: result mesh + hasSelectedCsgBrush returns resultMesh and non-participating non-CSG', () => {
    const resultMesh = { name: 'resultMesh' }
    const wall = { isCsgBrush: true, userData: { csgOperation: 'ADDITION' } }
    const light = { isCsgBrush: false }
    const participating = new Set([wall])
    const getResult = () => resultMesh
    const getParticipating = () => participating
    const selected = [wall, light]
    const out = buildObjectsToExport(selected, true, getResult, getParticipating, isCsgBrush)
    expect(out).toContain(resultMesh)
    expect(out).toContain(light)
    expect(out).not.toContain(wall)
    expect(out).toHaveLength(2)
  })

  it('bake on: one wall in participating, one wall not → result mesh + non-participating wall only', () => {
    const resultMesh = { name: 'resultMesh' }
    const wall1 = { isCsgBrush: true, userData: { csgOperation: 'ADDITION' } }
    const wall2 = { isCsgBrush: true, userData: { csgOperation: 'ADDITION' } }
    const participating = new Set([wall1])
    const selected = [wall1, wall2]
    const out = buildObjectsToExport(
      selected,
      true,
      () => resultMesh,
      () => participating,
      isCsgBrush
    )
    expect(out).toContain(resultMesh)
    expect(out).toContain(wall2)
    expect(out).not.toContain(wall1)
    expect(out).toHaveLength(2)
  })

  it('bake on: subtractive brush in selected is never in returned array', () => {
    const resultMesh = { name: 'resultMesh' }
    const cylinder = {
      isCsgBrush: true,
      userData: { csgOperation: 'SUBTRACTION' },
    }
    const participating = new Set()
    const selected = [cylinder]
    const out = buildObjectsToExport(
      selected,
      true,
      () => resultMesh,
      () => participating,
      isCsgBrush
    )
    expect(out).not.toContain(cylinder)
    expect(out).toContain(resultMesh)
    expect(out).toHaveLength(1)
  })

  it('bake on: intersection brush is filtered out', () => {
    const resultMesh = { name: 'resultMesh' }
    const brush = {
      isCsgBrush: true,
      userData: { csgOperation: 'INTERSECTION' },
    }
    const out = buildObjectsToExport(
      [brush],
      true,
      () => resultMesh,
      () => new Set(),
      isCsgBrush
    )
    expect(out).not.toContain(brush)
    expect(out).toContain(resultMesh)
  })
})

describe('mergeBakedMeshes', () => {
  it('returns same array when 0 or 1 mesh', () => {
    const light = {}
    expect(mergeBakedMeshes([])).toEqual([])
    expect(mergeBakedMeshes([light])).toEqual([light])
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const one = mergeBakedMeshes([mesh])
    expect(one).toHaveLength(1)
    expect(one[0]).toBe(mesh)
  })

  it('merges multiple meshes into one and keeps non-meshes', () => {
    const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh1.position.set(0, 0, 0)
    const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh2.position.set(2, 0, 0)
    const light = { isLight: true }
    const out = mergeBakedMeshes([mesh1, mesh2, light])
    expect(out).toHaveLength(2)
    expect(out[0].isMesh).toBe(true)
    expect(out[0].geometry.attributes.position.count).toBeGreaterThan(0)
    expect(out[1]).toBe(light)
  })
})
