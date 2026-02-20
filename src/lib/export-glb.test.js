import { describe, it, expect } from 'vitest'
import { buildObjectsToExport } from './export-glb.js'

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
