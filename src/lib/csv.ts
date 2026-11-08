// RFC 4180 CSV with a UTF-8 BOM so Excel shows Khmer text correctly. Every field quoted; null → empty.
// A leading = + - @ is prefixed with ' so a note can't run as a spreadsheet formula (CSV injection).
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return '"' + (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
}
export const toCsv = (rows: Record<string, unknown>[]) =>
  rows.length ? '\uFEFF' + [Object.keys(rows[0]), ...rows.map(r => Object.values(r))].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n' : '\uFEFF'
