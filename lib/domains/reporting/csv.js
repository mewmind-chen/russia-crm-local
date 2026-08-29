'use strict';

// CSV export helpers. Cells are sanitized against spreadsheet formula
// injection and quoted whenever they contain separators, quotes, or
// line breaks; csvSerialize renders a UTF-8 BOM-prefixed document.

function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvSerialize(headers, rows) {
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = Object.freeze({
  csvCell,
  csvSerialize,
});
