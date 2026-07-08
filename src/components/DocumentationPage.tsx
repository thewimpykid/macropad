"use client";

import { useMemo, useState } from "react";
import type { MacroPanel } from "@/lib/macroData";
import { getIndicatorDoc } from "@/lib/indicatorDocs";
import { getSignalConfig, type SignalMethod } from "@/lib/indicatorSignal";

const HIDDEN_PANELS = new Set(["asset-news"]);

const METHOD_LABEL: Record<SignalMethod, string> = {
  momentum: "Momentum",
  anchor: "Anchor",
  threshold: "Threshold",
  positioning: "Positioning",
};

interface SearchRow {
  id: string;
  name: string;
  panelTitle: string;
  note: string;
  source: string;
  doc: string;
  method: SignalMethod | null;
  rationale: string | null;
  reference: number | null;
  band: number | null;
}

function buildIndex(panels: MacroPanel[]): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const panel of panels) {
    for (const s of panel.series) {
      if (s.id === "geo:news-feed" && panel.id !== "geopolitics") continue;
      const config = getSignalConfig(s.id);
      rows.push({
        id: s.id,
        name: s.name,
        panelTitle: HIDDEN_PANELS.has(panel.id) ? "Asset News" : panel.title,
        note: s.note,
        source: s.source,
        doc: getIndicatorDoc(s.id, s.note),
        method: config?.method ?? null,
        rationale: config?.rationale ?? null,
        reference: config?.reference ?? null,
        band: config?.band ?? null,
      });
    }
  }
  return rows;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--border)] py-8">
      <h2 className="font-display m-0 mb-4 text-[1.15rem] uppercase leading-none tracking-[-0.01em]">{title}</h2>
      <div className="flex flex-col gap-3 font-sans text-[0.86rem] leading-relaxed text-[var(--text-dim)]">{children}</div>
    </div>
  );
}

export default function DocumentationPage({ panels }: { panels: MacroPanel[] }) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => buildIndex(panels), [panels]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index;
    return index.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.panelTitle.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.doc.toLowerCase().includes(q) ||
        (r.method?.toLowerCase().includes(q) ?? false) ||
        (r.rationale?.toLowerCase().includes(q) ?? false)
    );
  }, [index, query]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Section title="What Macropad is">
          <p className="m-0">
            Macropad is a live macro desk. It pulls US macroeconomic data, Treasury yields, CFTC positioning,
            cross asset transmission ratios, geopolitical uncertainty measures, volatility indices, and scored
            news headlines into one place, and rolls all of it into a per asset directional bias. The goal is a
            single screen that replaces a spreadsheet full of manually updated series.
          </p>
        </Section>

        <Section title="Board">
          <p className="m-0">
            Board is the landing page inside the app. It shows every indicator across every panel as a dense,
            one line per row list, colored by whether the reading is bullish, bearish, or flat. Nothing here
            requires scrolling through separate pages. It is meant to be the page you check first, a full status
            read of the macro picture in one glance.
          </p>
        </Section>

        <Section title="Panel pages">
          <p className="m-0">
            Each panel groups related indicators: US Macroeconomics, Yield Rates, COT Positioning, Transmission
            Check, Geopolitics, and Volatility. Clicking a panel in the sidebar opens every series inside it as a
            row you can click to expand, a collapsed header showing the name, current value, and a small
            percentage score, with a chevron on the right marking it as expandable.
          </p>
          <p className="m-0">
            Colors follow the same convention everywhere: green means the reading currently leans bullish for
            risk assets, red means it leans bearish, and gray or dim means the reading is flat or has no strong
            lean right now. The bias for a series is not simply whether the number went up or down, it depends
            on the indicator. A rising unemployment rate is read as bearish even though the number itself is
            going up, because what matters is what the number means for the economy, not its direction alone.
          </p>
        </Section>

        <Section title="Expanding an indicator row (the dropdowns)">
          <p className="m-0">
            Click any indicator row to open it. What appears depends on the indicator, but the layout is always
            the same set of pieces, top to bottom:
          </p>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
            <li>
              <span className="text-[var(--text)]">Bias label.</span> A short sentence stating the current read
              in plain language, colored green for bullish, red for bearish, gray for flat. This comes from the
              same bias logic used on the Board, so the label here always matches the color you saw before
              expanding.
            </li>
            <li>
              <span className="text-[var(--text)]">Linked assets.</span> Shown only when this indicator has a
              defined effect on one or more of the ten tracked assets. Each linked asset shows its own current
              price context and the direction this indicator is pushing it. If a row has no Linked assets
              section, it means Macropad has not mapped a direct asset effect for that specific indicator yet,
              not that the indicator is unimportant.
            </li>
            <li>
              <span className="text-[var(--text)]">Specialized metrics.</span> Extra stats attached to that
              specific series, each with its own small chart, for example the Sahm Rule reading under
              Unemployment, the COT index and net-percent-of-open-interest under every positioning series, or
              the 3m and 6m annualized paces under CPI. A flag or highlighted color on one of these means that
              specific extra stat has crossed its own separately defined trigger level, which is usually a
              different threshold than the main indicator's own signal score.
            </li>
            <li>
              <span className="text-[var(--text)]">The method body.</span> A chart and readout specific to
              whichever scoring method this indicator uses, momentum, anchor, threshold, or positioning. See the
              next section for what each one shows.
            </li>
            <li>
              <span className="text-[var(--text)]">Source and window.</span> The bottom row of every expanded
              card, showing exactly where the data comes from (for example FRED CPIAUCSL) and the lookback
              window and method used to compute the score (for example 3y daily, momentum 20d).
            </li>
          </ul>
          <p className="m-0">
            A handful of freshly added or thin history series render as a simpler, non expandable card instead,
            showing just the value, a sparkline, and the raw score bar with no dropdown. That happens
            automatically whenever a series does not yet have enough history (under 20 data points) for the full
            method based scoring to run.
          </p>
        </Section>

        <Section title="Signal scores and the four scoring methods">
          <p className="m-0">
            Most series carry a signal score from negative 1 to positive 1, shown as the small percentage next
            to the value and as the colored bar on the simpler cards. Despite the historical name z-score living
            on in one internal field name, this is not a plain statistical z-score. Every indicator is scored
            with whichever of four methods actually fits how that specific indicator behaves economically, and
            the search results below list the exact method, reference level, and band used for each one.
          </p>
          <ul className="m-0 flex list-disc flex-col gap-3 pl-5">
            <li>
              <span className="text-[var(--text)]">Momentum.</span> Used when the level itself is arbitrary or
              structurally drifting and the direction of change is what actually matters, for example the Fed
              balance sheet or the 10 year yield. Compares the average of the most recent window of readings
              against the average of the equal length window right before it, then scales that change by how
              volatile the series normally is period to period, so a big move in a normally calm series scores
              higher than the same size move in a normally noisy one.
            </li>
            <li>
              <span className="text-[var(--text)]">Anchor.</span> Used when a real economic reference point
              exists, for example CPI judged against the Fed's 2 percent target, or the VIX judged against its
              long run average near 17. The score is simply how far the latest reading sits from that reference,
              divided by a band width chosen for that indicator, and capped at plus or minus 1. A reading right
              at the reference scores 0, a reading a full band width away scores the full plus or minus 1.
            </li>
            <li>
              <span className="text-[var(--text)]">Threshold.</span> Used when crossing a specific line is the
              actual event, not the size of the move on either side of it, for example the 10y-2y yield curve
              going from positive to negative. Mechanically this is the same distance-from-reference math as
              anchor, just with a much narrower band, so the score swings hard right around the zero crossing
              itself rather than building up gradually.
            </li>
            <li>
              <span className="text-[var(--text)]">Positioning.</span> Used for series with no fixed fair value
              at all, mainly COT futures positioning and cross asset ratios, where the only sensible reference is
              the indicator's own recent history. Blends a robust z-score (based on the median and typical
              deviation, resistant to one-off outlier spikes skewing everything) with a percentile rank, both
              computed over roughly a 2 year window, so the score reflects how crowded or stretched the current
              reading is relative to where it has actually traded recently.
            </li>
          </ul>
          <p className="m-0">
            A score near 0 means the indicator is near its neutral zone for whichever method it uses. A score
            approaching positive 1 or negative 1 means it is at an extreme relative to that method. The window
            label under each indicator's value states the lookback period and method together, for example 3y
            daily, momentum 20d, meaning the score is computed over a 3 year daily history using a 20 day
            momentum window.
          </p>
        </Section>

        <Section title="News and sentiment scoring">
          <p className="m-0">
            The News page pools headlines from real macro and policy news desks (CNBC Economy, the Federal
            Reserve, WSJ Markets, Yahoo Finance, and FXStreet) rather than per ticker stock headlines. Each
            headline is scored by a finance specific keyword lexicon, a hand built dictionary of bullish and
            bearish financial terms with assigned weights, plus a negation check so that phrases like not
            rising flip the expected direction. Two word phrases such as rate cut or soft landing are matched
            before single words so they are not misread by one of their component words alone.
          </p>
          <p className="m-0">
            Raw scores are polarized, meaning mild scores are pulled toward neutral and strong scores are
            pushed further toward the extremes, so a headline with a genuinely clear lean reads clearly on the
            board instead of blending into the middle. The displayed sentiment number and the Sentiment over
            time chart both use a recency weighted average with an exponential half life, so a headline from
            the last hour moves the number more than a headline from yesterday, and the number naturally decays
            back toward neutral as headlines age out of relevance.
          </p>
          <p className="m-0">
            Switch between the General tab, pooled macro headlines, and per asset tabs for ticker specific
            headline sentiment on any of the tracked assets. The 3D scatter under each feed plots headlines by
            time on one axis and sentiment score on another, with color marking bullish, bearish, or neutral,
            so you can see clustering and shifts in tone at a glance without reading every headline.
          </p>
        </Section>

        <Section title="Custom Dashboard and Custom Bias">
          <p className="m-0">
            Custom Dashboard lets you pick any subset of indicators from across every panel and pin them
            together on one page, useful if you only care about a handful of series rather than the full board.
          </p>
          <p className="m-0">
            Custom Bias goes further: you choose your own set of indicators, assign your own weights to each
            one, and set your own thresholds for what counts as bullish or bearish. This produces a bias read
            specific to your own model of what matters, separate from the default bias logic used everywhere
            else in the app.
          </p>
        </Section>

        <Section title="Refresh and data currency">
          <p className="m-0">
            Data refreshes automatically on a schedule, and the sidebar shows the exact last synced time so you
            always know how current the board is. You never need to manually pull or import data yourself,
            everything is fetched and scored server side.
          </p>
        </Section>
      </div>

      <div className="border-t border-[var(--border)] pt-8">
        <h2 className="font-display m-0 mb-2 text-[1.15rem] uppercase leading-none tracking-[-0.01em]">
          Search by indicator
        </h2>
        <p className="m-0 mb-4 font-sans text-[0.84rem] leading-relaxed text-[var(--text-dim)]">
          Every metric on the board, explained: what it measures, where it comes from, and how to read it.
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an indicator, e.g. VIX, unemployment, COT, breakeven"
          className="w-full rounded-md border px-3.5 py-2.5 font-sans text-[0.86rem] outline-none"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
        />

        <div className="mt-2 font-mono text-[0.68rem] text-[var(--text-faint)]">
          {results.length} {results.length === 1 ? "match" : "matches"}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {results.map((r) => (
            <div key={r.id} className="border border-[var(--border)] px-4 py-3.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h3 className="m-0 text-[0.95rem] font-semibold text-[var(--text)]">{r.name}</h3>
                <span className="eyebrow" style={{ color: "var(--accent)" }}>{r.panelTitle}</span>
                {r.method && (
                  <span className="eyebrow" style={{ color: "var(--text-faint)" }}>
                    {METHOD_LABEL[r.method]} scoring
                  </span>
                )}
              </div>
              <p className="m-0 mt-2 font-sans text-[0.84rem] leading-relaxed text-[var(--text-dim)]">{r.doc}</p>

              {r.rationale && (
                <div className="mt-2.5 border-l-2 pl-3" style={{ borderColor: "var(--border-strong)" }}>
                  <p className="m-0 font-sans text-[0.78rem] italic leading-relaxed text-[var(--text-faint)]">
                    {r.rationale}
                    {r.reference !== null && r.band !== null && (
                      <span>
                        {" "}
                        Reference {r.reference}, band ±{r.band} for a full ±100% score.
                      </span>
                    )}
                  </p>
                </div>
              )}

              <div className="mt-2.5 font-mono text-[0.66rem] uppercase tracking-wide text-[var(--text-faint)]">{r.source}</div>
            </div>
          ))}
          {results.length === 0 && (
            <p className="m-0 font-sans text-[0.85rem] text-[var(--text-faint)]">No indicator matches that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
