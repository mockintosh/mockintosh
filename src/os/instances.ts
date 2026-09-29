import {Lifetime} from "./kernel/lifetime";
/** Actual app launches own windows and registered cleanup. The window store
 * remains authoritative for window geometry and rendering. */
export interface InstanceError {
  at: number;
  message: string;
  source: string;
}

export class AppInstances {
  private records = new Map<string, {id: string; app: string; build?: string; windows: Set<string>; retained: number; lifetime: Lifetime; error?: string; errors: InstanceError[]; kernelCaller?: {id: string; instance: string; generation: number}}>();
  private next = 0;
  constructor(private closeWindow: (id: string) => void) {}
  create(app: string, build?: string): string {
    const id = `instance-${++this.next}`;
    this.records.set(id, {id, app, build, windows: new Set(), retained: 0, lifetime: new Lifetime(), errors: []});
    return id;
  }
  alive(id: string) { return this.records.has(id) && !this.records.get(id)!.lifetime.closed; }
  finishOpen(id: string) { const record = this.records.get(id); if (record && !record.windows.size && !record.retained) this.stop(id); }
  retain(id: string): () => void {
    const record = this.records.get(id);
    if (!record || record.lifetime.closed) throw new Error("App instance ended");
    record.retained++;
    let released = false;
    return () => { if (released) return; released = true; record.retained--; this.finishOpen(id); };
  }
  kernelCaller(id: string) { return this.records.get(id)?.kernelCaller; }
  setKernelCaller(id: string, caller: {id: string; instance: string; generation: number}) {
    const record = this.records.get(id);
    if (record) record.kernelCaller = caller;
  }
  /** Run `cleanup` when the instance ends; the returned function withdraws it (the resource ended first). */
  own(id: string, cleanup: () => void): () => void {
    const record = this.records.get(id);
    if (!record || record.lifetime.closed) { cleanup(); return () => {}; }
    return record.lifetime.own(cleanup);
  }
  addWindow(id: string, window: string) {
    const record = this.records.get(id);
    if (!record || record.lifetime.closed) throw new Error("App instance ended");
    record.windows.add(window);
  }
  removeWindow(window: string) {
    for (const record of this.records.values()) if (record.windows.delete(window) && !record.windows.size && !record.retained) this.stop(record.id);
  }
  note(id: string, error: unknown, source = "handler") {
    const record = this.records.get(id);
    if (!record) return;
    const message = error instanceof Error ? error.message : String(error);
    record.error = message;
    record.errors.push({ at: Date.now(), message, source });
  }
  fail(id: string, error: unknown) {
    const record = this.records.get(id);
    if (record) {
      this.note(id, error, "boundary");
      record.lifetime.close();
    }
  }
  errors(instance?: string) {
    const rows: { instance: string; at: number; message: string; source: string }[] = [];
    for (const record of this.records.values()) {
      if (instance && record.id !== instance) continue;
      for (const entry of record.errors) rows.push({ instance: record.id, ...entry });
    }
    return rows;
  }
  list() { return [...this.records.values()].map(({id, app, build, windows, error}) => ({id, app, build, windows: [...windows], error})); }
  stop(id: string) {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    record.lifetime.close();
    for (const window of record.windows) this.closeWindow(window);
  }
  stopApp(app: string) { for (const record of [...this.records.values()]) if (record.app === app) this.stop(record.id); }
  close() { for (const id of [...this.records.keys()]) this.stop(id); }
}
