window.Table = {
  create(options) {
    const { columns, data, onSort, emptyText } = options;
    const container = document.createElement('div');
    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state">${emptyText || 'No data'}</div>`;
      return container;
    }
    let html = '<table><thead><tr>';
    columns.forEach(col => {
      const sortClass = col.sortable ? 'sortable' : '';
      html += `<th class="${sortClass}" data-key="${col.key}">${col.label}</th>`;
    });
    html += '</tr></thead><tbody>';
    data.forEach((row, idx) => {
      html += `<tr data-idx="${idx}">`;
      columns.forEach(col => {
        const val = col.render ? col.render(row[col.key], row, idx) : (row[col.key] != null ? String(row[col.key]) : '');
        html += `<td>${val}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    if (onSort) {
      container.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => onSort(th.dataset.key));
      });
    }
    return container;
  }
};
