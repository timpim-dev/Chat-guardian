window.Modal = {
  show(title, contentHTML, buttons) {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    let buttonsHTML = '';
    if (buttons) {
      buttonsHTML = buttons.map((b, i) =>
        `<button class="${b.className || ''}" data-btn-idx="${i}">${b.text}</button>`
      ).join('');
    }
    overlay.innerHTML = `<div class="modal-box"><div class="modal-title">${title}</div><div class="modal-content">${contentHTML}</div><div class="modal-buttons">${buttonsHTML}</div></div>`;
    if (buttons) {
      buttons.forEach((b, i) => {
        const btn = overlay.querySelector(`[data-btn-idx="${i}"]`);
        if (btn && b.onClick) btn.addEventListener('click', b.onClick);
      });
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) Modal.hide();
    });
  },
  hide() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  },
  confirm(title, message, onConfirm) {
    Modal.show(title, `<p>${message}</p>`, [
      { text: 'Cancel', onClick: () => Modal.hide() },
      { text: 'Confirm', className: 'btn-danger', onClick: () => { Modal.hide(); onConfirm(); } }
    ]);
  }
};
