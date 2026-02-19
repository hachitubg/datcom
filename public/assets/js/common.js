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

  global.AppUtils = {
    normalizeName,
    fetchJson,
    formatCurrency
  };
}(window));
