window.LoginPage = {
  render(container) {
    document.getElementById('sidebar').style.display = 'none';
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'login-container';
    wrapper.innerHTML = `
      <div class="login-box">
        <div class="login-title">CHAT GUARDIAN</div>
        <div class="login-subtitle">Dashboard Access</div>
        <input type="password" id="pin-input" maxlength="10" placeholder="PIN" autofocus>
        <button id="pin-submit">Enter</button>
        <div class="login-error" id="login-error"></div>
      </div>
    `;
    container.appendChild(wrapper);
    const input = document.getElementById('pin-input');
    const submit = document.getElementById('pin-submit');
    const errorEl = document.getElementById('login-error');
    async function tryLogin() {
      const pin = input.value;
      if (!pin) { errorEl.textContent = 'Enter PIN'; return; }
      try {
        const res = await App.api('POST', '/auth/pin', { pin });
        if (res.success) {
          App.state.pin = pin;
          App.onAuthenticated();
        } else {
          errorEl.textContent = res.error || 'Invalid PIN';
          input.value = '';
          input.focus();
        }
      } catch (e) {
        errorEl.textContent = 'Connection error';
      }
    }
    submit.addEventListener('click', tryLogin);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
  }
};
