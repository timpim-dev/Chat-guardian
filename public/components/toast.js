window.Toast = {
  show(message, severity, duration) {
    severity = severity || 'info';
    duration = duration || 5000;
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${severity}`;
    el.innerHTML = `<div class="toast-message">${message}</div><div class="toast-time">${new Date().toLocaleTimeString()}</div>`;
    container.appendChild(el);
    requestAnimationFrame(() => { el.classList.add('show'); });
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 200);
    }, duration);
  }
};
