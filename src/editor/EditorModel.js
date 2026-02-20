/**
 * Central editor state: selection, tool, mode.
 * Single source of truth for the editor UI; notifies subscribers when state changes.
 */

/** @typedef {'translate' | 'rotate' | 'scale' | 'select'} EditorTool */
/** @typedef {'brush' | 'level-builder' | 'floor-plan' | 'skybox'} EditorMode */

export class EditorModel {
  constructor() {
    /** @type {THREE.Object3D | null} */
    this._selectedBrush = null
    /** @type {{ light: THREE.Light, helper: THREE.Object3D | null, type: string } | null} */
    this._selectedLight = null
    /** @type {EditorTool} */
    this._currentTool = 'select'
    /** @type {EditorMode} */
    this._editorMode = 'brush'
    /** @type {Array<() => void>} */
    this._subscribers = []
  }

  get selectedBrush() {
    return this._selectedBrush
  }

  get selectedLight() {
    return this._selectedLight
  }

  get currentTool() {
    return this._currentTool
  }

  get editorMode() {
    return this._editorMode
  }

  /**
   * @param {THREE.Object3D | null} mesh
   */
  setSelection(mesh) {
    if (this._selectedBrush === mesh) return
    this._selectedBrush = mesh
    this._selectedLight = null
    this._notify()
  }

  /**
   * @param {{ light: THREE.Light, helper: THREE.Object3D | null, type: string } | null} entry
   */
  setSelectedLight(entry) {
    if (this._selectedLight === entry) return
    this._selectedLight = entry
    this._selectedBrush = null
    this._notify()
  }

  /**
   * @param {EditorTool} tool
   */
  setTool(tool) {
    if (this._currentTool === tool) return
    this._currentTool = tool
    this._notify()
  }

  /**
   * @param {EditorMode} mode
   */
  setEditorMode(mode) {
    if (this._editorMode === mode) return
    this._editorMode = mode
    this._notify()
  }

  /**
   * @param {() => void} callback
   * @returns {() => void} unsubscribe
   */
  subscribe(callback) {
    this._subscribers.push(callback)
    return () => {
      const i = this._subscribers.indexOf(callback)
      if (i !== -1) this._subscribers.splice(i, 1)
    }
  }

  _notify() {
    this._subscribers.forEach((cb) => cb())
  }
}
