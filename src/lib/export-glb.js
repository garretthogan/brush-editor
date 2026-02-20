import { buildExportEntries } from './ui-panels.js'

let _saveGlb = null
let _getCsgResultMesh = null
let _getCsgParticipatingSet = null
let _isCsgBrush = null

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
    let objectsToExport = selected

    if (bakeCsg) {
      const resultMesh = _getCsgResultMesh?.() ?? null
      const participating = _getCsgParticipatingSet?.() ?? new Set()
      const hasSelectedCsgBrush = selected.some((obj) => _isCsgBrush(obj))
      objectsToExport = []
      if (resultMesh && hasSelectedCsgBrush) {
        objectsToExport.push(resultMesh)
      }
      // Add brushes that did not participate in the result (rest of maze) so the full level is in the file
      selected.forEach((obj) => {
        if (_isCsgBrush(obj)) {
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
      // Safety: never include subtractive/intersection brushes when bake requested (other apps can't do CSG)
      objectsToExport = objectsToExport.filter(
        (obj) =>
          !_isCsgBrush(obj) ||
          (obj.userData?.csgOperation !== 'SUBTRACTION' && obj.userData?.csgOperation !== 'INTERSECTION')
      )
    }

    await _saveGlb(objectsToExport, { filename: 'level.glb' })
  }

  confirm?.addEventListener('click', onConfirm, { once: true })
  cancel?.addEventListener('click', close, { once: true })
}
