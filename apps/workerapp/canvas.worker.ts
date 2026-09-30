/** Canvas, unchanged, running in its own Worker. The host window is `apps/CanvasWorker.tsx`. */
import Canvas from "../Canvas";
import { runWorkerApp } from "./runtime";

runWorkerApp(Canvas);
