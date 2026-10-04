/**
 * Integration ports (Build Master §31). Interfaces only in V1: no
 * implementations, no credentials, no fabricated integrations. Adapters will
 * be added per release once API contracts and credentials exist.
 */

export interface IntegrationConnectionRef {
  companyId: string;
  connectionId: string;
}

/** Microsoft 365 / Outlook (calendar, mail). */
export interface CalendarAdapter {
  listEvents(ref: IntegrationConnectionRef, from: Date, to: Date): Promise<{ id: string; subject: string; start: Date; end: Date }[]>;
}

/** SharePoint / OneDrive document storage. */
export interface DocumentLibraryAdapter {
  upload(ref: IntegrationConnectionRef, path: string, body: Uint8Array, contentType: string): Promise<{ externalId: string }>;
}

/** Accounting / ERP export. */
export interface AccountingExportAdapter {
  exportInvoiceCandidates(ref: IntegrationConnectionRef, payload: unknown): Promise<{ batchId: string }>;
}

/** Payroll export. */
export interface PayrollExportAdapter {
  exportApprovedHours(ref: IntegrationConnectionRef, payload: unknown): Promise<{ batchId: string }>;
}

/** GPS / telematics for equipment. */
export interface TelematicsAdapter {
  latestPositions(ref: IntegrationConnectionRef, assetIds: string[]): Promise<{ assetId: string; lat: number; lon: number; at: Date }[]>;
}

/** Weather (site diary, V2). */
export interface WeatherAdapter {
  daily(lat: number, lon: number, date: Date): Promise<{ summary: string; minC: number; maxC: number }>;
}

/** Maps / geocoding. */
export interface MapsAdapter {
  geocode(address: string): Promise<{ lat: number; lon: number } | null>;
}

/** Power BI / analytics export. */
export interface AnalyticsExportAdapter {
  publishDataset(ref: IntegrationConnectionRef, name: string, rows: Record<string, unknown>[]): Promise<void>;
}
