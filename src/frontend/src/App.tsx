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

// Priority KPI order — these appear at the top of the sidebar (case-insensitive match)
const PRIORITY_KPI_PATTERNS = [
  "bl approval",
  "active users in bl txn",
  "bl txn",
  "notif dau",
  "and_notif_dau",
  "and_notif_txns",
  "ios_notif_dau",
  "ios_notif_txn",
  "and notif dau",
  "and notif txns",
  "ios notif dau",
  "ios notif txns",
  "app txns",
  "ios txns",
  "and txns",
  "app act",
  "and act",
  "ios act",
];

// KPIs that should be pre-selected on load (case-insensitive match)
const PRESELECTED_KPI_PATTERNS = [
  "bl approval",
  "active users in bl txn",
  "notif dau",
];

function normKpi(s: string) {
  return s.toLowerCase().trim();
}

function getPriorityIndex(kpi: string): number {
  const norm = normKpi(kpi);
  const idx = PRIORITY_KPI_PATTERNS.findIndex(
    (p) => norm.includes(p) || p.includes(norm),
  );
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

function isPreselected(kpi: string): boolean {
  const norm = normKpi(kpi);
  return PRESELECTED_KPI_PATTERNS.some(
    (p) => norm.includes(p) || p.includes(norm),
  );
}

function sortedKpiCols(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const ia = getPriorityIndex(a);
    const ib = getPriorityIndex(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function formatAxisDate(ts: number): string {
  return format(new Date(ts), "MM/dd HH:mm");
}

function formatAxisDay(ts: number): string {
  return format(new Date(ts), "MM/dd");
}

function formatTooltipDate(ts: number): string {
  return format(new Date(ts), "MMM dd, yyyy HH:mm");
}

function formatTooltipDay(ts: number): string {
  return format(new Date(ts), "MMM dd, yyyy");
}

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return format(d, "yyyy-MM-dd");
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

type ViewMode = "separate" | "combined";
type FilterMode = "range" | "compare";
type XAxisMode = "hourly" | "daily";

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
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>("hourly");

  const isFullDay = startHour === 0 && endHour === 23;

  const setFullDay = useCallback(() => {
    setStartHour(0);
    setEndHour(23);
  }, []);

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
      // Pre-select based on PRESELECTED_KPI_PATTERNS; fall back to first 3
      const preselected = parsed.kpiCols.filter(isPreselected);
      setSelectedKPIs(
        new Set(
          preselected.length > 0 ? preselected : parsed.kpiCols.slice(0, 3),
        ),
      );
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

  // Sorted KPI columns for display (priority KPIs first)
  const sortedKPIs = useMemo(
    () => (csvData ? sortedKpiCols(csvData.kpiCols) : []),
    [csvData],
  );

  const selectedKPIList = useMemo(
    () => (csvData ? sortedKPIs.filter((k) => selectedKPIs.has(k)) : []),
    [csvData, sortedKPIs, selectedKPIs],
  );

  // Hourly chart data (raw)
  const chartDataHourly = useMemo(() => {
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

  // Daily chart data (aggregated by day)
  const chartDataDaily = useMemo(() => {
    const byDay: Record<string, { ts: number; rows: ParsedRow[] }> = {};
    for (const row of filteredRows) {
      const dayKey = format(row.timestamp, "yyyy-MM-dd");
      if (!byDay[dayKey]) {
        const d = new Date(dayKey);
        byDay[dayKey] = { ts: d.getTime(), rows: [] };
      }
      byDay[dayKey].rows.push(row);
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_day, { ts, rows }]) => {
        const point: Record<string, number | string> = {
          ts,
          tsLabel: formatTooltipDay(ts),
        };
        for (const kpi of selectedKPIList) {
          const vals = rows
            .map((r) => r.kpis[kpi])
            .filter((v) => v !== undefined && !Number.isNaN(v));
          if (vals.length > 0)
            point[kpi] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        return point;
      });
  }, [filteredRows, selectedKPIList]);

  const chartData = xAxisMode === "daily" ? chartDataDaily : chartDataHourly;

  const compareChartData = useMemo(() => {
    if (filterMode !== "compare" || compareWeekDates.length === 0) return [];
    const byDate: Record<string, ParsedRow[]> = {};
    for (const dateStr of compareWeekDates) byDate[dateStr] = [];
    for (const row of filteredRows) {
      const dateStr = format(row.timestamp, "yyyy-MM-dd");
      if (byDate[dateStr]) byDate[dateStr].push(row);
    }
    return compareWeekDates
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
          if (vals.length > 0)
            point[kpi] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        return point;
      })
      .sort((a, b) => (a.dateTs as number) - (b.dateTs as number));
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
    const preselected = csvData.kpiCols.filter(isPreselected);
    setSelectedKPIs(
      new Set(
        preselected.length > 0 ? preselected : csvData.kpiCols.slice(0, 3),
      ),
    );
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

  const compareDateLabels = compareWeekDates.map((dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const day = WEEKDAY_SHORT[d.getDay()];
    return { dateStr, label: `${format(d, "MMM d")} (${day})` };
  });

  const axisTickFormatter =
    xAxisMode === "daily" ? formatAxisDay : formatAxisDate;
  const tooltipLabelFormatter =
    xAxisMode === "daily" ? formatTooltipDay : formatTooltipDate;

  // Split sorted KPIs into priority and rest for visual separator
  const priorityKpiList = sortedKPIs.filter(
    (k) => getPriorityIndex(k) < Number.POSITIVE_INFINITY,
  );
  const otherKpiList = sortedKPIs.filter(
    (k) => getPriorityIndex(k) === Number.POSITIVE_INFINITY,
  );

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

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-6">
          {/* Left Sidebar: KPI Selection */}
          <aside className="w-52 shrink-0 sticky top-20 self-start h-[calc(100vh-5rem)]">
            <div className="bg-card border border-border rounded-xl p-4 h-full flex flex-col overflow-hidden">
              <p className="text-xs font-display font-semibold text-foreground uppercase tracking-wider mb-1">
                KPI Columns
              </p>
              <p className="text-xs text-muted-foreground font-body mb-3">
                {selectedKPIs.size} selected
              </p>

              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Priority KPIs */}
                {priorityKpiList.length > 0 && (
                  <>
                    <p className="text-[10px] font-mono text-primary/60 uppercase tracking-widest mb-1.5">
                      Priority
                    </p>
                    <div className="flex flex-col gap-1.5 mb-3">
                      {priorityKpiList.map((kpi, idx) => {
                        const checkboxId = `kpi-checkbox-${kpi.replace(/\s+/g, "-")}`;
                        return (
                          <label
                            key={kpi}
                            htmlFor={checkboxId}
                            data-ocid={`filters.kpi.checkbox.${idx + 1}`}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer transition-all text-xs font-body select-none ${
                              selectedKPIs.has(kpi)
                                ? "border-primary/60 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                            }`}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={selectedKPIs.has(kpi)}
                              onCheckedChange={() => toggleKPI(kpi)}
                              className="h-3 w-3 shrink-0"
                            />
                            <span className="leading-tight break-words">
                              {kpi}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Other KPIs */}
                {otherKpiList.length > 0 && (
                  <>
                    {priorityKpiList.length > 0 && (
                      <div className="border-t border-border/50 mb-3" />
                    )}
                    {priorityKpiList.length > 0 && (
                      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-1.5">
                        Other
                      </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      {otherKpiList.map((kpi, idx) => {
                        const checkboxId = `kpi-checkbox-${kpi.replace(/\s+/g, "-")}`;
                        return (
                          <label
                            key={kpi}
                            htmlFor={checkboxId}
                            data-ocid={`filters.kpi.checkbox.${priorityKpiList.length + idx + 1}`}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer transition-all text-xs font-body select-none ${
                              selectedKPIs.has(kpi)
                                ? "border-primary/60 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                            }`}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={selectedKPIs.has(kpi)}
                              onCheckedChange={() => toggleKPI(kpi)}
                              className="h-3 w-3 shrink-0"
                            />
                            <span className="leading-tight break-words">
                              {kpi}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-6">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(
                            (n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n} week{n > 1 ? "s" : ""}
                              </SelectItem>
                            ),
                          )}
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

                {/* Hour filters + Full Day */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground font-body">
                      Start Hour
                    </Label>
                  </div>
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
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-body">
                    Full Day
                  </Label>
                  <button
                    type="button"
                    data-ocid="filters.full_day.toggle"
                    onClick={setFullDay}
                    className={`w-full h-9 rounded-md border text-xs font-body transition-all px-3 ${
                      isFullDay
                        ? "bg-primary/20 border-primary/60 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {isFullDay ? "✓ All 24 hours" : "Select Full Day"}
                  </button>
                </div>
              </div>
            </section>

            {/* Charts */}
            {selectedKPIList.length > 0 && filteredRows.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">
                    Charts
                    {filterMode === "compare" && (
                      <span className="ml-2 text-xs text-primary/70 font-body normal-case">
                        — trend across weeks
                      </span>
                    )}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* X-Axis toggle (only in range mode) */}
                    {filterMode === "range" && (
                      <div
                        data-ocid="charts.xaxis_toggle"
                        className="flex items-center gap-1 bg-muted/30 border border-border rounded-lg p-1"
                      >
                        <button
                          type="button"
                          onClick={() => setXAxisMode("hourly")}
                          className={`px-3 py-1 text-xs rounded-md font-body transition-all ${
                            xAxisMode === "hourly"
                              ? "bg-primary/20 text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Hourly
                        </button>
                        <button
                          type="button"
                          onClick={() => setXAxisMode("daily")}
                          className={`px-3 py-1 text-xs rounded-md font-body transition-all ${
                            xAxisMode === "daily"
                              ? "bg-primary/20 text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Daily
                        </button>
                      </div>
                    )}
                    {/* Separate/Combined toggle (only in range mode) */}
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
                </div>

                {filterMode === "compare" ? (
                  <div
                    data-ocid="charts.kpi.card.1"
                    className="bg-card border border-border rounded-xl p-4 chart-container"
                  >
                    <div className="mb-3">
                      <h3 className="text-sm font-display font-medium text-foreground">
                        KPI Trend — Same Weekday Across Weeks
                      </h3>
                      <p className="text-xs text-muted-foreground font-body mt-0.5">
                        Each point = avg value for that date · hour filter
                        applied
                      </p>
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart
                        data={
                          compareChartData as Record<string, number | string>[]
                        }
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
                          labelFormatter={(_v, payload) =>
                            (payload?.[0]?.payload as Record<string, string>)
                              ?.dateLabel ?? ""
                          }
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
                          tickFormatter={(v) => axisTickFormatter(v)}
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
                          labelFormatter={(v) => tooltipLabelFormatter(v)}
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
                              margin={{
                                top: 4,
                                right: 8,
                                bottom: 4,
                                left: 0,
                              }}
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
                                tickFormatter={(v) => axisTickFormatter(v)}
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
                                labelFormatter={(v) => tooltipLabelFormatter(v)}
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
                            (a, b) =>
                              a.timestamp.getTime() - b.timestamp.getTime(),
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
                                      color:
                                        val !== undefined ? color : undefined,
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
          </div>
        </div>
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
