import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format, subDays } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type ParsedCSV, type ParsedRow, parseCSV } from "./utils/csvParser";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR1R-6vsfok86xF9jRMNHCjSmBQSqvqMBV-Qbi-a8sAhvCReswDdJBlicMfdu1A2G8ftrYxdWpV0dct/pub?output=csv";

const CHART_COLORS = [
  "#38bdf8",
  "#34d399",
  "#fb923c",
  "#a78bfa",
  "#f472b6",
  "#facc15",
  "#60a5fa",
  "#4ade80",
  "#f87171",
  "#e879f9",
];

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12 AM";
  if (i < 12) return `${i} AM`;
  if (i === 12) return "12 PM";
  return `${i - 12} PM`;
});

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatAxisDate(ts: number): string {
  return format(new Date(ts), "MM/dd HH:mm");
}

function formatTooltipDate(ts: number): string {
  return format(new Date(ts), "MMM dd, yyyy HH:mm");
}

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return format(d, "yyyy-MM-dd");
}

type ViewMode = "separate" | "combined";
type FilterMode = "range" | "compare";

interface SummaryStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

function computeStats(rows: ParsedRow[], kpi: string): SummaryStats {
  const vals = rows
    .map((r) => r.kpis[kpi])
    .filter((v) => v !== undefined && !Number.isNaN(v));
  if (vals.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { min, max, avg, count: vals.length };
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function LoadingSkeleton() {
  return (
    <div
      data-ocid="dashboard.loading_state"
      className="flex flex-col gap-6 p-6"
    >
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["a", "b", "c", "d"].map((k) => (
          <Skeleton key={k} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

export default function App() {
  const [csvData, setCsvData] = useState<ParsedCSV | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Date Range mode
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Compare Weekdays mode
  const [filterMode, setFilterMode] = useState<FilterMode>("range");
  const [referenceDate, setReferenceDate] = useState<string>(
    toDateInputValue(new Date()),
  );
  const [pastWeeks, setPastWeeks] = useState<number>(4);

  // Shared
  const [startHour, setStartHour] = useState<number>(0);
  const [endHour, setEndHour] = useState<number>(23);
  const [selectedKPIs, setSelectedKPIs] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("separate");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parseCSV(text);
      setCsvData(parsed);
      setLastFetched(new Date());
      setSelectedKPIs(new Set(parsed.kpiCols.slice(0, 5)));
      if (parsed.rows.length > 0) {
        const sorted = [...parsed.rows].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
        );
        setStartDate(toDateInputValue(sorted[0].timestamp));
        setEndDate(toDateInputValue(sorted[sorted.length - 1].timestamp));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Compute the list of dates to compare (reference + past N weeks same weekday)
  const compareWeekDates = useMemo(() => {
    if (!referenceDate) return [];
    const base = new Date(`${referenceDate}T00:00:00`);
    const dates: string[] = [];
    for (let i = 0; i <= pastWeeks; i++) {
      dates.push(toDateInputValue(subDays(base, i * 7)));
    }
    return dates;
  }, [referenceDate, pastWeeks]);

  const filteredRows = useMemo(() => {
    if (!csvData) return [];
    return csvData.rows.filter((row) => {
      const ts = row.timestamp;
      const hour = ts.getHours();
      if (hour < startHour || hour > endHour) return false;

      if (filterMode === "compare") {
        const dateStr = format(ts, "yyyy-MM-dd");
        return compareWeekDates.includes(dateStr);
      }

      // range mode
      if (startDate) {
        const sd = new Date(startDate);
        sd.setHours(0, 0, 0, 0);
        if (ts < sd) return false;
      }
      if (endDate) {
        const ed = new Date(endDate);
        ed.setHours(23, 59, 59, 999);
        if (ts > ed) return false;
      }
      return true;
    });
  }, [
    csvData,
    startDate,
    endDate,
    startHour,
    endHour,
    filterMode,
    compareWeekDates,
  ]);

  const selectedKPIList = useMemo(
    () => (csvData ? csvData.kpiCols.filter((k) => selectedKPIs.has(k)) : []),
    [csvData, selectedKPIs],
  );

  // Regular range chart data
  const chartData = useMemo(() => {
    return filteredRows
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((row) => {
        const point: Record<string, number | string> = {
          ts: row.timestamp.getTime(),
          tsLabel: formatTooltipDate(row.timestamp.getTime()),
        };
        for (const kpi of selectedKPIList) {
          const val = row.kpis[kpi];
          if (val !== undefined) point[kpi] = val;
        }
        return point;
      });
  }, [filteredRows, selectedKPIList]);

  // Compare mode chart data: X = date, Y = KPI value, one line per KPI
  // Each date point shows the average KPI value for that date within the filtered hour range
  const compareChartData = useMemo(() => {
    if (filterMode !== "compare" || compareWeekDates.length === 0) return [];

    // Group filtered rows by date string
    const byDate: Record<string, ParsedRow[]> = {};
    for (const dateStr of compareWeekDates) {
      byDate[dateStr] = [];
    }
    for (const row of filteredRows) {
      const dateStr = format(row.timestamp, "yyyy-MM-dd");
      if (byDate[dateStr]) byDate[dateStr].push(row);
    }

    // Build one point per date, with avg KPI values
    const points = compareWeekDates
      .map((dateStr) => {
        const d = new Date(`${dateStr}T00:00:00`);
        const day = WEEKDAY_SHORT[d.getDay()];
        const dateLabel = `${format(d, "MMM d")} (${day})`;
        const point: Record<string, number | string> = {
          dateTs: d.getTime(),
          dateLabel,
        };
        const rows = byDate[dateStr] ?? [];
        for (const kpi of selectedKPIList) {
          const vals = rows
            .map((r) => r.kpis[kpi])
            .filter((v) => v !== undefined && !Number.isNaN(v));
          if (vals.length > 0) {
            point[kpi] = vals.reduce((a, b) => a + b, 0) / vals.length;
          }
        }
        return point;
      })
      // Sort oldest first (left = past, right = recent)
      .sort((a, b) => (a.dateTs as number) - (b.dateTs as number));

    return points;
  }, [filterMode, compareWeekDates, filteredRows, selectedKPIList]);

  const resetFilters = useCallback(() => {
    if (filterMode === "compare") {
      setReferenceDate(toDateInputValue(new Date()));
      setPastWeeks(4);
      setStartHour(0);
      setEndHour(23);
      return;
    }
    if (!csvData || csvData.rows.length === 0) return;
    const sorted = [...csvData.rows].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    setStartDate(toDateInputValue(sorted[0].timestamp));
    setEndDate(toDateInputValue(sorted[sorted.length - 1].timestamp));
    setStartHour(0);
    setEndHour(23);
    setSelectedKPIs(new Set(csvData.kpiCols.slice(0, 5)));
  }, [csvData, filterMode]);

  const toggleKPI = useCallback((kpi: string) => {
    setSelectedKPIs((prev) => {
      const next = new Set(prev);
      if (next.has(kpi)) next.delete(kpi);
      else next.add(kpi);
      return next;
    });
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div
        data-ocid="dashboard.error_state"
        className="min-h-screen flex items-center justify-center bg-background"
      >
        <div className="text-center space-y-4 p-8">
          <div className="text-6xl">⚠️</div>
          <h2 className="text-xl font-display font-semibold text-foreground">
            Failed to load data
          </h2>
          <p className="text-muted-foreground font-mono text-sm">{error}</p>
          <Button
            data-ocid="dashboard.retry_button"
            onClick={fetchData}
            className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!csvData) return null;

  // Build compare date labels for legend pills
  const compareDateLabels = compareWeekDates.map((dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const day = WEEKDAY_SHORT[d.getDay()];
    return { dateStr, label: `${format(d, "MMM d")} (${day})` };
  });

  return (
    <div className="min-h-screen bg-background dashboard-grid-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <span className="text-primary text-sm font-bold font-mono">
                K
              </span>
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground leading-none">
                KPI Dashboard
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 font-body">
                Google Sheets · Live CSV
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-body">
            <Badge
              variant="outline"
              className="border-primary/30 text-primary font-mono"
            >
              {filteredRows.length.toLocaleString()} rows
            </Badge>
            {lastFetched && (
              <span>Updated {format(lastFetched, "HH:mm:ss")}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchData}
              className="text-xs h-7 px-2 text-muted-foreground hover:text-primary"
            >
              ↻ Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Filter Bar */}
        <section className="bg-card border border-border rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">
              Filters
            </h2>
            <Button
              data-ocid="filters.reset_button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-primary h-7"
            >
              Reset all
            </Button>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1 w-fit mb-4">
            <button
              type="button"
              data-ocid="filters.mode.range_button"
              onClick={() => setFilterMode("range")}
              className={`px-3 py-1.5 text-xs rounded-md font-body transition-all ${
                filterMode === "range"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Date Range
            </button>
            <button
              type="button"
              data-ocid="filters.mode.compare_button"
              onClick={() => setFilterMode("compare")}
              className={`px-3 py-1.5 text-xs rounded-md font-body transition-all ${
                filterMode === "compare"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Compare Weekdays
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {filterMode === "range" ? (
              <>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="start-date-input"
                    className="text-xs text-muted-foreground font-body"
                  >
                    Start Date
                  </Label>
                  <input
                    id="start-date-input"
                    data-ocid="filters.start_date.input"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground font-body focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="end-date-input"
                    className="text-xs text-muted-foreground font-body"
                  >
                    End Date
                  </Label>
                  <input
                    id="end-date-input"
                    data-ocid="filters.end_date.input"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground font-body focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="reference-date-input"
                    className="text-xs text-muted-foreground font-body"
                  >
                    Reference Date
                  </Label>
                  <input
                    id="reference-date-input"
                    data-ocid="filters.reference_date.input"
                    type="date"
                    value={referenceDate}
                    onChange={(e) => setReferenceDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground font-body focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {referenceDate && (
                    <p className="text-xs text-primary/70 font-mono mt-0.5">
                      {
                        WEEKDAY_SHORT[
                          new Date(`${referenceDate}T00:00:00`).getDay()
                        ]
                      }
                      s · {pastWeeks + 1} weeks
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-body">
                    Past Weeks
                  </Label>
                  <Select
                    value={String(pastWeeks)}
                    onValueChange={(v) => setPastWeeks(Number(v))}
                  >
                    <SelectTrigger
                      data-ocid="filters.past_weeks.select"
                      className="h-9 text-sm font-body"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} week{n > 1 ? "s" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Compare preview pills */}
                <div className="space-y-1.5 sm:col-span-2">
                  <p className="text-xs text-muted-foreground font-body">
                    Comparing dates
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {compareDateLabels.map(({ dateStr, label }, i) => (
                      <span
                        key={dateStr}
                        className="px-2 py-0.5 rounded-full text-xs font-mono border"
                        style={{
                          borderColor: `${CHART_COLORS[i % CHART_COLORS.length]}60`,
                          color: CHART_COLORS[i % CHART_COLORS.length],
                          background: `${CHART_COLORS[i % CHART_COLORS.length]}15`,
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-body">
                Start Hour
              </Label>
              <Select
                value={String(startHour)}
                onValueChange={(v) => setStartHour(Number(v))}
              >
                <SelectTrigger
                  data-ocid="filters.start_hour.select"
                  className="h-9 text-sm font-body"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_LABELS.map((label, i) => (
                    <SelectItem key={label} value={String(i)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-body">
                End Hour
              </Label>
              <Select
                value={String(endHour)}
                onValueChange={(v) => setEndHour(Number(v))}
              >
                <SelectTrigger
                  data-ocid="filters.end_hour.select"
                  className="h-9 text-sm font-body"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_LABELS.map((label, i) => (
                    <SelectItem key={label} value={String(i)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* KPI Checkboxes */}
          <div>
            <p className="text-xs text-muted-foreground font-body mb-2">
              KPI Columns ({selectedKPIs.size} selected)
            </p>
            <div className="flex flex-wrap gap-2">
              {csvData.kpiCols.map((kpi, idx) => {
                const checkboxId = `kpi-checkbox-${kpi.replace(/\s+/g, "-")}`;
                return (
                  <label
                    key={kpi}
                    htmlFor={checkboxId}
                    data-ocid={`filters.kpi.checkbox.${idx + 1}`}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border cursor-pointer transition-all text-xs font-body select-none ${
                      selectedKPIs.has(kpi)
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                    }`}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selectedKPIs.has(kpi)}
                      onCheckedChange={() => toggleKPI(kpi)}
                      className="h-3 w-3"
                    />
                    <span>{kpi}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        {/* Summary Stats */}
        {selectedKPIList.length > 0 && filteredRows.length > 0 && (
          <section>
            <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider mb-3">
              Summary Statistics
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {selectedKPIList.map((kpi, idx) => {
                const stats = computeStats(filteredRows, kpi);
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                return (
                  <div
                    key={kpi}
                    data-ocid={`stats.kpi.card.${idx + 1}`}
                    className="bg-card border border-border rounded-xl p-4 kpi-card-glow hover:border-primary/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span
                        className="text-xs font-body text-muted-foreground leading-tight line-clamp-2"
                        title={kpi}
                      >
                        {kpi}
                      </span>
                      <div
                        className="w-2 h-2 rounded-full mt-0.5 shrink-0"
                        style={{ background: color }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-muted-foreground font-body">
                          Min
                        </span>
                        <span className="text-xs stat-value" style={{ color }}>
                          {formatNum(stats.min)}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-muted-foreground font-body">
                          Max
                        </span>
                        <span className="text-xs stat-value text-foreground">
                          {formatNum(stats.max)}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline border-t border-border pt-1.5">
                        <span className="text-xs text-muted-foreground font-body">
                          Avg
                        </span>
                        <span className="text-sm font-semibold stat-value text-foreground">
                          {formatNum(stats.avg)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Charts */}
        {selectedKPIList.length > 0 && filteredRows.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">
                Charts
                {filterMode === "compare" && (
                  <span className="ml-2 text-xs text-primary/70 font-body normal-case">
                    — trend across weeks
                  </span>
                )}
              </h2>
              {filterMode === "range" && (
                <div
                  data-ocid="charts.view_toggle"
                  className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode("separate")}
                    className={`px-3 py-1 text-xs rounded-md font-body transition-all ${
                      viewMode === "separate"
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Separate
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("combined")}
                    className={`px-3 py-1 text-xs rounded-md font-body transition-all ${
                      viewMode === "combined"
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Combined
                  </button>
                </div>
              )}
            </div>

            {filterMode === "compare" ? (
              // Compare mode: one combined chart, X = date, one line per KPI
              <div
                data-ocid="charts.kpi.card.1"
                className="bg-card border border-border rounded-xl p-4 chart-container"
              >
                <div className="mb-3">
                  <h3 className="text-sm font-display font-medium text-foreground">
                    KPI Trend — Same Weekday Across Weeks
                  </h3>
                  <p className="text-xs text-muted-foreground font-body mt-0.5">
                    Each point = avg value for that date · hour filter applied
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={compareChartData as Record<string, number | string>[]}
                    margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.28 0.02 255)"
                      opacity={0.4}
                    />
                    <XAxis
                      dataKey="dateTs"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      tickFormatter={(v) => format(new Date(v), "MMM d")}
                      tick={{
                        fill: "oklch(0.62 0.02 255)",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono",
                      }}
                      stroke="oklch(0.28 0.02 255)"
                      tickCount={compareWeekDates.length}
                    />
                    <YAxis
                      tick={{
                        fill: "oklch(0.62 0.02 255)",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono",
                      }}
                      stroke="oklch(0.28 0.02 255)"
                      tickFormatter={(v) => formatNum(v)}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "oklch(0.21 0.015 255)",
                        border: "1px solid oklch(0.28 0.02 255)",
                        borderRadius: "8px",
                        fontSize: 11,
                        fontFamily: "Figtree",
                        color: "oklch(0.92 0.01 260)",
                      }}
                      labelFormatter={(_v, payload) => {
                        return (
                          (payload?.[0]?.payload as Record<string, string>)
                            ?.dateLabel ?? ""
                        );
                      }}
                      formatter={(value: number, name: string) => [
                        formatNum(value),
                        name,
                      ]}
                    />
                    <Legend
                      wrapperStyle={{
                        fontSize: 11,
                        fontFamily: "Figtree",
                        paddingTop: 8,
                      }}
                    />
                    {selectedKPIList.map((kpi, idx) => (
                      <Line
                        key={kpi}
                        type="monotone"
                        dataKey={kpi}
                        name={kpi}
                        stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                        dot={{
                          r: 4,
                          fill: CHART_COLORS[idx % CHART_COLORS.length],
                        }}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : viewMode === "combined" ? (
              <div
                data-ocid="charts.kpi.card.1"
                className="bg-card border border-border rounded-xl p-4 chart-container"
              >
                <h3 className="text-sm font-display font-medium text-foreground mb-4">
                  All KPIs
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.28 0.02 255)"
                      opacity={0.5}
                    />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      tickFormatter={(v) => formatAxisDate(v)}
                      tick={{
                        fill: "oklch(0.62 0.02 255)",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono",
                      }}
                      stroke="oklch(0.28 0.02 255)"
                      tickCount={6}
                    />
                    <YAxis
                      tick={{
                        fill: "oklch(0.62 0.02 255)",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono",
                      }}
                      stroke="oklch(0.28 0.02 255)"
                      tickFormatter={(v) => formatNum(v)}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "oklch(0.21 0.015 255)",
                        border: "1px solid oklch(0.28 0.02 255)",
                        borderRadius: "8px",
                        fontSize: 11,
                        fontFamily: "Figtree",
                        color: "oklch(0.92 0.01 260)",
                      }}
                      labelFormatter={(v) => formatTooltipDate(v)}
                      formatter={(value: number, name: string) => [
                        formatNum(value),
                        name,
                      ]}
                    />
                    <Legend
                      wrapperStyle={{
                        fontSize: 11,
                        fontFamily: "Figtree",
                        paddingTop: 8,
                      }}
                    />
                    {selectedKPIList.map((kpi, idx) => (
                      <Line
                        key={kpi}
                        type="monotone"
                        dataKey={kpi}
                        stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                        dot={false}
                        strokeWidth={1.5}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {selectedKPIList.map((kpi, idx) => {
                  const color = CHART_COLORS[idx % CHART_COLORS.length];
                  return (
                    <div
                      key={kpi}
                      data-ocid={`charts.kpi.card.${idx + 1}`}
                      className="bg-card border border-border rounded-xl p-4 chart-container"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: color }}
                        />
                        <h3
                          className="text-sm font-display font-medium text-foreground truncate"
                          title={kpi}
                        >
                          {kpi}
                        </h3>
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart
                          data={chartData}
                          margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="oklch(0.28 0.02 255)"
                            opacity={0.4}
                          />
                          <XAxis
                            dataKey="ts"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            scale="time"
                            tickFormatter={(v) => formatAxisDate(v)}
                            tick={{
                              fill: "oklch(0.62 0.02 255)",
                              fontSize: 9,
                              fontFamily: "JetBrains Mono",
                            }}
                            stroke="oklch(0.28 0.02 255)"
                            tickCount={4}
                          />
                          <YAxis
                            tick={{
                              fill: "oklch(0.62 0.02 255)",
                              fontSize: 9,
                              fontFamily: "JetBrains Mono",
                            }}
                            stroke="oklch(0.28 0.02 255)"
                            tickFormatter={(v) => formatNum(v)}
                            width={48}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "oklch(0.21 0.015 255)",
                              border: "1px solid oklch(0.28 0.02 255)",
                              borderRadius: "8px",
                              fontSize: 11,
                              fontFamily: "Figtree",
                              color: "oklch(0.92 0.01 260)",
                            }}
                            labelFormatter={(v) => formatTooltipDate(v)}
                            formatter={(value: number) => [
                              formatNum(value),
                              kpi,
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey={kpi}
                            stroke={color}
                            dot={false}
                            strokeWidth={2}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Empty State */}
        {filteredRows.length === 0 && !loading && (
          <div
            data-ocid="dashboard.empty_state"
            className="text-center py-16 text-muted-foreground"
          >
            <div className="text-4xl mb-3">📊</div>
            <p className="font-display font-medium">
              No data matches your filters
            </p>
            <p className="text-sm mt-1 font-body">
              {filterMode === "compare"
                ? "No data found for the selected weekday dates and hour range"
                : "Try adjusting the date range or hour window"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="mt-4 text-primary"
            >
              Reset filters
            </Button>
          </div>
        )}

        {/* Data Table */}
        {filteredRows.length > 0 && selectedKPIList.length > 0 && (
          <section>
            <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider mb-3">
              Data Table
              <span className="ml-2 text-xs text-muted-foreground font-body normal-case">
                ({filteredRows.length.toLocaleString()} rows)
              </span>
            </h2>
            <div
              data-ocid="dashboard.table"
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              <div className="overflow-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-body font-medium whitespace-nowrap">
                        Timestamp
                      </th>
                      {selectedKPIList.map((kpi) => (
                        <th
                          key={kpi}
                          className="text-right px-3 py-2.5 text-muted-foreground font-body font-medium whitespace-nowrap"
                        >
                          {kpi}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows
                      .sort(
                        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
                      )
                      .map((row, idx) => (
                        <tr
                          key={row.timestamp.getTime()}
                          data-ocid={
                            idx < 3 ? `table.row.${idx + 1}` : undefined
                          }
                          className={`border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors ${
                            idx % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                          }`}
                        >
                          <td className="px-4 py-2 text-muted-foreground font-mono whitespace-nowrap">
                            {format(row.timestamp, "yyyy-MM-dd HH:mm")}
                          </td>
                          {selectedKPIList.map((kpi, kidx) => {
                            const val = row.kpis[kpi];
                            const color =
                              CHART_COLORS[kidx % CHART_COLORS.length];
                            return (
                              <td
                                key={kpi}
                                className="px-3 py-2 text-right font-mono"
                                style={{
                                  color: val !== undefined ? color : undefined,
                                }}
                              >
                                {val !== undefined
                                  ? val.toLocaleString(undefined, {
                                      maximumFractionDigits: 2,
                                    })
                                  : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-12 py-6">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 text-center text-xs text-muted-foreground font-body">
          © {new Date().getFullYear()}.
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 hover:text-primary transition-colors"
          >
            Built with ❤️ using caffeine.ai
          </a>
        </div>
      </footer>
    </div>
  );
}
