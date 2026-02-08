/**
 * input-commands — Input handling using the Command pattern
 *
 * Encapsulates user input as Command objects. Each command has an execute(context)
 * method that performs the action. The InputHandler binds input events to commands
 * and invokes them with the editor context.
 *
 * Tool cycle: move → scale → rotate → delete → select → move...
 */

const TOOL_ORDER = ['translate', 'scale', 'rotate']

/**
 * Command base. All commands implement execute(ctx).
 */
class Command {
  execute(ctx) {
    throw new Error('Command.execute() must be implemented')
  }
}

class SetTransformModeCommand extends Command {
  constructor(mode) {
    super()
    this.mode = mode
  }

  execute(ctx) {
    ctx.setCurrentTool(this.mode)
    ctx.setTransformMode(this.mode)
  }
}

class SetSelectModeCommand extends Command {
  execute(ctx) {
    ctx.setCurrentTool('select')
  }
}

class CycleToolCommand extends Command {
  execute(ctx) {
    const current = ctx.getCurrentTool()
    const idx = TOOL_ORDER.indexOf(current)
    const next = TOOL_ORDER[(idx + 1) % TOOL_ORDER.length]
    new SetTransformModeCommand(next).execute(ctx)
  }
}

class CloneOnDragCommand extends Command {
  execute(ctx) {
    if (!ctx.selectedBrush) return
    ctx.pushUndoState()
    const clone = ctx.cloneBrush(ctx.selectedBrush)
    ctx.selectBrush(clone)
  }
}

class SelectBrushCommand extends Command {
  constructor(brush) {
    super()
    this.brush = brush
  }

  execute(ctx) {
    ctx.selectBrush(this.brush)
  }
}

class DeleteSelectedCommand extends Command {
  execute(ctx) {
    ctx.deleteSelected()
  }
}

class UndoCommand extends Command {
  execute(ctx) {
    ctx.undo()
  }
}

/**
 * Captures modifier state for clone-on-drag. Cmd (Mac) or Alt (Windows).
 * Uses pointerdown on the viewport (capture phase) plus keydown/keyup as fallback,
 * since pointer events can be affected by transform control pointer capture.
 */
function createCloneModifierCapturer(viewport) {
  let pointerdownModifier = false
  let keyModifier = false

  document.addEventListener('pointerdown', (e) => {
    if (viewport.contains(e.target)) {
      pointerdownModifier = e.metaKey || e.altKey
    }
  }, true)

  document.addEventListener('pointerup', () => {
    pointerdownModifier = false
  }, true)

  document.addEventListener('pointercancel', () => {
    pointerdownModifier = false
  }, true)

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.altKey) keyModifier = true
  })

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Meta' || e.key === 'Alt') keyModifier = false
  })

  return () => pointerdownModifier || keyModifier
}

/**
 * Creates an InputHandler that binds input events to commands.
 * @param {object} ctx - Editor context (scene, brushes, selectedBrush, etc.)
 * @param {object} [ctx.orbitControls] - OrbitControls (disabled during transform drag)
 * @param {Function} [ctx.onTransformDragEnd] - Called when transform drag ends (e.g. bake scale)
 * @returns {object} Handler for toolbar button commands
 */
export function createInputHandler(ctx) {
  const wasCloneModifierHeld = createCloneModifierCapturer(ctx.viewport)

  ctx.transformControls.addEventListener('dragging-changed', (e) => {
    if (e.value) {
      // Drag start: clone only if Cmd (Mac) or Alt (Windows) was held at pointerdown
      if (wasCloneModifierHeld()) {
        new CloneOnDragCommand().execute(ctx)
      } else {
        ctx.pushUndoState()
      }
      if (ctx.orbitControls) ctx.orbitControls.enabled = false
    } else {
      // Drag end
      if (ctx.orbitControls) ctx.orbitControls.enabled = true
      if (ctx.selectedBrush && ctx.transformControls.getMode() === 'scale') {
        ctx.bakeScaleIntoGeometry(ctx.selectedBrush)
      }
    }
  })

  ctx.viewport.addEventListener('click', (e) => {
    const brush = ctx.pickBrush(e)
    new SelectBrushCommand(brush).execute(ctx)
  })

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement
    const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    if (inInput) return

    if (e.code === 'Space') {
      e.preventDefault()
      new CycleToolCommand().execute(ctx)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      new UndoCommand().execute(ctx)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      new DeleteSelectedCommand().execute(ctx)
    }
  })

  return {
    /** For toolbar buttons that invoke commands */
    setTransformMode: (mode) => new SetTransformModeCommand(mode).execute(ctx),
    deleteSelected: () => new DeleteSelectedCommand().execute(ctx),
  }
}
