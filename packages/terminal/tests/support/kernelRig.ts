import { FileSystem, InMemoryBackend, ROOT_ID } from "@mockintosh/fs";
import { Kernel } from "../../../../src/os/kernel";
import { registerFileOperations } from "../../../../src/os/kernel/files";
import { registerShell } from "../../../../src/os/shell";
import { registerProcesses } from "../../../../src/os/kernel/processes";
import { Cancellation } from "../../../../src/os/kernel/cancellation";
import type { KernelLike } from "../../src/bash/index";

/** A kernel with a disk, S1 and the process table, and a client for it. */
export async function kernelRig() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend() });
  fs.mkdir(ROOT_ID, "Disk", { role: "volume" });
  const kernel = new Kernel();
  registerFileOperations(kernel, fs);
  registerShell(kernel);
  registerProcesses(kernel);
  const caller = kernel.createSession();
  const client: KernelLike = {
    invoke(name, args = {}, options = {}) {
      const token = new Cancellation();
      options.signal?.addEventListener("abort", () => token.cancel(), { once: true });
      return kernel.invoke(caller, name, args, token, { stdout: options.stdout, stderr: options.stderr });
    },
  };
  return { fs, kernel, client, caller };
}

