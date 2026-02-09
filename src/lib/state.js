export const state = {
  brushes: null,
  lights: null,
  selectedBrush: null,
  selectedLight: null,
  scene: null,
  camera: null,
  renderer: null,
  orbitControls: null,
  transformControls: null,
}

export function setState(partial) {
  Object.assign(state, partial)
}
