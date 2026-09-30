/** Showreel, unchanged, running in its own Worker. The host window is `apps/ShowreelWorker.tsx`. */
import Showreel from "../Showreel";
import { runWorkerApp } from "./runtime";

runWorkerApp(Showreel);
