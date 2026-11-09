/**
 * Boot sequence: register the `x-view` directive, the stores and
 * the view components, load the persisted config, load the dataset from a
 * `?data=` URL or else IndexedDB, start the router, then start Alpine. The
 * dataset load is awaited before `start()` so the first render already knows
 * whether data exists.
 */
import Alpine from "../vendor/alpine.esm.js";
import { registerConfigStore, snapshot } from "./config.js";
import * as dataset from "./dataset.js";
import * as db from "./db.js";
import { startRouter } from "./router.js";
import { registerViewDirective } from "./view.js";
import { registerCommitsView } from "./views/commits.js";
import { registerConfigView } from "./views/config.js";
import { registerGraphsView } from "./views/graphs.js";
import { importUrl, registerUploadView } from "./views/upload.js";

registerViewDirective(Alpine);
registerUploadView(Alpine);
registerGraphsView(Alpine);
registerCommitsView(Alpine);
registerConfigView(Alpine);

Alpine.store("app", {
  dataVersion: 0,
  projectName: "",
  commitCount: 0,
  firstTime: 0,
  lastTime: 0,
  sizeBytes: 0,
  summary: "",
  bootError: "",
});

registerConfigStore();

// `?data=<url>` loads that dataset, replacing the stored one. The CLI opens
// the page this way. The parameter is dropped afterwards so a reload restores
// from IndexedDB instead of fetching again.
const url = new URL(location.href);
const dataUrl = url.searchParams.get("data");
if (dataUrl !== null) {
  // Alpine has not started yet, so show progress with plain DOM. `x-view`
  // replaces the placeholder with the first view.
  const main = document.querySelector("main");
  if (main !== null) {
    const placeholder = document.createElement("p");
    placeholder.setAttribute("aria-busy", "true");
    placeholder.textContent = `Loading ${dataUrl}…`;
    main.replaceChildren(placeholder);
  }
  try {
    await importUrl(dataUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    /** @type {AppStore} */ (Alpine.store("app")).bootError =
      `Could not load ${dataUrl}: ${reason}.`;
  }
  url.searchParams.delete("data");
  history.replaceState(null, "", url);
}

if (!dataset.hasData()) {
  const record = await db.get();
  if (record !== null) dataset.load(record.data, record.sizeBytes, snapshot());
}

startRouter(Alpine, dataset.hasData);

Alpine.start();
