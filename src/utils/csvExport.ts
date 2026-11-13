export type CsvCell = string | number | boolean | null | undefined;

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function buildDelimitedCsvContent(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<CsvCell>>,
  delimiter = ';',
  includeBom = true
): string {
  const formatHeader = (header: string) =>
    header.includes('"') || header.includes('\n') || header.includes('\r') || header.includes(delimiter)
      ? escapeCsvCell(header)
      : header;

  const headerLine = headers.map(formatHeader).join(delimiter);
  const bodyLines = rows.map((row) => row.map(escapeCsvCell).join(delimiter));
  const csv = [headerLine, ...bodyLines].join('\n');
  return includeBom ? `\uFEFF${csv}` : csv;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadDelimitedCsv(
  filename: string,
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<CsvCell>>,
  delimiter = ';'
): void {
  const content = buildDelimitedCsvContent(headers, rows, delimiter, true);
  downloadTextFile(content, filename, 'text/csv;charset=utf-8;');
}
