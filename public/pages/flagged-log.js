window.FlaggedLogPage = {
  currentTab: 'flagged',
  page: 0,
  pageSize: 50,
  searchTerm: '',
  searchTimeout: null,

  async render(container) {
    container.innerHTML = `
      <div class="page-header"><span class="page-title">Flagged & Blocked Log</span></div>
      <div class="tabs">
        <div class="tab active" data-tab="flagged">Flagged & Blocked</div>
        <div class="tab" data-tab="disputed">Disputed</div>
      </div>
      <div class="flex gap-8 mb-16">
        <input type="text" id="flagged-search" class="search-box" placeholder="Search by username or message...">
      </div>
      <div id="flagged-content"></div>
    `;
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentTab = tab.dataset.tab;
        this.page = 0;
        this.loadData();
      });
    });
    document.getElementById('flagged-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.searchTerm = e.target.value;
        this.page = 0;
        this.loadData();
      }, 300);
    });
    await this.loadData();
  },

  async loadData() {
    const content = document.getElementById('flagged-content');
    if (!content) return;
    try {
      let data;
      if (this.currentTab === 'disputed') {
        data = await App.api('GET', '/api/messages/disputed');
      } else {
        const params = new URLSearchParams({ limit: this.pageSize, offset: this.page * this.pageSize });
        if (this.searchTerm) params.set('search', this.searchTerm);
        data = await App.api('GET', `/api/messages/flagged?${params}`);
      }
      this.renderTable(content, data);
    } catch (e) {
      content.innerHTML = `<div class="empty-state">Error loading data</div>`;
    }
  },

  renderTable(container, data) {
    const isDisputed = this.currentTab === 'disputed';
    const columns = [
      { key: 'timestamp', label: 'Time', render: (v) => App.formatDate(v) },
      { key: 'username', label: 'User' },
      { key: 'message_text', label: 'Message', render: (v) => `<span title="${App.escapeHtml(v)}">${App.escapeHtml(v).slice(0, 80)}${v.length > 80 ? '...' : ''}</span>` },
      { key: 'categories', label: 'Categories', render: (v) => { try { const arr = typeof v === 'string' ? JSON.parse(v) : v; return arr.map(c => `<span class="badge badge-flagged">${c}</span>`).join(' '); } catch(e) { return v; } } },
      { key: 'points', label: 'Pts' },
      { key: 'action_taken', label: 'Action' },
      { key: '_actions', label: '', render: (_, row) => {
        if (isDisputed) {
          return `<button class="btn-success" onclick="FlaggedLogPage.resolveDispute('${row.id}', true)">Approve</button> <button class="btn-danger" onclick="FlaggedLogPage.resolveDispute('${row.id}', false)">Deny</button>`;
        }
        if (row.disputed) return '<span class="badge badge-disputed">disputed</span>';
        return `<button onclick="FlaggedLogPage.dispute('${row.id}')">Report</button>`;
      }}
    ];
    const tableEl = Table.create({ columns, data, emptyText: isDisputed ? 'No disputed messages' : 'No flagged messages' });
    container.innerHTML = '';
    container.appendChild(tableEl);
    if (!isDisputed) {
      const pag = document.createElement('div');
      pag.className = 'pagination';
      pag.innerHTML = `<button ${this.page === 0 ? 'disabled' : ''} onclick="FlaggedLogPage.prevPage()">← Prev</button><span class="page-info">Page ${this.page + 1}</span><button ${data.length < this.pageSize ? 'disabled' : ''} onclick="FlaggedLogPage.nextPage()">Next →</button>`;
      container.appendChild(pag);
    }
  },

  async dispute(msgId) {
    await App.api('POST', `/api/messages/${msgId}/dispute`);
    Toast.show('Message reported as wrongly blocked', 'info');
    this.loadData();
  },

  async resolveDispute(msgId, reverse) {
    await App.api('POST', `/api/messages/${msgId}/resolve`, { reverse });
    Toast.show(reverse ? 'Dispute approved — points reversed' : 'Dispute denied', reverse ? 'success' : 'info');
    this.loadData();
  },

  prevPage() { if (this.page > 0) { this.page--; this.loadData(); } },
  nextPage() { this.page++; this.loadData(); }
};
