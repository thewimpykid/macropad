import type { MacroPanel, CalendarEventPayload } from "@/lib/macroData";

/**
 * FRED release IDs, verified directly against the live FRED API (not
 * guessed) - each maps to the FRED series this board already tracks for
 * that release, so the Calendar page can link an upcoming print straight
 * to its indicator's current reading.
 */
export interface ReleaseDef {
  id: string;
  label: string;
  fredReleaseId: number;
  relatedIndicatorId: string;
  /** Rough market-moving weight - CPI/NFP/GDP/Core PCE move markets outright; weekly claims and M2 rarely do on their own. */
  importance: "high" | "medium" | "low";
}

export const RELEASES: ReleaseDef[] = [
  { id: "cpi", label: "CPI / Core CPI", fredReleaseId: 10, relatedIndicatorId: "us-macro:cpi-yoy", importance: "high" },
  { id: "core-pce", label: "Core PCE (Fed's target metric)", fredReleaseId: 54, relatedIndicatorId: "us-macro:core-pce", importance: "high" },
  { id: "employment", label: "Employment Situation (NFP + Unemployment)", fredReleaseId: 50, relatedIndicatorId: "us-macro:payrolls", importance: "high" },
  { id: "gdp", label: "GDP", fredReleaseId: 53, relatedIndicatorId: "us-macro:gdp", importance: "high" },
  { id: "retail-sales", label: "Retail Sales", fredReleaseId: 9, relatedIndicatorId: "us-macro:retail-sales", importance: "medium" },
  { id: "housing-starts", label: "Housing Starts", fredReleaseId: 27, relatedIndicatorId: "us-macro:housing-starts", importance: "low" },
  { id: "industrial-production", label: "Industrial Production", fredReleaseId: 13, relatedIndicatorId: "us-macro:industrial-production", importance: "low" },
  { id: "consumer-sentiment", label: "Consumer Sentiment", fredReleaseId: 91, relatedIndicatorId: "us-macro:consumer-sentiment", importance: "medium" },
  { id: "jobless-claims", label: "Jobless Claims", fredReleaseId: 180, relatedIndicatorId: "us-macro:jobless-claims", importance: "low" },
  { id: "m2", label: "M2 Money Stock", fredReleaseId: 21, relatedIndicatorId: "us-macro:m2", importance: "low" },
  { id: "h41", label: "H.4.1 Fed Balance Sheet", fredReleaseId: 20, relatedIndicatorId: "us-macro:h41-balance-sheet", importance: "medium" },
];

export function getCalendarEvents(panels: MacroPanel[]): CalendarEventPayload[] {
  const series = panels.flatMap((p) => p.series).find((s) => s.id === "calendar:econ-events");
  return series?.payload?.events ?? [];
}
