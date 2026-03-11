export interface ParsedRow {
  timestamp: Date;
  kpis: Record<string, number>;
  rawValues: Record<string, string>;
}

export interface ParsedCSV {
  headers: string[];
  timestampCol: string;
  kpiCols: string[];
  rows: ParsedRow[];
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseNumericValue(val: string): number {
  const cleaned = val.replace(/%$/, "").trim();
  return Number.parseFloat(cleaned);
}

function parseTimestamp(val: string): Date | null {
  if (!val) return null;
  const d = new Date(val);
  if (!Number.isNaN(d.getTime())) return d;

  const match = val.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (match) {
    const d2 = new Date(`${match[1]}T${match[2]}`);
    if (!Number.isNaN(d2.getTime())) return d2;
  }

  return null;
}

export function parseCSV(csvText: string): ParsedCSV {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { headers: [], timestampCol: "", kpiCols: [], rows: [] };
  }

  const headers = parseCSVLine(lines[0]);
  const timestampCol = headers[0];
  const kpiCols = headers.slice(1).filter((h) => h.length > 0);

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length < 2) continue;

    const ts = parseTimestamp(parts[0]);
    if (!ts) continue;

    const kpis: Record<string, number> = {};
    const rawValues: Record<string, string> = {};
    let hasValidKPI = false;

    for (let j = 0; j < kpiCols.length; j++) {
      const colName = kpiCols[j];
      const rawVal = parts[j + 1] ?? "";
      rawValues[colName] = rawVal;
      const num = parseNumericValue(rawVal);
      if (!Number.isNaN(num)) {
        kpis[colName] = num;
        hasValidKPI = true;
      }
    }

    if (hasValidKPI) {
      rows.push({ timestamp: ts, kpis, rawValues });
    }
  }

  return { headers, timestampCol, kpiCols, rows };
}
