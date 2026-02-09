import { buildExportEntries } from './ui-panels.js'

let _saveGlb = null

export function initExportSystem({ saveGlb }) {
  _saveGlb = saveGlb
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
    if (_saveGlb) {
      await _saveGlb(selected, { filename: 'level.glb' })
    }
  }

  confirm?.addEventListener('click', onConfirm, { once: true })
  cancel?.addEventListener('click', close, { once: true })
}
