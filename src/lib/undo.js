/**
 * Undo stack factory. Serialize/deserialize are provided by the caller (e.g. level state).
 */

/**
 * @param {{ maxSize: number, serialize: () => unknown, deserialize: (data: unknown) => void }} options
 * @returns {{ push: () => void, undo: () => void }}
 */
export function createUndoStack(options) {
  const { maxSize, serialize, deserialize } = options
  const stack = []

  function push() {
    const state = serialize()
    if (stack.length >= maxSize) stack.shift()
    stack.push(JSON.stringify(state))
  }

  function undo() {
    if (stack.length === 0) return
    const state = JSON.parse(stack.pop())
    deserialize(state)
  }

  return { push, undo }
}
