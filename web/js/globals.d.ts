declare const Chart: typeof import("chart.js").Chart;

/** The small reactive values in `$store.app`. */
interface AppStore {
  dataVersion: number;
  projectName: string;
  commitCount: number;
  firstTime: number;
  lastTime: number;
  sizeBytes: number;
  summary: string;
  /** Why the `?data=` dataset could not be loaded at boot, or "". */
  bootError: string;
}

/** `$store.config`: the `Config` shape plus its actions. */
interface ConfigStore extends Config {
  save(): void;
  reset(): void;
}

/** What `js/db.js` stores under its single key. */
interface DatasetRecord {
  data: GitStatData;
  sizeBytes: number;
}
