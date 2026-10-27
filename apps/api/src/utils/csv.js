/**
 * CSV serialisation with spreadsheet formula-injection protection.
 *
 * A cell whose text begins with `=`, `+`, `-`, `@`, a tab or a carriage return
 * is interpreted as a formula by Excel, Google Sheets and LibreOffice. Since
 * exported values include free text an attacker can influence — investigation
 * notes, account references, resolution summaries — every such cell is
 * neutralised with a leading apostrophe before quoting.
 */

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** True when the raw cell text would be parsed as a formula by a spreadsheet. */
export function isFormulaLike(text) {
  return typeof text === 'string' && text.length > 0 && FORMULA_TRIGGERS.includes(text[0]);
}

/**
 * Escapes one value into a CSV field: neutralises formulas, then quotes and
 * doubles any embedded quotes.
 */
export function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';

  let text;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  // Strip control characters that would corrupt the file structure. The rule
  // below flags control characters in regular expressions as usually
  // accidental; here they are precisely the point.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  if (isFormulaLike(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Joins one row of already-raw values into a CSV line. */
export function toCsvRow(values) {
  return values.map(escapeCsvCell).join(',');
}

/**
 * Builds a complete CSV document.
 *
 * @param {{key: string, header: string}[]} columns Column definitions, in order.
 * @param {object[]} rows Row objects keyed by `columns[].key`.
 * @returns {string} CSV text with CRLF line endings, as RFC 4180 specifies.
 */
export function buildCsv(columns, rows) {
  const lines = [toCsvRow(columns.map((column) => column.header))];
  for (const row of rows) {
    lines.push(toCsvRow(columns.map((column) => row[column.key])));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Builds a safe `Content-Disposition` filename for an export. */
export function exportFilename(dataset, from, to) {
  const slug = String(dataset).replace(/[^a-z0-9-]/gi, '');
  const stamp = (date) => date.toISOString().slice(0, 10);
  return `fraudlens-${slug}-${stamp(from)}-to-${stamp(to)}.csv`;
}
