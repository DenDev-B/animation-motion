import type { ProjectV1 } from '../engine/project.ts';

export class EditorHistory {
  private undoStack: ProjectV1[] = [];
  private redoStack: ProjectV1[] = [];
  private current: ProjectV1;
  private lastLabel = '';
  private lastPushAt = 0;
  private readonly limit: number;
  private readonly debounceMs: number;
  constructor(initial: ProjectV1, limit = 100, debounceMs = 400) {
    this.limit = limit;
    this.debounceMs = debounceMs;
    this.current = structuredClone(initial);
  }
  push(label: string, project: ProjectV1): void {
    const now = Date.now();
    if (label === this.lastLabel && now - this.lastPushAt <= this.debounceMs) {
      this.current = structuredClone(project);
    } else {
      this.undoStack.push(this.current);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.current = structuredClone(project);
    }
    this.lastLabel = label;
    this.lastPushAt = now;
    this.redoStack = [];
  }
  undo(): ProjectV1 | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(this.current);
    this.current = structuredClone(previous);
    this.lastLabel = '';
    return structuredClone(this.current);
  }
  redo(): ProjectV1 | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(this.current);
    this.current = structuredClone(next);
    this.lastLabel = '';
    return structuredClone(this.current);
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
