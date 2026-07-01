window.UserStrikesPage = {
  expandedUser: null,

  async render(container) {
    container.innerHTML = `
      <div class="page-header"><span class="page-title">User Strikes</span></div>
      <div id="users-content"></div>
    `;
    await this.loadData();
  },

  async loadData() {
    const content = document.getElementById('users-content');
    if (!content) return;
    try {
      const users = await App.api('GET', '/api/users?hasStrikes=true');
      this.renderTable(content, users);
    } catch (e) {
      content.innerHTML = '<div class="empty-state">Error loading users</div>';
    }
  },

  renderTable(container, users) {
    const columns = [
      { key: 'username', label: 'User', render: (v, row) => `<a href="#" onclick="UserStrikesPage.toggleUser('${row.user_id}'); return false;" style="color:var(--accent-info-text);text-decoration:none">${App.escapeHtml(v)}</a>` },
      { key: 'current_points', label: 'Points', render: (v) => `<span class="${v > 10 ? 'text-danger' : v > 5 ? 'text-warn' : ''}">${v}</span>` },
      { key: 'strike_count', label: 'Strikes' },
      { key: 'last_timeout_at', label: 'Last Timeout', render: (v) => v ? App.formatDate(v) : '—' },
      { key: '_actions', label: 'Actions', render: (_, row) => `<button onclick="UserStrikesPage.clearStrikes('${row.user_id}')" class="btn-danger" style="margin-right:4px">Clear</button><button onclick="UserStrikesPage.showTimeoutModal('${row.user_id}', '${App.escapeHtml(row.username)}')">Timeout</button> <button onclick="UserStrikesPage.unban('${row.user_id}')" class="btn-success">Unban</button>` }
    ];
    const tableEl = Table.create({ columns, data: users, emptyText: 'No users with strikes' });
    container.innerHTML = '';
    container.appendChild(tableEl);
    if (this.expandedUser) {
      // Find and expand if it exists
      this.showStrikes(this.expandedUser);
    }
  },

  async toggleUser(userId) {
    if (this.expandedUser === userId) { this.expandedUser = null; this.loadData(); return; }
    this.expandedUser = userId;
    await this.showStrikes(userId);
  },

  async showStrikes(userId) {
    try {
      const userData = await App.api('GET', `/api/users/${userId}`);
      const strikesDiv = document.createElement('div');
      strikesDiv.id = 'user-strikes-detail';
      strikesDiv.style.cssText = 'padding:16px;border:1px solid var(--border);margin-top:8px;margin-bottom:16px;background:var(--bg);';
      strikesDiv.innerHTML = `<div class="mb-8" style="font-weight:700">Strike history: ${App.escapeHtml(userData.username)}</div>`;
      const cols = [
        { key: 'timestamp', label: 'Time', render: v => App.formatDate(v) },
        { key: 'category', label: 'Category', render: v => `<span class="badge badge-flagged">${v}</span>` },
        { key: 'points', label: 'Points' },
        { key: 'reversed', label: 'Status', render: v => v ? '<span class="text-muted">reversed</span>' : 'active' }
      ];
      const table = Table.create({ columns: cols, data: userData.strikes || [], emptyText: 'No strikes' });
      strikesDiv.appendChild(table);
      const existing = document.getElementById('user-strikes-detail');
      if (existing) existing.remove();
      const content = document.getElementById('users-content');
      if (content) content.appendChild(strikesDiv);
    } catch(e) { /* ignore */ }
  },

  clearStrikes(userId) {
    Modal.confirm('Clear Strikes', 'Are you sure you want to clear all strikes for this user? This reverses all point contributions.', async () => {
      await App.api('POST', `/api/users/${userId}/clear-strikes`);
      Toast.show('Strikes cleared', 'success');
      this.loadData();
    });
  },

  showTimeoutModal(userId, username) {
    Modal.show('Timeout User', `
      <p>Timeout <strong>${username}</strong></p>
      <div class="mt-8"><label>Duration (seconds):</label><input type="number" id="timeout-duration" value="600" min="1" max="1209600" style="margin-top:4px"></div>
      <div class="mt-8"><label>Reason:</label><input type="text" id="timeout-reason" value="Manual timeout" style="margin-top:4px"></div>
    `, [
      { text: 'Cancel', onClick: () => Modal.hide() },
      { text: 'Timeout', className: 'btn-danger', onClick: async () => {
        const duration = parseInt(document.getElementById('timeout-duration').value) || 600;
        const reason = document.getElementById('timeout-reason').value || 'Manual timeout';
        await App.api('POST', `/api/users/${userId}/timeout`, { duration, reason });
        Toast.show(`User timed out for ${duration}s`, 'warning');
        Modal.hide();
        this.loadData();
      }}
    ]);
  },

  async unban(userId) {
    Modal.confirm('Unban User', 'Are you sure you want to unban this user?', async () => {
      await App.api('POST', `/api/users/${userId}/unban`);
      Toast.show('User unbanned', 'success');
      this.loadData();
    });
  }
};
