export type ReportPolicy = "always" | "critical_only";
export type RunMode = "validate_only" | "send";
export type RunStatus = "running" | "succeeded" | "failed" | "delivery_unknown";
export type DeliveryStatus = "not_requested" | "skipped" | "sent" | "failed" | "unknown";

export interface AlertThresholds {
  criticalDays: number;
  urgentDays: number;
  warningDays: number;
}

export interface RetentionConfig {
  rawDays: number;
  logDays: number;
  diagnosticDays: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  timeZone: string;
  catchUpHours: number;
  checkIntervalSeconds: number;
}

export interface CallbackConfig {
  enabled: boolean;
}

export interface AutomationConfig {
  schemaVersion: 1;
  businessTimeZone: string;
  reportPolicy: ReportPolicy | null;
  minRows: number;
  continuityOverlap: number;
  maxReportRows: number;
  alertThresholds: AlertThresholds;
  retention: RetentionConfig;
  schedule: ScheduleConfig;
  callback: CallbackConfig;
}

export interface InventoryRow {
  sourceDate: string;
  sku: string;
  name: string;
  externalProductId: string;
  beginning: number;
  inbound: number;
  outbound: number;
  ending: number;
  near30DaysSales: number;
}

export interface ValidationResult {
  ok: boolean;
  status: "valid" | "invalid";
  file: string;
  sourceDate: string;
  expectedSourceDate: string;
  rowCount: number;
  skuCount: number;
  totalQuantity: number;
  invalidFormulaCount: number;
  invalidNumberCount: number;
  duplicateCount: number;
  overlapCount: number;
  errors: string[];
  warnings: string[];
  rows: InventoryRow[];
}

export type AlertLevel = "critical" | "urgent" | "warning" | "ok";

export interface InventoryReportItem extends InventoryRow {
  sellableDays: number | null;
  alertLevel: AlertLevel;
  alertText: string;
}

export interface InventoryReport {
  sourceDate: string;
  generatedAt: string;
  skuCount: number;
  totalQuantity: number;
  criticalCount: number;
  urgentCount: number;
  warningCount: number;
  shouldNotify: boolean;
  title: string;
  markdown: string;
  items: InventoryReportItem[];
}

export interface DeliveryResult {
  status: DeliveryStatus;
  reason?: string;
  responseCode?: number;
  destinationFingerprint?: string;
  deliveredAt?: string;
}

export interface RunRequest {
  mode?: RunMode;
  queryDate?: string;
  inputFile?: string;
  forceSend?: boolean;
  acceptanceLabel?: string;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  mode: RunMode;
  queryDate: string;
  expectedSourceDate: string;
  sourceDate: string;
  startedAt: string;
  completedAt: string;
  sourceFile: string;
  sourceFileSha256: string;
  reportHash: string;
  rowCount: number;
  totalQuantity: number;
  validation: ValidationResult;
  report: InventoryReport | null;
  delivery: DeliveryResult;
  callback: DeliveryResult;
  error?: string;
}

export interface RetryDeliveryResult {
  runId: string;
  status: "succeeded" | "failed" | "delivery_unknown";
  delivery: DeliveryResult;
  callback: DeliveryResult;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  required: boolean;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ready: boolean;
  platform: string;
  architecture: string;
  appRoot: string;
  checks: DoctorCheck[];
}

export interface AutomationStatus {
  configured: boolean;
  ready: boolean;
  lastRun: RunResult | null;
  schedule: ScheduleConfig & { installed: boolean };
  activeRun: { runId: string; startedAt: string } | null;
}

export interface AutomationDependencies {
  appRoot?: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  secretStore?: SecretStore;
  browserRunner?: (request: BrowserWorkerRequest) => Promise<BrowserWorkerResult>;
}

export interface SecretStore {
  get(account: string): Promise<string>;
  set(account: string, value: string): Promise<void>;
  remove(account: string): Promise<void>;
}

export interface BrowserWorkerRequest {
  action: "login" | "export";
  queryDate?: string;
  outputDir?: string;
  profileDir: string;
  storageStateFile: string;
  diagnosticsDir: string;
}

export interface BrowserWorkerResult {
  ok: boolean;
  action: "login" | "export";
  loggedIn: boolean;
  file?: string;
  pageUrl?: string;
  stage?: string;
  message: string;
}
