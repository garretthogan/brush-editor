/**
 * Editor controller: wires UI and input to the model and to 3D/entity operations.
 * Button handlers call the provided actions; the model is updated by those actions
 * and the view refreshes via model subscriptions.
 */

export class EditorController {
  /**
   * @param {{
   *   inputHandler?: { setTransformMode: (mode: string) => void, deleteSelected: () => void },
   *   onIncludeInCsg?: () => void,
   *   onGenerateMaze?: () => void,
   *   onIterateMaze?: () => void,
   *   onSaveLevel?: () => void,
   *   onLoadLevel?: () => void,
   *   onExportCancel?: () => void,
   * }} actions
   */
  constructor(actions = {}) {
    this._inputHandler = actions.inputHandler ?? null
    this._onIncludeInCsg = actions.onIncludeInCsg ?? (() => {})
    this._onGenerateMaze = actions.onGenerateMaze ?? (() => {})
    this._onIterateMaze = actions.onIterateMaze ?? (() => {})
    this._onSaveLevel = actions.onSaveLevel ?? (() => {})
    this._onLoadLevel = actions.onLoadLevel ?? (() => {})
    this._onExportCancel = actions.onExportCancel ?? (() => {})
  }

  /**
   * Wire editor button click handlers. Call once after DOM is ready.
   */
  wire() {
    const btnMove = document.getElementById('btn-move')
    const btnRotate = document.getElementById('btn-rotate')
    const btnScale = document.getElementById('btn-scale')
    const btnDelete = document.getElementById('btn-delete')
    const btnIncludeInCsg = document.getElementById('btn-include-in-csg')
    const btnGenerateMaze = document.getElementById('btn-generate-maze')
    const btnIterateMaze = document.getElementById('btn-iterate-maze')
    const btnSave = document.getElementById('btn-save')
    const btnLoad = document.getElementById('btn-load')
    const btnExportCancel = document.getElementById('btn-export-cancel')

    if (btnMove && this._inputHandler) btnMove.addEventListener('click', () => this._inputHandler.setTransformMode('translate'))
    if (btnRotate && this._inputHandler) btnRotate.addEventListener('click', () => this._inputHandler.setTransformMode('rotate'))
    if (btnScale && this._inputHandler) btnScale.addEventListener('click', () => this._inputHandler.setTransformMode('scale'))
    if (btnDelete && this._inputHandler) btnDelete.addEventListener('click', () => this._inputHandler.deleteSelected())
    if (btnIncludeInCsg) btnIncludeInCsg.addEventListener('click', () => this._onIncludeInCsg())
    if (btnGenerateMaze) btnGenerateMaze.addEventListener('click', () => this._onGenerateMaze())
    if (btnIterateMaze) btnIterateMaze.addEventListener('click', () => this._onIterateMaze())
    if (btnSave) btnSave.addEventListener('click', () => this._onSaveLevel())
    if (btnLoad) btnLoad.addEventListener('click', () => this._onLoadLevel())
    if (btnExportCancel) btnExportCancel.addEventListener('click', () => this._onExportCancel())
  }
}
