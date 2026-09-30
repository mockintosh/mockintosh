/**
 * An app process on the web: a module Worker running one app instance. The
 * OS starts it (`createWebAppProcesses`) and sends `start` naming the app.
 */
import { APP_MODULES } from "../../../appModules";
import { runProcess, type ProcessScope } from "./runtime";

runProcess(self as unknown as ProcessScope, async (source) => (await APP_MODULES[source.id]?.())?.default);
