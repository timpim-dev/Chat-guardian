window.LiveFeedPage = {
  messages: [],
  filter: 'all',
  autoScroll: true,
  maxMessages: 500,

  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div><span class="page-title">Live Feed</span> <span class="page-subtitle" id="msg-count"></span></div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="safe">Safe</button>
        <button class="filter-btn" data-filter="flagged">Flagged</button>
        <button class="filter-btn" data-filter="blocked">Blocked</button>
      </div>
      <div id="message-feed"></div>
    `;
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        LiveFeedPage.filter = btn.dataset.filter;
        LiveFeedPage.applyFilter();
      });
    });
    const feed = document.getElementById('message-feed');
    feed.addEventListener('scroll', () => {
      const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
      LiveFeedPage.autoScroll = atBottom;
    });
    this.updateCount();
    this.rebuildFeed();
  },

  rebuildFeed() {
    const feed = document.getElementById('message-feed');
    if (!feed) return;
    feed.innerHTML = '';
    this.messages.forEach(msg => {
      const el = this.createMessageEl(msg);
      feed.appendChild(el);
      this.applyFilterToEl(el);
    });
    if (this.autoScroll) feed.scrollTop = feed.scrollHeight;
  },

  addMessage(msg) {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) this.messages.shift();
    const feed = document.getElementById('message-feed');
    if (!feed) return;
    const el = this.createMessageEl(msg);
    feed.appendChild(el);
    if (feed.children.length > this.maxMessages) feed.removeChild(feed.firstChild);
    this.applyFilterToEl(el);
    if (this.autoScroll) feed.scrollTop = feed.scrollHeight;
    this.updateCount();
  },

  updateMessage(update) {
    const el = document.querySelector(`[data-msg-id="${update.id}"]`);
    const msg = this.messages.find(m => m.id === update.id);
    if (msg) {
      if (update.verdict) msg.verdict = update.verdict;
      if (update.points !== undefined) msg.points = update.points;
      if (update.categories) msg.categories = update.categories;
      if (update.action_taken) msg.action_taken = update.action_taken;
    }
    if (!el) return;
    const badge = el.querySelector('.msg-verdict');
    if (badge && update.verdict) {
      badge.className = `msg-verdict badge badge-${update.verdict}`;
      badge.textContent = update.verdict;
    }
    if (update.verdict) {
      el.className = `chat-msg chat-msg--${update.verdict}`;
      el.dataset.verdict = update.verdict;
    }
    const ptsEl = el.querySelector('.msg-points');
    if (ptsEl && update.points !== undefined) {
      ptsEl.textContent = update.points > 0 ? `${update.points}pts` : '';
    }
    this.applyFilterToEl(el);
  },

  createMessageEl(msg) {
    const el = document.createElement('div');
    el.className = `chat-msg chat-msg--${msg.verdict || 'safe'}`;
    el.dataset.msgId = msg.id;
    el.dataset.verdict = msg.verdict || 'safe';
    const time = App.formatTime(msg.timestamp);
    const pts = msg.points > 0 ? `<span class="msg-points">${msg.points}pts</span>` : '<span class="msg-points"></span>';
    el.innerHTML = `<span class="msg-time">${time}</span><span class="msg-user">${App.escapeHtml(msg.username)}</span><span class="msg-text">${App.escapeHtml(msg.message_text)}</span>${pts}<span class="msg-verdict badge badge-${msg.verdict || 'safe'}">${msg.verdict || 'safe'}</span>`;
    return el;
  },

  applyFilter() {
    const feed = document.getElementById('message-feed');
    if (!feed) return;
    Array.from(feed.children).forEach(el => this.applyFilterToEl(el));
  },

  applyFilterToEl(el) {
    if (this.filter === 'all') { el.style.display = ''; return; }
    el.style.display = el.dataset.verdict === this.filter ? '' : 'none';
  },

  updateCount() {
    const el = document.getElementById('msg-count');
    if (el) el.textContent = `(${this.messages.length} messages)`;
  }
};
