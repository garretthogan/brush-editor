import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildExportEntries } from './ui-panels.js'

let _saveGlb = null
let _getCsgResultMesh = null
let _getCsgParticipatingSet = null
let _isCsgBrush = null

/**
 * Transform geometry positions and normals by mesh world matrix (in place).
 */
function transformGeometryToWorld(geom, matrixWorld) {
  const pos = geom.attributes.position
  const normalAttr = geom.attributes.normal
  if (!pos) return
  const count = pos.count
  const _v = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld)
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
    pos.setXYZ(i, _v.x, _v.y, _v.z)
    if (normalAttr) {
      _v.fromBufferAttribute(normalAttr, i).transformDirection(normalMatrix).normalize()
      normalAttr.setXYZ(i, _v.x, _v.y, _v.z)
    }
  }
  pos.needsUpdate = true
  if (normalAttr) normalAttr.needsUpdate = true
}

/**
 * When Bake CSG is checked but there is no CSG result (e.g. only additive brushes), merge all
 * mesh objects into one so the level loads back as one piece. Non-meshes (lights, etc.) are kept.
 * @param {object[]} objects - From buildObjectsToExport (meshes + optional lights)
 * @returns {object[]} One merged mesh plus any non-mesh objects
 */
export function mergeBakedMeshes(objects) {
  const meshes = objects.filter((o) => o?.isMesh && o?.geometry?.attributes?.position)
  const rest = objects.filter((o) => !o?.isMesh || !o?.geometry?.attributes?.position)
  if (meshes.length <= 1) return objects
  const geometries = []
  for (const mesh of meshes) {
    const geom = mesh.geometry.clone()
    mesh.updateWorldMatrix(true, false)
    transformGeometryToWorld(geom, mesh.matrixWorld)
    geometries.push(geom)
  }
  const merged = mergeGeometries(geometries)
  geometries.forEach((g) => g.dispose())
  if (!merged) return objects
  // Use the first mesh that has a material with a texture so the exported GLB embeds it (not grey).
  const withMap = (m) => {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    return mat?.map && (mat.map.image || mat.map.isDataTexture)
  }
  const donor = meshes.find(withMap) ?? meshes[0]
  const material = Array.isArray(donor.material) ? donor.material[0].clone() : donor.material?.clone()
  const mergedMesh = new THREE.Mesh(merged, material ?? new THREE.MeshBasicMaterial({ color: 0x888888 }))
  mergedMesh.name = 'level'
  return [mergedMesh, ...rest]
}

/**
 * Build the list of objects to export. Pure function for testing.
 * @param {object[]} selected - Checked export entries (objects/lights)
 * @param {boolean} bakeCsg - Whether "Bake CSG" is checked
 * @param {() => object | null} getCsgResultMesh
 * @param {() => Set<object>} getCsgParticipatingSet
 * @param {(obj: object) => boolean} isCsgBrush
 * @returns {object[]}
 */
export function buildObjectsToExport(
  selected,
  bakeCsg,
  getCsgResultMesh,
  getCsgParticipatingSet,
  isCsgBrush
) {
  if (!bakeCsg) return [...selected]
  const resultMesh = getCsgResultMesh?.() ?? null
  const participating = getCsgParticipatingSet?.() ?? new Set()
  const hasSelectedCsgBrush = selected.some((obj) => isCsgBrush(obj))
  let objectsToExport = []
  if (resultMesh && hasSelectedCsgBrush) {
    objectsToExport.push(resultMesh)
  }
  selected.forEach((obj) => {
    if (isCsgBrush(obj)) {
      if (participating.has(obj)) {
        // Already represented by the baked result mesh
      } else if (
        obj.userData?.csgOperation === 'SUBTRACTION' ||
        obj.userData?.csgOperation === 'INTERSECTION'
      ) {
        // Never export subtractive/intersection as solid meshes when bake requested
      } else {
        objectsToExport.push(obj)
      }
    } else {
      objectsToExport.push(obj)
    }
  })
  return objectsToExport.filter(
    (obj) =>
      !isCsgBrush(obj) ||
      (obj.userData?.csgOperation !== 'SUBTRACTION' && obj.userData?.csgOperation !== 'INTERSECTION')
  )
}

export function initExportSystem({ saveGlb, getCsgResultMesh, getCsgParticipatingSet, isCsgBrush }) {
  _saveGlb = saveGlb
  _getCsgResultMesh = getCsgResultMesh ?? (() => null)
  _getCsgParticipatingSet = getCsgParticipatingSet ?? (() => new Set())
  _isCsgBrush = isCsgBrush ?? (() => false)
}

export function openExportModal() {
  const modal = document.getElementById('export-modal')
  const list = document.getElementById('export-list')
  if (!modal || !list) return
  list.innerHTML = ''

  const { groups, loose, lights: lightEntries } = buildExportEntries()
  const itemMap = new Map()

  const makeItem = (entry) => {
    const label = document.createElement('label')
    label.className = 'export-item'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = entry.type !== 'light'
    const span = document.createElement('span')
    span.textContent = entry.label
    label.appendChild(input)
    label.appendChild(span)
    itemMap.set(input, entry)
    return { label, input }
  }

  const updateGroupState = (groupInput, childInputs) => {
    const checkedCount = childInputs.filter((c) => c.checked).length
    groupInput.indeterminate = checkedCount > 0 && checkedCount < childInputs.length
    groupInput.checked = checkedCount === childInputs.length
  }

  if (groups.size > 0 || loose.length > 0) {
    const section = document.createElement('div')
    section.className = 'export-label'
    section.textContent = 'Objects'
    list.appendChild(section)
  }

  Array.from(groups.keys()).sort().forEach((groupId) => {
    const details = document.createElement('details')
    details.className = 'export-group'
    details.open = false
    const summary = document.createElement('summary')
    const summaryLabel = document.createElement('label')
    summaryLabel.className = 'export-label'
    const summaryInput = document.createElement('input')
    summaryInput.type = 'checkbox'
    summaryInput.checked = true
    const summaryText = document.createElement('span')
    summaryText.textContent = groupId
    summaryLabel.appendChild(summaryInput)
    summaryLabel.appendChild(summaryText)
    summary.appendChild(summaryLabel)
    details.appendChild(summary)
    const itemsWrap = document.createElement('div')
    itemsWrap.className = 'export-items'
    const childInputs = []
    groups.get(groupId).forEach((entry) => {
      const { label, input } = makeItem(entry)
      childInputs.push(input)
      itemsWrap.appendChild(label)
      input.addEventListener('change', () => updateGroupState(summaryInput, childInputs))
    })
    summaryInput.addEventListener('change', () => {
      childInputs.forEach((input) => {
        input.checked = summaryInput.checked
      })
      updateGroupState(summaryInput, childInputs)
    })
    updateGroupState(summaryInput, childInputs)
    details.appendChild(itemsWrap)
    list.appendChild(details)
  })

  loose.forEach((entry) => {
    list.appendChild(makeItem(entry).label)
  })

  if (lightEntries.length > 0) {
    const section = document.createElement('div')
    section.className = 'export-label'
    section.textContent = 'Lights'
    list.appendChild(section)
  }

  lightEntries.forEach((entry) => {
    list.appendChild(makeItem(entry).label)
  })

  modal.classList.remove('hidden')

  const confirm = document.getElementById('btn-export-confirm')
  const cancel = document.getElementById('btn-export-cancel')
  const close = () => modal.classList.add('hidden')

  const onConfirm = async () => {
    const selected = []
    itemMap.forEach((entry, input) => {
      if (input.checked && entry.object) selected.push(entry.object)
    })
    close()
    if (selected.length === 0) return
    if (!_saveGlb) return

    const bakeCsg = document.getElementById('export-bake-csg')?.checked === true
    let objectsToExport = buildObjectsToExport(
      selected,
      bakeCsg,
      _getCsgResultMesh,
      _getCsgParticipatingSet,
      _isCsgBrush
    )
    if (bakeCsg && objectsToExport.length > 1) {
      objectsToExport = mergeBakedMeshes(objectsToExport)
    }
    await _saveGlb(objectsToExport, { filename: 'level.glb' })
  }

  confirm?.addEventListener('click', onConfirm, { once: true })
  cancel?.addEventListener('click', close, { once: true })
}
