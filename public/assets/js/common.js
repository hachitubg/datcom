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

  global.AppUtils = {
    normalizeName,
    fetchJson,
    formatCurrency,
    formatDateTime
  };
}(window));
