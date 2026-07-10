"use client";

import { useMemo } from "react";
import type { MacroPanel } from "@/lib/macroData";
import { getCalendarEvents } from "@/lib/econCalendar";

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function relativeDayLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days}d` : `${Math.abs(days)}d ago`;
}

function monthLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const IMPORTANCE_STYLE: Record<"high" | "medium" | "low", { border: string; weight: string; tag: string | null }> = {
  high: { border: "var(--accent)", weight: "font-bold", tag: "HIGH" },
  medium: { border: "var(--border-strong)", weight: "font-semibold", tag: null },
  low: { border: "var(--border)", weight: "font-normal", tag: null },
};

type EventWithDays = ReturnType<typeof getCalendarEvents>[number] & { days: number };

function EventRow({ e, currentValue }: { e: EventWithDays; currentValue: string | null }) {
  const style = IMPORTANCE_STYLE[e.importance];
  return (
    <div className="flex items-center gap-3 rounded-md border-l-[3px] bg-[var(--panel)] py-2.5 pl-3 pr-4" style={{ borderLeftColor: style.border }}>
      <div className="w-14 shrink-0 font-mono text-[0.66rem] text-[var(--text-faint)]">
        {new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-sans text-[0.8rem] ${style.weight}`}>{e.label}</div>
        {currentValue && <div className="truncate font-mono text-[0.64rem] text-[var(--text-faint)]">Currently: {currentValue}</div>}
      </div>
      {style.tag && (
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[0.56rem] font-bold tracking-wide text-[var(--accent)]" style={{ borderColor: "var(--accent)" }}>
          {style.tag}
        </span>
      )}
      <span className="shrink-0 font-mono text-[0.64rem] text-[var(--text-faint)]">{relativeDayLabel(e.days)}</span>
    </div>
  );
}

function EventList({ events, valueFor }: { events: EventWithDays[]; valueFor: (id: string) => string | null }) {
  let lastMonth = "";
  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => {
        const month = monthLabel(e.date);
        const showMonth = month !== lastMonth;
        lastMonth = month;
        return (
          <div key={`${e.releaseId}-${e.date}`}>
            {showMonth && (
              <div className="mb-2 mt-4 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-faint)] first:mt-0">{month}</div>
            )}
            <EventRow e={e} currentValue={valueFor(e.relatedIndicatorId)} />
          </div>
        );
      })}
    </div>
  );
}

export default function CalendarPage({ panels }: { panels: MacroPanel[] }) {
  const seriesIndex = useMemo(() => {
    const map = new Map<string, MacroPanel["series"][number]>();
    for (const p of panels) for (const s of p.series) map.set(s.id, s);
    return map;
  }, [panels]);
  const valueFor = (id: string) => seriesIndex.get(id)?.value ?? null;

  const events = useMemo(() => {
    const all = getCalendarEvents(panels);
    return all.map((e) => ({ ...e, days: daysUntil(e.date) })).sort((a, b) => a.date.localeCompare(b.date));
  }, [panels]);

  const upcoming = events.filter((e) => e.days >= 0);
  const done = events.filter((e) => e.days < 0).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-2 font-sans text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Upcoming</div>
        {upcoming.length === 0 ? (
          <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No upcoming release dates loaded yet.</p>
        ) : (
          <EventList events={upcoming} valueFor={valueFor} />
        )}
      </div>
      <div>
        <div className="mb-2 font-sans text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Done</div>
        {done.length === 0 ? (
          <p className="font-sans text-[0.85rem] text-[var(--text-faint)]">No recent releases yet.</p>
        ) : (
          <EventList events={done} valueFor={valueFor} />
        )}
      </div>
    </div>
  );
}
