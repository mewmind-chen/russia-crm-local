import { escapeAttribute, escapeHtml } from './html.js';
import { renderEmptyState } from './empty-state.js';

function cellValue(row, column, rowIndex) {
  if (typeof column.value === 'function') return column.value(row, rowIndex);
  if (typeof column.render === 'function') return column.render(row, rowIndex);
  return row?.[column.key];
}

export function renderTable({
  columns = [],
  rows = [],
  caption = '',
  emptyState = {},
  rowKey = 'id',
  className = '',
} = {}) {
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    throw new TypeError('renderTable requires columns and rows arrays');
  }
  if (!columns.length) return renderEmptyState({ title: '暂无可显示字段', ...emptyState });
  if (!rows.length) return renderEmptyState(emptyState);

  const head = columns.map(column =>
    `<th scope="col">${escapeHtml(column.label ?? column.key ?? '')}</th>`).join('');
  const body = rows.map((row, rowIndex) => {
    const key = typeof rowKey === 'function' ? rowKey(row, rowIndex) : row?.[rowKey];
    const cells = columns.map(column => {
      const value = cellValue(row, column, rowIndex);
      return `<td data-label="${escapeAttribute(column.label ?? column.key ?? '')}">${escapeHtml(value)}</td>`;
    }).join('');
    return `<tr${key === undefined || key === null ? '' : ` data-row-key="${escapeAttribute(key)}"`}>${cells}</tr>`;
  }).join('');

  return `<div class="table-scroll ${escapeAttribute(className)}" tabindex="0">
    <table>
      ${caption ? `<caption>${escapeHtml(caption)}</caption>` : ''}
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}
