/**
 * The printer drivers this Macintosh knows: the built-ins from
 * `@mockintosh/print`, plus one JSON file per user driver in
 * System Folder › Extensions › Printer Drivers. A user driver with a built-in's
 * id replaces it, so a built-in can be adjusted by saving a copy.
 */
import { createSignal } from "solid-js";
import { fitName, type FileSystem } from "@mockintosh/fs";
import {
  BUILTIN_PRINTER_DRIVERS,
  parsePrinterDriverText,
  printerDriverToJSON,
  type PrinterDriver,
} from "@mockintosh/print";

export type PrinterDriverSource = "built-in" | "file";

export interface CatalogDriver {
  driver: PrinterDriver;
  source: PrinterDriverSource;
  /** The file it came from, for `source: "file"`. */
  fileName?: string;
}

/** A file in Printer Drivers that isn't a valid driver. */
export interface PrinterDriverProblem {
  fileName: string;
  message: string;
}

export interface PrinterDriverCatalog {
  /** Every driver, built-ins first. Reactive. */
  entries(): readonly CatalogDriver[];
  drivers(): readonly PrinterDriver[];
  get(id: string): CatalogDriver | undefined;
  /** Driver files that couldn't be read. Reactive. */
  problems(): readonly PrinterDriverProblem[];
  /** Write `driver` as a file (replacing one with the same id); resolves once the catalog has it. */
  save(driver: PrinterDriver): Promise<string>;
  /** Resolves once pending file changes have been read. */
  settled(): Promise<void>;
  shutdown(): void;
}

/** A file name for a driver: its name, minus characters file names can't have, cut to fit. */
export function driverFileName(driver: PrinterDriver): string {
  const base = driver.name.replace(/[/:]/g, "-").trim() || driver.id;
  return fitName(`${base}.json`);
}

export async function createPrinterDriverCatalog(fs: FileSystem): Promise<PrinterDriverCatalog> {
  const builtIns: CatalogDriver[] = BUILTIN_PRINTER_DRIVERS.map((driver) => ({ driver, source: "built-in" }));
  const [files, setFiles] = createSignal<CatalogDriver[]>([]);
  const [problems, setProblems] = createSignal<PrinterDriverProblem[]>([]);
  const folder = () => fs.locate("printer-drivers");

  let observed = "";
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();

  async function refresh(): Promise<void> {
    const dir = folder();
    const nodes = dir ? fs.children(dir.id).filter((n) => n.kind === "file" && n.name.endsWith(".json")) : [];
    const key = nodes.map((n) => `${n.id}:${n.revision}`).join(",");
    if (key === observed) return;
    observed = key;
    const found: CatalogDriver[] = [];
    const broken: PrinterDriverProblem[] = [];
    for (const node of nodes) {
      try {
        const driver = parsePrinterDriverText((await fs.readText(node.id)) ?? "");
        found.push({ driver, source: "file", fileName: node.name });
      } catch (error) {
        broken.push({ fileName: node.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (stopped) return;
    setFiles(found);
    setProblems(broken);
  }

  const unsubscribe = fs.subscribe(() => {
    pending = pending.then(refresh);
  });
  await refresh();

  const entries = (): CatalogDriver[] => {
    const user = files();
    const overridden = new Set(user.map((e) => e.driver.id));
    return [...builtIns.filter((e) => !overridden.has(e.driver.id)), ...user];
  };

  return {
    entries,
    drivers: () => entries().map((e) => e.driver),
    get: (id) => entries().find((e) => e.driver.id === id),
    problems,
    async save(driver) {
      const dir = folder();
      if (!dir) throw new Error("The Printer Drivers folder is missing");
      const previous = files().find((e) => e.driver.id === driver.id)?.fileName;
      // A new driver must not replace another's file under a shortened name.
      const name = previous ?? fs.availableName(dir.id, driverFileName(driver));
      await fs.writeFile(dir.id, name, JSON.stringify(printerDriverToJSON(driver), null, 2) + "\n", {
        type: "application/json",
      });
      await fs.flush();
      pending = pending.then(refresh);
      await pending;
      return name;
    },
    settled: () => pending,
    shutdown() {
      stopped = true;
      unsubscribe();
    },
  };
}
