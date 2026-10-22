(function initPaymentHub() {
    const $ = (id) => document.getElementById(id);
    const esc = AppUtils.escapeHtml;
    const money = AppUtils.formatCurrency;
    const dateLabel = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.split('-').reverse().join('/') : AppUtils.formatDateTime(date);
    let account = null;
    let selectedTab = 'overview';
    let requestId = 0;
    let detailRequest = 0;
    let debtRequest = 0;
    const pageSize = 10;

    function summaryHtml(summary) {
        return `<div class="payment-balance"><span>Còn phải thanh toán</span><strong>${money(summary.remainingAmount)}</strong>${summary.creditAmount > 0 ? `<p>Số dư trả trước: <strong>${money(summary.creditAmount)}</strong></p>` : ''}</div>
            <div class="payment-totals"><span>Tiền cơm<strong>${money(summary.totalAmount)}</strong></span><span>Đã trả<strong>${money(summary.paidAmount)}</strong></span><span>Đã đặt<strong>${Number(summary.totalServings)} suất</strong></span></div>`;
    }
    function renderHistory(container, rows, kind) {
        let page = 1;
        let month = '';
        const draw = () => {
            const filtered = month ? rows.filter((row) => String(kind === 'orders' ? row.date : localDate(row.date)).startsWith(month)) : rows;
            const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
            page = Math.min(page, pages);
            const records = filtered.slice((page - 1) * pageSize, page * pageSize);
            container.innerHTML = `<div class="payment-history-filter"><label>Tháng <input type="month" data-history-month value="${esc(month)}"></label><button type="button" class="btn-secondary" data-reset-month>Tất cả</button></div>
                <div class="payment-timeline">${records.length ? records.map((row) => kind === 'orders' ? orderRow(row) : `<article class="payment-history-row"><div><strong>${esc(dateLabel(row.date))}</strong><small>Đã thanh toán</small></div><strong>${money(row.amount)}</strong></article>`).join('') : '<div class="customer-list-empty">Chưa có lịch sử trong khoảng này.</div>'}</div>
                <div class="payment-paging"><button type="button" class="btn-secondary" data-page-back ${page === 1 ? 'disabled' : ''}>Trước</button><span>${page}/${pages} · ${filtered.length} ${kind === 'orders' ? 'ngày' : 'lần'}</span><button type="button" class="btn-secondary" data-page-next ${page === pages ? 'disabled' : ''}>Sau</button></div>`;
            container.querySelector('[data-history-month]').onchange = (event) => { month = event.target.value; page = 1; draw(); };
            container.querySelector('[data-reset-month]').onclick = () => { month = ''; page = 1; draw(); };
            container.querySelector('[data-page-back]').onclick = () => { page--; draw(); };
            container.querySelector('[data-page-next]').onclick = () => { page++; draw(); };
        };
        draw();
    }
    function localDate(value) {
        const raw = String(value || '').replace(' ', 'T');
        const date = new Date(/[Zz]$|[+\-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
        if (Number.isNaN(date.getTime())) return raw;
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function orderRow(row) {
        const label = row.paymentStatus === 'PAID' ? 'Đã thanh toán' : row.paymentStatus === 'PARTIAL' ? 'Thanh toán một phần' : 'Chưa thanh toán';
        return `<article class="payment-day-row"><div class="payment-day-heading"><strong>${esc(dateLabel(row.date))}</strong><span class="customer-order-quantity ${row.quantity > 1 ? 'quantity-multiple' : ''}">${Number(row.quantity)} suất</span></div>
            <div class="payment-day-money"><span>Tiền cơm ${money(row.totalAmount)}</span><span class="${row.remainingAmount > 0 ? 'has-debt' : 'settled'}">${label}</span></div>
            ${row.remainingAmount > 0 ? `<p class="payment-day-debt">Đã trả ${money(row.paidAmount)} · Còn ${money(row.remainingAmount)}</p>` : ''}
            ${(row.items || []).map((item) => `<p class="payment-day-note">${Number(item.quantity)} suất${item.description ? ` · ${esc(item.description)}` : ''}${item.promo_code ? ` · Giảm ${Number(item.discount_percent)}% cho 1 suất` : ''}</p>`).join('')}</article>`;
    }
    function renderAccountTab() {
        if (!account) return;
        const content = $('paymentPersonalContent');
        const isList = selectedTab === 'list';
        $('paymentPublicSection').hidden = !isList;
        content.hidden = isList;
        document.querySelectorAll('[data-payment-tab]').forEach((button) => {
            button.classList.toggle('active', button.dataset.paymentTab === selectedTab);
            button.setAttribute('aria-pressed', String(button.dataset.paymentTab === selectedTab));
        });
        if (isList) { loadDebtList(); return; }
        if (selectedTab === 'orders' || selectedTab === 'payments') {
            renderHistory(content, account[selectedTab] || [], selectedTab);
            return;
        }
        content.innerHTML = `${summaryHtml(account.summary)}<div class="payment-account-actions">${account.summary.remainingAmount > 0 ? `<button class="btn-submit pay-btn" data-customer-name="${encodeURIComponent(account.name)}">Thanh toán ${money(account.summary.remainingAmount)}</button>` : '<p class="settled">Bạn đã thanh toán đủ tiền cơm.</p>'}</div><p class="payment-help">Các khoản đã trả được trừ vào đơn cũ trước. Xem từng ngày tại “Lịch sử đặt”.</p>`;
    }
    async function open() {
        const request = ++requestId;
        account = null;
        $('paymentAccountPanel').hidden = true;
        $('paymentHubTabs').hidden = true;
        $('paymentPersonalContent').hidden = false;
        $('paymentPublicSection').hidden = true;
        $('paymentPersonalContent').innerHTML = '<div class="loading-text">Đang tải thông tin thanh toán…</div>';
        if (!currentUser) {
            $('paymentPersonalContent').hidden = true;
            $('paymentPublicSection').hidden = false;
            $('paymentSearch').value = '';
            return loadDebtList();
        }
        try {
            const data = await AppUtils.fetchJson(`${API_BASE}/api/payments/me`);
            if (request !== requestId) return;
            account = data;
            selectedTab = 'overview';
            $('paymentSearch').value = '';
            $('paymentAccountPanel').textContent = data.name;
            $('paymentAccountPanel').hidden = false;
            $('paymentHubTabs').hidden = false;
            renderAccountTab();
        } catch (error) {
            if (request !== requestId) return;
            $('paymentPersonalContent').innerHTML = `<div class="error-message">${esc(error.message)}</div><button class="btn-secondary" type="button" id="retryPaymentHub">Thử lại</button>`;
            $('retryPaymentHub').onclick = open;
        }
    }
    async function loadDebtList() {
        const request = ++debtRequest;
        const list = $('paymentList');
        list.innerHTML = '<div class="loading-text">Đang tải công nợ…</div>';
        try {
            const rows = await AppUtils.fetchJson(`${API_BASE}/api/payments/today?search=${encodeURIComponent($('paymentSearch').value.trim())}`);
            if (request !== debtRequest) return;
            const debts = (Array.isArray(rows) ? rows : []).filter((row) => Number(row.remainingAmount) > 0);
            list.innerHTML = debts.length ? debts.map((row) => `<article class="customer-payment-row"><div class="customer-payment-heading"><div class="order-info"><h4>${esc(row.name)}</h4><p>${Number(row.quantity || 0)} suất còn nợ</p></div><div class="customer-payment-amount"><span>Còn phải trả</span><strong>${money(row.remainingAmount)}</strong></div></div><div class="payment-action-group"><button type="button" class="payment-detail-btn" data-customer-name="${encodeURIComponent(row.name)}">Chi tiết</button><button type="button" class="pay-btn" data-customer-name="${encodeURIComponent(row.name)}">Thanh toán</button></div></article>`).join('') : '<div class="customer-list-empty">Không có công nợ phù hợp.</div>';
        } catch (error) { if (request === debtRequest) list.innerHTML = `<div class="error-message">${esc(error.message)}</div>`; }
    }
    async function showCustomerOrders(name) {
        const request = ++detailRequest;
        const container = $('paymentDetailContent');
        $('paymentDetailModal').style.display = 'flex';
        container.innerHTML = '<div class="loading-text">Đang tải lịch sử đặt cơm…</div>';
        try {
            const data = await AppUtils.fetchJson(`${API_BASE}/api/payments/customers/${encodeURIComponent(name)}/orders`);
            if (request !== detailRequest) return;
            container.innerHTML = `<h3 class="payment-customer-title">${esc(data.name)}</h3>${summaryHtml(data.summary)}<p class="payment-help">Lịch sử gồm cả ngày đã thanh toán và chưa thanh toán.</p><div id="customerOrderHistory"></div>`;
            renderHistory($('customerOrderHistory'), data.orders || [], 'orders');
        } catch (error) { if (request === detailRequest) container.innerHTML = `<div class="error-message">${esc(error.message)}</div>`; }
    }
    document.querySelectorAll('[data-payment-tab]').forEach((button) => {
        button.onclick = () => { selectedTab = button.dataset.paymentTab; renderAccountTab(); };
    });
    $('paymentPersonalContent').addEventListener('click', (event) => {
        const button = event.target.closest('.pay-btn');
        if (button && account && !button.disabled) window.openPayQr(account.name);
    });
    window.PaymentHub = { open, loadDebtList, showCustomerOrders };
}());
