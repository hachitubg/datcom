(function initAppUtils(global) {
  const currencyFormatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

  function normalizeName(name) {
    const compact = (name || '').trim().replace(/\s+/g, ' ');
    if (!compact) return '';

    return compact
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Yêu cầu thất bại');
    }

    return data;
  }

  function formatCurrency(value) {
    return currencyFormatter.format(value || 0);
  }

  // SQLite lưu CURRENT_TIMESTAMP theo UTC (không có ký hiệu timezone).
  // PayOS có thể trả về chuỗi đã có timezone (+07:00 hoặc Z).
  // Hàm này xử lý cả hai trường hợp: nếu chưa có timezone thì coi là UTC rồi convert sang giờ địa phương.
  function formatDateTime(value) {
    if (!value) return '-';
    const normalized = String(value).replace(' ', 'T');
    const hasTimezone = /[Zz]$|[+\-]\d{2}:\d{2}$/.test(normalized);
    const date = new Date(hasTimezone ? normalized : normalized + 'Z');
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN');
  }

  // Custom Popup System (replaces alert/confirm/prompt)
  function showPopup(message, { type = 'alert', defaultValue = '', fields = null, confirmLabel = 'OK', cancelLabel = 'Hủy', danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'popup-overlay';

      let inputsHtml = '';
      if (type === 'prompt') {
        if (fields) {
          inputsHtml = fields.map((f, i) => {
            const tag = f.type === 'textarea'
              ? `<textarea class="popup-textarea" id="popupField${i}" placeholder="${f.placeholder || ''}">${f.value || ''}</textarea>`
              : `<input class="popup-input" id="popupField${i}" type="${f.inputType || 'text'}" value="${(f.value || '').replace(/"/g, '&quot;')}" placeholder="${f.placeholder || ''}">`;
            return `<label class="popup-input-label">${f.label}</label>${tag}`;
          }).join('');
        } else {
          inputsHtml = `<input class="popup-input" id="popupField0" type="text" value="${String(defaultValue).replace(/"/g, '&quot;')}">`;
        }
      }

      overlay.innerHTML = `
        <div class="popup-box">
          <div class="popup-body">
            <div class="popup-message">${message}</div>
            ${inputsHtml}
          </div>
          <div class="popup-actions">
            ${type !== 'alert' ? `<button class="popup-btn popup-btn-cancel" id="popupCancel">${cancelLabel}</button>` : ''}
            <button class="popup-btn ${danger ? 'popup-btn-danger' : 'popup-btn-ok'}" id="popupOk">${confirmLabel}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const firstInput = overlay.querySelector('.popup-input, .popup-textarea');
      if (firstInput) {
        firstInput.focus();
        if (firstInput.tagName === 'INPUT') firstInput.select();
      }

      function getResult() {
        if (type === 'prompt') {
          if (fields) {
            const result = {};
            fields.forEach((f, i) => {
              result[f.name] = overlay.querySelector(`#popupField${i}`).value;
            });
            return result;
          }
          return overlay.querySelector('#popupField0').value;
        }
        return true;
      }

      function close(value) {
        overlay.remove();
        resolve(value);
      }

      overlay.querySelector('#popupOk').addEventListener('click', () => close(getResult()));
      const cancelBtn = overlay.querySelector('#popupCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => close(null));

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(type === 'alert' ? undefined : null);
      });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          close(getResult());
        }
        if (e.key === 'Escape') close(type === 'alert' ? undefined : null);
      });
    });
  }

  global.showPopup = showPopup;

  global.AppUtils = {
    normalizeName,
    fetchJson,
    formatCurrency,
    formatDateTime,
    showPopup
  };
}(window));
