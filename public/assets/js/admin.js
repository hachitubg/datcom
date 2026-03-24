const API_BASE = '';
let currentHistoryDetailDate = '';
let currentPaymentView = 'debt';
let editingOrderId = 0;

const PAGE_SIZE = 10;
let historyOrders = [];
let historyCurrentPage = 1;
let debtRows = [];
let debtCurrentPage = 1;
let paymentRows = [];
let paymentCurrentPage = 1;

// ===== Tìm kiếm lịch sử theo tên =====
let allCustomerNames = [];

function loadAllCustomerNames() {
    fetch(`${API_BASE}/api/customers/names`)
        .then(res => res.json())
        .then(names => { allCustomerNames = names || []; })
        .catch(() => {});
}

let historyNameSearchTimer = null;
function onHistoryNameSearchInput() {
    clearTimeout(historyNameSearchTimer);
    historyNameSearchTimer = setTimeout(updateHistoryNameSuggestions, 150);
}

function updateHistoryNameSuggestions() {
    const input = document.getElementById('historyNameSearch');
    const query = (input?.value || '').trim().toLowerCase();
    const dropdown = document.getElementById('historyNameSuggestions');
    if (!query) { dropdown.style.display = 'none'; return; }

    const normalized = query.replace(/\s+/g, '');
    const matches = allCustomerNames.filter(n =>
        n.toLowerCase().includes(query) ||
        n.toLowerCase().replace(/\s+/g, '').includes(normalized)
    );
    if (!matches.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = matches.slice(0, 12).map(name =>
        `<div class="name-suggestion-item" onmousedown="selectHistoryName('${encodeURIComponent(name)}')">${name}</div>`
    ).join('');
    dropdown.style.display = 'block';
}

function selectHistoryName(encodedName) {
    const name = decodeURIComponent(encodedName || '');
    if (!name) return;
    document.getElementById('historyNameSearch').value = name;
    document.getElementById('historyNameSuggestions').style.display = 'none';
    openCustomerFullHistoryModal(name);
}

function onHistoryNameSearchKeyDown(event) {
    const dropdown = document.getElementById('historyNameSuggestions');
    if (event.key === 'Enter') {
        event.preventDefault();
        const firstItem = dropdown.querySelector('.name-suggestion-item');
        if (firstItem) {
            firstItem.dispatchEvent(new MouseEvent('mousedown'));
        } else {
            const name = (document.getElementById('historyNameSearch')?.value || '').trim();
            if (name) { dropdown.style.display = 'none'; openCustomerFullHistoryModal(name); }
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
    }
}

function searchHistoryByName() {
    const name = (document.getElementById('historyNameSearch')?.value || '').trim();
    if (!name) { showPopup('Vui lòng nhập tên cần tìm kiếm.'); return; }
    document.getElementById('historyNameSuggestions').style.display = 'none';
    openCustomerFullHistoryModal(name);
}

function openCustomerFullHistoryModal(customerName) {
    if (!customerName) return;
    document.getElementById('customerFullHistoryTitle').textContent = `LỊCH SỬ ĐẶT CƠM — ${customerName}`;
    const content = document.getElementById('customerFullHistoryContent');
    content.innerHTML = '<div class="loading">Đang tải...</div>';
    document.getElementById('customerFullHistoryModal').style.display = 'flex';

    fetch(`${API_BASE}/api/admin/customers/${encodeURIComponent(customerName)}/full-history`)
        .then(res => res.json())
        .then(data => {
            const rows = data.rows || [];
            if (!rows.length) {
                content.innerHTML = '<div style="padding: 12px; color:#999; text-align:center;">Không tìm thấy lịch sử đặt cơm của người này.</div>';
                return;
            }

            const statusBadgeMap = {
                PAID:    { cls: 'psb-paid',      label: '✓ Đã thanh toán' },
                PARTIAL: { cls: 'psb-pending',   label: '⚡ Thanh toán 1 phần' },
                UNPAID:  { cls: 'psb-expired',   label: '✗ Chưa thanh toán' }
            };

            const summaryHtml = `
                <div class="customer-history-summary">
                    <div class="customer-history-stat">
                        <div class="stat-val">${data.totalOrders || 0}</div>
                        <div class="stat-lbl">Tổng xuất</div>
                    </div>
                    <div class="customer-history-stat">
                        <div class="stat-val">${AppUtils.formatCurrency(data.totalAmount || 0)}</div>
                        <div class="stat-lbl">Tổng tiền</div>
                    </div>
                    <div class="customer-history-stat">
                        <div class="stat-val" style="color:#2d7a2d;">${AppUtils.formatCurrency(data.totalPaidAmount || 0)}</div>
                        <div class="stat-lbl">Đã thanh toán</div>
                    </div>
                    <div class="customer-history-stat">
                        <div class="stat-val" style="color:#c46060;">${AppUtils.formatCurrency(data.totalRemaining || 0)}</div>
                        <div class="stat-lbl">Còn nợ</div>
                    </div>
                </div>
            `;

            const rowsHtml = rows.map(row => {
                const { cls, label } = statusBadgeMap[row.paymentStatus] || statusBadgeMap['UNPAID'];
                const rowClass = row.paymentStatus === 'PAID' ? 'row-paid' : row.paymentStatus === 'PARTIAL' ? 'row-partial' : 'row-unpaid';
                let promoHtml = '';
                if (row.promos && row.promos.length > 0) {
                    promoHtml = row.promos.map(p =>
                        `<div class="promo-detail-note">🎫 Mã <strong>${p.promo_code}</strong>: giảm ${p.discount_percent}% · ${p.quantity} xuất × ${AppUtils.formatCurrency(p.finalPrice)}/xuất</div>`
                    ).join('');
                }
                return `
                    <div class="customer-history-order-row ${rowClass}">
                        <div>
                            <div style="font-weight:600; color:#A0826D; margin-bottom:3px;">${row.date}</div>
                            <div class="admin-payment-meta">${row.quantity} xuất × ${AppUtils.formatCurrency(row.unitPrice)}</div>
                            ${row.paidAmount > 0 ? `<div class="admin-payment-meta" style="color:#2d7a2d;">Đã trả: ${AppUtils.formatCurrency(row.paidAmount)}</div>` : ''}
                            ${row.remainingAmount > 0 ? `<div class="admin-payment-meta" style="color:#c46060;">Còn nợ: ${AppUtils.formatCurrency(row.remainingAmount)}</div>` : ''}
                            ${promoHtml}
                        </div>
                        <div style="text-align:right; flex-shrink:0;">
                            <span class="payment-status-badge ${cls}">${label}</span>
                            <div style="font-weight:700; color:#A0826D; margin-top:6px; font-size:15px;">${AppUtils.formatCurrency(row.totalAmount)}</div>
                        </div>
                    </div>
                `;
            }).join('');

            content.innerHTML = summaryHtml + rowsHtml;
        })
        .catch(err => {
            content.innerHTML = `<div style="padding: 12px; color:red;">Lỗi tải dữ liệu: ${err.message}</div>`;
        });
}

function closeCustomerFullHistoryModal() {
    document.getElementById('customerFullHistoryModal').style.display = 'none';
}

function switchTab(tab, event) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tab).classList.add('active');
    const clickedBtn = event && event.target ? event.target.closest('.tab-btn') : null;
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    } else {
        const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => (btn.getAttribute('onclick') || '').includes(`'${tab}'`));
        if (activeBtn) activeBtn.classList.add('active');
    }

    if (tab === 'today') {
        loadTodayInfo();
    } else if (tab === 'history') {
        loadHistory();
    } else if (tab === 'payments') {
        switchPaymentView(currentPaymentView);
    } else if (tab === 'promos') {
        loadPromoCodes();
    } else if (tab === 'users') {
        loadUsers();
    } else if (tab === 'settings') {
        loadSettings();
    }
}

function loadTodayInfo() {
    fetch(`${API_BASE}/api/today`)
        .then(res => res.json())
        .then(data => {
            // Parse menu data
            if (typeof data.menu === 'string') {
                // If it's a simple string, try to parse it or use as is
                const menuObj = parseMenu(data.menu);
                document.getElementById('monChinh').value = menuObj.monChinh || '';
                document.getElementById('monPhu').value = menuObj.monPhu || '';
                document.getElementById('rau').value = menuObj.rau || '';
                document.getElementById('canh').value = menuObj.canh || '';
                document.getElementById('alternativeItems').value = menuObj.alternatives || '';
            } else if (typeof data.menu === 'object') {
                // If it's already an object
                document.getElementById('monChinh').value = data.menu.monChinh || '';
                document.getElementById('monPhu').value = data.menu.monPhu || '';
                document.getElementById('rau').value = data.menu.rau || '';
                document.getElementById('canh').value = data.menu.canh || '';
                document.getElementById('alternativeItems').value = data.menu.alternatives || '';
            }
            document.getElementById('dailyQuantity').value = data.quantity;
        })
        .catch(err => console.error('Lỗi:', err));
}

function parseMenu(menuString) {
    // Try to parse menu string - format: Món chính: xxx | Món phụ: xxx | Rau: xxx | Canh: xxx
    const result = { monChinh: '', monPhu: '', rau: '', canh: '', alternatives: '' };
    
    if (!menuString) return result;
    
    // This is a simple parser - you may need to adjust based on your format
    const parts = menuString.split('|').map(p => p.trim());
    parts.forEach(part => {
        if (part.includes('Món chính')) {
            result.monChinh = part.replace(/.*Món chính\s*:?\s*/, '').trim();
        } else if (part.includes('Món phụ')) {
            result.monPhu = part.replace(/.*Món phụ\s*:?\s*/, '').trim();
        } else if (part.includes('Rau')) {
            result.rau = part.replace(/.*Rau\s*:?\s*/, '').trim();
        } else if (part.includes('Canh')) {
            result.canh = part.replace(/.*Canh\s*:?\s*/, '').trim();
        }
    });
    
    return result;
}

function updateMenu() {
    const monChinh = document.getElementById('monChinh').value.trim();
    const monPhu = document.getElementById('monPhu').value.trim();
    const rau = document.getElementById('rau').value.trim();
    const canh = document.getElementById('canh').value.trim();
    const alternatives = document.getElementById('alternativeItems').value.trim();

    if (!monChinh || !monPhu || !rau || !canh) {
        showMessage('todayMessage', 'Vui lòng điền đầy đủ thông tin menu', 'error');
        return;
    }

    // Create menu object
    const menuData = {
        monChinh,
        monPhu,
        rau,
        canh,
        alternatives
    };

    // Format menu string for display
    const menuString = `Món chính: ${monChinh} | Món phụ: ${monPhu} | Rau: ${rau} | Canh: ${canh}${alternatives ? ' | Thay thế: ' + alternatives : ''}`;

    fetch(`${API_BASE}/api/admin/menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu: menuData, menuString })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showMessage('todayMessage', data.error, 'error');
        } else {
            showMessage('todayMessage', 'Cập nhật menu thành công! ✅', 'success');
        }
    })
    .catch(err => showMessage('todayMessage', 'Lỗi: ' + err.message, 'error'));
}

function updateQuantity() {
    const quantity = parseInt(document.getElementById('dailyQuantity').value);
    if (!quantity || quantity < 1) {
        showMessage('todayMessage', 'Vui lòng nhập số lượng hợp lệ', 'error');
        return;
    }

    fetch(`${API_BASE}/api/admin/quantity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showMessage('todayMessage', data.error, 'error');
        } else {
            showMessage('todayMessage', 'Cập nhật số lượng thành công! ✅', 'success');
        }
    })
    .catch(err => showMessage('todayMessage', 'Lỗi: ' + err.message, 'error'));
}

let selectedOrderDate = '';

function loadHistory() {
    fetch(`${API_BASE}/api/admin/all-days`)
        .then(res => res.json())
        .then(days => {
            const activeDays = (days || []).filter(day => Number(day.ordered || 0) > 0);
            const today = new Date().toISOString().slice(0, 10);
            const defaultDate = activeDays.find(d => d.date === today)?.date || activeDays[0]?.date || today;

            if (!selectedOrderDate) {
                selectedOrderDate = defaultDate;
            }

            document.getElementById('dateFilter').value = selectedOrderDate;
            updateOrderSummary(activeDays, selectedOrderDate);
            loadOrderListByDate(selectedOrderDate);
        })
        .catch(err => {
            document.getElementById('historyList').innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Lỗi tải dữ liệu: ${err.message}</div>`;
        });
}

function updateOrderSummary(days, selectedDate) {
    const selected = (days || []).find(d => d.date === selectedDate);
    const summary = document.getElementById('orderSummaryInfo');
    summary.innerHTML = `Tổng số xuất ngày <strong>${selectedDate}</strong>: <strong>${selected?.ordered || 0}</strong>`;
}

function selectOrderDate(date) {
    selectedOrderDate = date;
    document.getElementById('dateFilter').value = date;
    loadHistory();
}

function onPickOrderDate() {
    const picked = document.getElementById('dateFilter').value;
    if (!picked) return;
    selectedOrderDate = picked;
    loadHistory();
}

function loadHistoryByDate() {
    onPickOrderDate();
}

function loadOrderListByDate(date) {
    currentHistoryDetailDate = date;
    const list = document.getElementById('historyList');
    list.innerHTML = '<div class="loading">Đang tải...</div>';

    fetch(`${API_BASE}/api/admin/day/${date}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            historyOrders = (data.orders || []);
            historyCurrentPage = 1;
            renderHistoryOrders();
        })
        .catch(err => {
            list.innerHTML = `<div style="padding:20px; color:red; text-align:center;">Lỗi: ${err.message}</div>`;
        });
}

function renderHistoryOrders() {
    const list = document.getElementById('historyList');
    if (!historyOrders.length) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Không có đơn hàng trong ngày này.</div>';
        return;
    }

    const totalPages = Math.ceil(historyOrders.length / PAGE_SIZE);
    if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
    const startIndex = (historyCurrentPage - 1) * PAGE_SIZE;
    const pageRows = historyOrders.slice(startIndex, startIndex + PAGE_SIZE);

    const rowsHtml = pageRows.map((order) => {
        const disc = Number(order.discount_percent || 0);
        const discBadge = disc > 0 ? `<span class="discount-badge">-${disc}%</span>` : '';
        const promoInfo = disc > 0 ? `<div class="admin-payment-meta promo-info-text">Mã KM: ${order.promo_code} — Giảm ${disc}%</div>` : '';
        return `
        <div class="order-row ${disc > 0 ? 'order-row-discounted' : ''}">
            <div class="order-info">
                <div class="order-name">${order.name} ${discBadge}</div>
                <div class="order-details">Số lượng: ${order.quantity} xuất ${order.description ? '</br> Ghi chú: ' + order.description : ''}</div>
                ${promoInfo}
                <div class="admin-payment-meta">Thời gian đặt: ${AppUtils.formatDateTime(order.created_at)}</div>
            </div>
            <div class="admin-payment-actions">
                <button class="edit-icon-btn" title="Chỉnh sửa đơn" onclick="openOrderEditModal(${order.id}, '${encodeURIComponent(order.name)}', ${order.quantity}, '${encodeURIComponent(order.description || '')}', '${currentHistoryDetailDate}')">✏️</button>
            </div>
        </div>
        `;
    }).join('');

    list.innerHTML = rowsHtml + renderPaginationControls('historyCurrentPage', historyCurrentPage, totalPages, 'renderHistoryOrders');
}
function openOrderEditModal(orderId, encodedName, quantity, encodedDescription, date) {
    editingOrderId = Number(orderId || 0);
    currentHistoryDetailDate = date || currentHistoryDetailDate;
    document.getElementById('editOrderName').value = decodeURIComponent(encodedName || '');
    document.getElementById('editOrderQuantity').value = Number(quantity || 1);
    document.getElementById('editOrderDescription').value = decodeURIComponent(encodedDescription || '');
    document.getElementById('orderEditModal').style.display = 'flex';
}

function closeOrderEditModal() {
    document.getElementById('orderEditModal').style.display = 'none';
    editingOrderId = 0;
}

function saveOrderEdit() {
    if (!editingOrderId) return;
    const name = AppUtils.normalizeName(document.getElementById('editOrderName').value);
    const quantity = Number(document.getElementById('editOrderQuantity').value || 0);
    const description = document.getElementById('editOrderDescription').value || '';

    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
        showPopup('Vui lòng nhập tên và số lượng hợp lệ.');
        return;
    }

    fetch(`${API_BASE}/api/admin/orders/${editingOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, quantity, description })
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            closeOrderEditModal();
            loadHistory();
        })
        .catch(err => showPopup('Lỗi sửa đơn: ' + err.message));
}

function deleteOrderFromModal() {
    if (!editingOrderId) return;
    deleteOrder(editingOrderId, currentHistoryDetailDate, true);
    closeOrderEditModal();
}

function showDayDetail(date) {
    // Backward compatibility: chuyển về màn quản lý danh sách đặt cơm theo ngày
    selectedOrderDate = date;
    switchTab('history');
    loadHistory();
}

function togglePaymentDateInputs() {
    const period = document.getElementById('paymentPeriodFilter').value;
    const dateInput = document.getElementById('paymentDateFilter');
    const monthInput = document.getElementById('paymentMonthFilter');
    const fromDateInput = document.getElementById('paymentFromDateFilter');
    const toDateInput = document.getElementById('paymentToDateFilter');

    const showDate = period === 'date';
    const showMonth = period === 'month';
    const showRange = period === 'range';
    const showAny = showDate || showMonth || showRange;

    dateInput.style.display = showDate ? 'block' : 'none';
    monthInput.style.display = showMonth ? 'block' : 'none';
    fromDateInput.style.display = showRange ? 'block' : 'none';
    toDateInput.style.display = showRange ? 'block' : 'none';

    // Show/hide the conditional row and range field containers
    var dateRow = document.getElementById('paymentDateRow');
    var rangeFields = document.getElementById('paymentRangeFields');
    var rangeFieldsTo = document.getElementById('paymentRangeFieldsTo');
    if (dateRow) dateRow.style.display = showAny ? 'flex' : 'none';
    if (rangeFields) rangeFields.style.display = showRange ? 'block' : 'none';
    if (rangeFieldsTo) rangeFieldsTo.style.display = showRange ? 'block' : 'none';
}

function resetPaymentFilters() {
    document.getElementById('adminPaymentSearch').value = '';
    document.getElementById('paymentPeriodFilter').value = 'all';
    document.getElementById('paymentDateFilter').value = '';
    document.getElementById('paymentMonthFilter').value = '';
    document.getElementById('paymentStatusFilter').value = 'all';
    document.getElementById('paymentFromDateFilter').value = '';
    document.getElementById('paymentToDateFilter').value = '';
    togglePaymentDateInputs();
    loadAdminPayments();
}

function switchPaymentView(view) {
    currentPaymentView = view === 'history' ? 'history' : 'debt';
    const debtSection = document.getElementById('paymentDebtSection');
    const historySection = document.getElementById('paymentHistorySection');
    const historyList = document.getElementById('adminPaymentList');
    const debtBtn = document.getElementById('paymentDebtViewBtn');
    const historyBtn = document.getElementById('paymentHistoryViewBtn');

    if (currentPaymentView === 'debt') {
        debtSection.style.display = 'block';
        historySection.style.display = 'none';
        historyList.style.display = 'none';
        debtBtn.classList.add('active');
        historyBtn.classList.remove('active');
        loadDebtSummary();
    } else {
        debtSection.style.display = 'none';
        historySection.style.display = 'block';
        historyList.style.display = 'block';
        debtBtn.classList.remove('active');
        historyBtn.classList.add('active');

        // Mặc định filter theo tháng hiện tại nếu chưa chọn gì
        const periodFilter = document.getElementById('paymentPeriodFilter');
        if (periodFilter.value === 'all') {
            const now = new Date();
            const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            periodFilter.value = 'month';
            document.getElementById('paymentMonthFilter').value = currentMonth;
            togglePaymentDateInputs();
        }

        loadAdminPayments();
    }
}

let debtSearchTimer = null;
function onDebtSearchInput() {
    clearTimeout(debtSearchTimer);
    debtSearchTimer = setTimeout(() => loadDebtSummary(), 400);
}

function loadDebtSummary() {
    const container = document.getElementById('adminDebtSummaryList');
    container.innerHTML = '<div class="loading">Đang tải...</div>';
    const search = (document.getElementById('debtSearchInput')?.value || '').trim();
    const url = search ? `${API_BASE}/api/payments/today?search=${encodeURIComponent(search)}` : `${API_BASE}/api/payments/today`;

    fetch(url)
        .then(res => res.json())
        .then(rows => {
            debtRows = rows || [];
            debtCurrentPage = 1;
            renderDebtSummary();
        })
        .catch(err => {
            container.innerHTML = `<div style="padding: 14px; color:red; text-align:center;">Lỗi tải công nợ: ${err.message}</div>`;
        });
}

function renderDebtSummary() {
    const container = document.getElementById('adminDebtSummaryList');
    if (!debtRows.length) {
        container.innerHTML = '<div style="padding: 14px; color:#999; text-align:center;">Không có công nợ cần xử lý.</div>';
        return;
    }

    const totalPages = Math.ceil(debtRows.length / PAGE_SIZE);
    if (debtCurrentPage > totalPages) debtCurrentPage = totalPages;
    const startIndex = (debtCurrentPage - 1) * PAGE_SIZE;
    const pageRows = debtRows.slice(startIndex, startIndex + PAGE_SIZE);

    const rowsHtml = pageRows.map((row) => {
        return `
            <div class="admin-payment-row">
                <div>
                    <div class="order-name payment-name-link" onclick="openCustomerOrderModal('${encodeURIComponent(row.name || '')}')">${row.name}</div>
                    <div class="admin-payment-meta">Số xuất: ${row.quantity} </br> Tổng tiền: ${AppUtils.formatCurrency(row.totalAmount || 0)}</div>
                </div>
                <div class="admin-payment-actions">
                    <button class="btn-warning btn-small" onclick="markCashPaid('${encodeURIComponent(row.name)}', ${row.remainingAmount})">Thanh toán</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = rowsHtml + renderPaginationControls('debtCurrentPage', debtCurrentPage, totalPages, 'renderDebtSummary');
}

function loadAdminPayments() {
    const keyword = document.getElementById('adminPaymentSearch').value.trim();
    const period = document.getElementById('paymentPeriodFilter').value;
    const date = document.getElementById('paymentDateFilter').value;
    const month = document.getElementById('paymentMonthFilter').value;
    const status = document.getElementById('paymentStatusFilter').value;
    const fromDate = document.getElementById('paymentFromDateFilter').value;
    const toDate = document.getElementById('paymentToDateFilter').value;
    const container = document.getElementById('adminPaymentList');
    container.style.display = 'block';

    if (period === 'date' && !date) {
        showPopup('Vui lòng chọn ngày cần lọc');
        return;
    }

    if (period === 'month' && !month) {
        showPopup('Vui lòng chọn tháng cần lọc');
        return;
    }

    if (period === 'range' && (!fromDate || !toDate)) {
        showPopup('Vui lòng chọn đủ Từ ngày và Tới ngày');
        return;
    }

    if (period === 'range' && fromDate > toDate) {
        showPopup('Khoảng ngày không hợp lệ (Từ ngày phải nhỏ hơn hoặc bằng Tới ngày)');
        return;
    }

    const params = new URLSearchParams();
    if (keyword) params.set('search', keyword);
    if (period) params.set('period', period);
    if (date) params.set('date', date);
    if (month) params.set('month', month);
    if (status) params.set('status', status);
    if (period === 'range' && fromDate) params.set('fromDate', fromDate);
    if (period === 'range' && toDate) params.set('toDate', toDate);

    container.innerHTML = '<div class="loading">Đang tải...</div>';
    const url = `${API_BASE}/api/payments/history?${params.toString()}`;

    fetch(url)
        .then(res => res.json())
        .then(rows => {
            paymentRows = rows || [];
            paymentCurrentPage = 1;
            renderPaymentHistory();
        })
        .catch(err => {
            container.innerHTML = `<div style="padding: 16px; color: red; text-align: center;">Lỗi tải dữ liệu: ${err.message}</div>`;
        });
}

function renderPaymentHistory() {
    const container = document.getElementById('adminPaymentList');
    if (!paymentRows.length) {
        container.innerHTML = '<div style="padding: 16px; color: #999; text-align: center;">Không có giao dịch theo bộ lọc hiện tại.</div>';
        return;
    }

    const totalPages = Math.ceil(paymentRows.length / PAGE_SIZE);
    if (paymentCurrentPage > totalPages) paymentCurrentPage = totalPages;
    const startIndex = (paymentCurrentPage - 1) * PAGE_SIZE;
    const pageRows = paymentRows.slice(startIndex, startIndex + PAGE_SIZE);

    const statusBadgeMap = {
        PAID:      { cls: 'psb-paid',      label: '✓ Đã thanh toán' },
        PENDING:   { cls: 'psb-pending',   label: '⏳ Đang chờ' },
        CANCELLED: { cls: 'psb-cancelled', label: '✗ Đã huỷ' },
        EXPIRED:   { cls: 'psb-expired',   label: '⌛ Hết hạn' }
    };
    const rowsHtml = pageRows.map((row) => {
        const statusText = String(row.request_status || 'PENDING').toUpperCase();
        const { cls, label } = statusBadgeMap[statusText] || { cls: 'psb-pending', label: statusText };
        const paidAmount = Number(row.paid_amount || 0);
        const amount = Number(row.request_amount || 0);
        const paidAt = row.latest_paid_at || row.request_updated_at || row.request_created_at;
        const canManualPaid = statusText === 'PENDING';
        return `
            <div class="admin-payment-row">
                <div>
                    <div class="order-name" style="display:flex;align-items:center;gap:8px;">${row.customer_name} <span class="payment-status-badge ${cls}">${label}</span></div>
                    <div class="admin-payment-meta">Ngày: ${row.date} | OrderCode: ${row.order_code}</div>
                    <div class="admin-payment-meta">Số tiền: ${AppUtils.formatCurrency(amount)} | Đã thanh toán: ${AppUtils.formatCurrency(paidAmount)} | Ref: ${row.latest_reference || row.payment_link_id || '-'}</div>
                    <div class="admin-payment-meta">Cập nhật: ${AppUtils.formatDateTime(paidAt)}</div>
                </div>
                <div class="admin-payment-actions">
                    ${canManualPaid ? `<button class="btn-warning btn-small" onclick="markPaidManual(${row.order_code}, '${encodeURIComponent(row.customer_name || '')}')">Chuyển Paid</button>` : ''}
                    <button class="btn-danger btn-small" onclick="deletePaymentRecord(${row.order_code}, '${encodeURIComponent(row.customer_name || '')}')">Xóa</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = rowsHtml + renderPaginationControls('paymentCurrentPage', paymentCurrentPage, totalPages, 'renderPaymentHistory');
}

function renderPaginationControls(pageVarName, currentPage, totalPages, renderFnName) {
    if (totalPages <= 1) return '';
    return `
        <div class="pagination-wrap">
            <button class="btn-secondary btn-small" ${currentPage <= 1 ? 'disabled' : ''} onclick="${pageVarName}=${currentPage - 1};${renderFnName}()">Trước</button>
            <span>Trang ${currentPage}/${totalPages}</span>
            <button class="btn-secondary btn-small" ${currentPage >= totalPages ? 'disabled' : ''} onclick="${pageVarName}=${currentPage + 1};${renderFnName}()">Sau</button>
        </div>
    `;
}

function openCustomerOrderModal(encodedName) {
    const customerName = decodeURIComponent(encodedName || '');
    if (!customerName) return;

    document.getElementById('customerOrderModalTitle').textContent = `CÔNG NỢ CHƯA THANH TOÁN - ${customerName}`;
    const content = document.getElementById('customerOrderModalContent');
    content.innerHTML = '<div class="loading">Đang tải...</div>';
    document.getElementById('customerOrderModal').style.display = 'flex';

    fetch(`${API_BASE}/api/admin/customers/${encodeURIComponent(customerName)}/orders`)
        .then(res => res.json())
        .then(data => {
            const rows = data.rows || [];
            if (!rows.length) {
                content.innerHTML = '<div style="padding: 12px; color:#999;">Không có công nợ chưa thanh toán.</div>';
                return;
            }

            content.innerHTML = rows.map((row) => {
                let promoHtml = '';
                if (row.promos && row.promos.length > 0) {
                    promoHtml = row.promos.map(p =>
                        `<div class="promo-detail-note">🎫 Mã <strong>${p.promo_code}</strong>: giảm ${p.discount_percent}% · ${p.quantity} xuất × ${AppUtils.formatCurrency(p.finalPrice)}/xuất</div>`
                    ).join('');
                }
                return `
                <div class="day-modal-order-item">
                    <div><strong>Ngày:</strong> ${row.date}</div>
                    <div><strong>Số xuất:</strong> ${row.quantity}</div>
                    <div><strong>Còn nợ:</strong> ${AppUtils.formatCurrency(row.remainingAmount || 0)}</div>
                    ${row.paidAmount > 0 ? `<div><strong>Đã trả:</strong> ${AppUtils.formatCurrency(row.paidAmount)}</div>` : ''}
                    ${promoHtml}
                </div>
            `}).join('');
        })
        .catch(err => {
            content.innerHTML = `<div style="padding: 12px; color:red;">Lỗi tải chi tiết: ${err.message}</div>`;
        });
}

function closeCustomerOrderModal() {
    document.getElementById('customerOrderModal').style.display = 'none';
}

async function markPaidManual(orderCode, encodedName) {
    const name = decodeURIComponent(encodedName || '');
    if (!orderCode) {
        showPopup(`Không tìm thấy mã đơn cần chuyển trạng thái cho ${name}.`);
        return;
    }

    const confirmed = await showPopup(`Xác nhận chuyển trạng thái đã thanh toán cho ${name} (orderCode: ${orderCode})?`, { type: 'confirm', confirmLabel: 'Xác nhận' });
    if (!confirmed) return;

    fetch(`${API_BASE}/api/admin/payments/manual-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderCode })
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            showPopup('Đã chuyển trạng thái thanh toán thành công.');
            loadDebtSummary();
            loadAdminPayments();
        })
        .catch(err => showPopup('Lỗi chuyển trạng thái: ' + err.message));
}

function deletePaymentRecord(orderCode, encodedName) {
    const name = decodeURIComponent(encodedName || '');
    if (!orderCode) {
        showPopup('Không tìm thấy mã đơn cần xóa.');
        return;
    }

    openConfirmModal({
        title: 'XÁC NHẬN XÓA',
        message: `Xóa lịch sử thanh toán của ${name} (orderCode: ${orderCode})? Thao tác này không thể hoàn tác.`,
        onConfirm: () => {
            return fetch(`${API_BASE}/api/admin/payments/${orderCode}`, {
                method: 'DELETE'
            })
                .then(res => res.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    closeConfirmModal();
                    loadDebtSummary();
                    loadAdminPayments();
                })
                .catch(err => showPopup('Lỗi xóa: ' + err.message));
        }
    });
}

const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalYesBtn = document.getElementById('confirmModalYesBtn');

function closeConfirmModal() {
    confirmModal.style.display = 'none';
    confirmModalYesBtn.onclick = null;
}

function openConfirmModal({ title, message, onConfirm }) {
    confirmModalTitle.textContent = title || 'XÁC NHẬN';
    confirmModalMessage.textContent = message || '';
    confirmModalYesBtn.onclick = () => {
        confirmModalYesBtn.disabled = true;
        Promise.resolve()
            .then(() => onConfirm && onConfirm())
            .finally(() => {
                confirmModalYesBtn.disabled = false;
            });
    };
    confirmModal.style.display = 'flex';
}

let cashPaymentTargetName = '';

function markCashPaid(encodedName, remainingAmount) {
    const name = decodeURIComponent(encodedName || '');
    if (!name) {
        showPopup('Không xác định được người dùng cần cập nhật.');
        return;
    }
    cashPaymentTargetName = name;
    document.getElementById('cashPaymentInfo').textContent =
        `Khách: ${name} | Còn nợ: ${AppUtils.formatCurrency(remainingAmount || 0)}`;
    const amtInput = document.getElementById('cashPaymentAmount');
    amtInput.value = remainingAmount || '';
    amtInput.max = remainingAmount || '';
    document.getElementById('cashPaymentModal').style.display = 'flex';
    amtInput.focus();
    amtInput.select();
}

function closeCashPaymentModal() {
    document.getElementById('cashPaymentModal').style.display = 'none';
    cashPaymentTargetName = '';
}

function confirmCashPayment() {
    const name = cashPaymentTargetName;
    if (!name) return;
    const amount = Number(document.getElementById('cashPaymentAmount').value || 0);
    if (!amount || amount <= 0) {
        showPopup('Vui lòng nhập số tiền hợp lệ.');
        return;
    }
    const btn = document.getElementById('cashPaymentConfirmBtn');
    btn.disabled = true;
    fetch(`${API_BASE}/api/admin/payments/manual-cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, amount })
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            closeCashPaymentModal();
            loadDebtSummary();
        })
        .catch(err => showPopup('Lỗi cập nhật tiền mặt: ' + err.message))
        .finally(() => { btn.disabled = false; });
}


function closeDayModal() {
    document.getElementById('dayModal').style.display = 'none';
}

function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('vi-VN', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

function getMenuDisplay(menu) {
    if (!menu) return 'Chưa có menu';
    
    if (typeof menu === 'object') {
        return `Món chính: ${menu.monChinh || ''} | Món phụ: ${menu.monPhu || ''} | Rau: ${menu.rau || ''} | Canh: ${menu.canh || ''}`;
    }
    
    return menu;
}

function showMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    const className = type === 'error' ? 'error-message' : 'success-message';
    element.innerHTML = `<div class="${className}">${message}</div>`;
}

async function deleteOrder(orderId, date, skipConfirm = false) {
    if (!skipConfirm) {
        const confirmed = await showPopup('Bạn có chắc chắn muốn xóa đơn hàng này?', { type: 'confirm', confirmLabel: 'Xóa', danger: true });
        if (!confirmed) return;
    }

    fetch(`${API_BASE}/api/admin/orders/${orderId}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showPopup('Lỗi: ' + data.error);
            } else {
                if (date) {
                    selectedOrderDate = date;
                }
                loadHistory();
            }
        })
        .catch(err => showPopup('Lỗi: ' + err.message));
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('dayModal');
    const editModal = document.getElementById('orderEditModal');
    const customerModal = document.getElementById('customerOrderModal');
    const customerFullHistoryModalEl = document.getElementById('customerFullHistoryModal');
    const confirmModalEl = document.getElementById('confirmModal');
    if (e.target === modal) {
        modal.style.display = 'none';
    }
    if (e.target === editModal) {
        editModal.style.display = 'none';
    }
    if (e.target === customerModal) {
        customerModal.style.display = 'none';
    }
    if (e.target === customerFullHistoryModalEl) {
        closeCustomerFullHistoryModal();
    }
    if (e.target === confirmModalEl) {
        closeConfirmModal();
    }
    const cashPaymentModalEl = document.getElementById('cashPaymentModal');
    if (e.target === cashPaymentModalEl) {
        closeCashPaymentModal();
    }
    // Đóng dropdown gợi ý khi click ra ngoài
    const searchDropdown = document.getElementById('historyNameSuggestions');
    if (searchDropdown && !document.getElementById('historyNameSearch')?.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
    }
});

// =============================================
// Promo Code Management
// =============================================
function loadPromoCodes() {
    const container = document.getElementById('promoCodeList');
    container.innerHTML = '<div class="loading">Đang tải...</div>';

    fetch(`${API_BASE}/api/admin/promo-codes`)
        .then(res => res.json())
        .then(codes => {
            if (!codes || !codes.length) {
                container.innerHTML = '<div style="padding:14px; color:#999; text-align:center;">Chưa có mã khuyến mãi nào.</div>';
                return;
            }

            container.innerHTML = codes.map(c => {
                const isUsed = !!c.used_by;
                const statusCls = isUsed ? 'psb-paid' : 'psb-pending';
                const statusLabel = isUsed ? `Đã dùng bởi ${c.used_by}` : 'Chưa sử dụng';
                return `
                    <div class="admin-payment-row ${isUsed ? 'promo-used' : ''}">
                        <div>
                            <div class="order-name" style="font-family:monospace; letter-spacing:1px;">${c.code}</div>
                            <div class="admin-payment-meta">Giảm <strong>${c.discount_percent}%</strong> · Tạo: ${AppUtils.formatDateTime(c.created_at)}</div>
                            <span class="payment-status-badge ${statusCls}">${statusLabel}</span>
                            ${isUsed ? `<div class="admin-payment-meta">Dùng lúc: ${AppUtils.formatDateTime(c.used_at)}</div>` : ''}
                        </div>
                        <div class="admin-payment-actions">
                            ${!isUsed ? `<button class="btn-danger btn-small" onclick="deletePromoCode(${c.id})">Xóa</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        })
        .catch(err => {
            container.innerHTML = `<div style="padding:14px; color:red; text-align:center;">Lỗi: ${err.message}</div>`;
        });
}

function createPromoCode() {
    const code = document.getElementById('newPromoCode').value.trim().toUpperCase();
    const discount = Number(document.getElementById('newPromoDiscount').value || 0);
    const msgEl = document.getElementById('promoAdminMessage');

    if (!code || discount <= 0 || discount > 100) {
        msgEl.innerHTML = '<div class="error-message">Vui lòng nhập mã và phần trăm giảm giá hợp lệ (1-100%)</div>';
        return;
    }

    fetch(`${API_BASE}/api/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, discountPercent: discount })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        msgEl.innerHTML = '<div class="success-message">Tạo mã khuyến mãi thành công!</div>';
        document.getElementById('newPromoCode').value = '';
        document.getElementById('newPromoDiscount').value = '';
        loadPromoCodes();
    })
    .catch(err => {
        msgEl.innerHTML = `<div class="error-message">${err.message}</div>`;
    });
}

async function deletePromoCode(id) {
    const confirmed = await showPopup('Xóa mã khuyến mãi này?', { type: 'confirm', confirmLabel: 'Xóa', danger: true });
    if (!confirmed) return;
    fetch(`${API_BASE}/api/admin/promo-codes/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            loadPromoCodes();
        })
        .catch(err => showPopup('Lỗi xóa: ' + err.message));
}

// =============================================
// User Management
// =============================================
function loadUsers() {
    const container = document.getElementById('userList');
    container.innerHTML = '<div class="loading">Đang tải...</div>';

    fetch(`${API_BASE}/api/admin/users`)
        .then(res => res.json())
        .then(users => {
            if (!users || !users.length) {
                container.innerHTML = '<div style="padding:14px; color:#999; text-align:center;">Chưa có người dùng nào.</div>';
                return;
            }

            container.innerHTML = users.map(u => {
                const roleBadge = u.role === 'admin'
                    ? '<span class="payment-status-badge psb-paid">Admin</span>'
                    : '<span class="payment-status-badge psb-pending">User</span>';
                return `
                    <div class="admin-payment-row">
                        <div>
                            <div class="order-name">${u.name} ${roleBadge}</div>
                            <div class="admin-payment-meta">SĐT: ${u.phone} · Tạo: ${AppUtils.formatDateTime(u.created_at)}</div>
                        </div>
                        <div class="admin-payment-actions">
                            <button class="btn-warning btn-small" onclick="resetUserPassword(${u.id}, '${encodeURIComponent(u.name)}')">Đổi MK</button>
                            <button class="btn-danger btn-small" onclick="deleteUser(${u.id}, '${encodeURIComponent(u.name)}')">Xóa</button>
                        </div>
                    </div>
                `;
            }).join('');
        })
        .catch(err => {
            container.innerHTML = `<div style="padding:14px; color:red; text-align:center;">Lỗi: ${err.message}</div>`;
        });
}

function createUser() {
    const phone = document.getElementById('newUserPhone').value.trim();
    const name = document.getElementById('newUserName').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    const msgEl = document.getElementById('userAdminMessage');

    if (!phone || !name || !password) {
        msgEl.innerHTML = '<div class="error-message">Vui lòng nhập đầy đủ thông tin</div>';
        return;
    }

    fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name, password, role })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        msgEl.innerHTML = '<div class="success-message">Tạo tài khoản thành công!</div>';
        document.getElementById('newUserPhone').value = '';
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPassword').value = '';
        loadUsers();
    })
    .catch(err => {
        msgEl.innerHTML = `<div class="error-message">${err.message}</div>`;
    });
}

async function deleteUser(id, encodedName) {
    const name = decodeURIComponent(encodedName || '');
    const confirmed = await showPopup(`Xóa tài khoản "${name}"?`, { type: 'confirm', confirmLabel: 'Xóa', danger: true });
    if (!confirmed) return;
    fetch(`${API_BASE}/api/admin/users/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            loadUsers();
        })
        .catch(err => showPopup('Lỗi xóa: ' + err.message));
}

async function resetUserPassword(id, encodedName) {
    const name = decodeURIComponent(encodedName || '');
    const newPass = await showPopup(`Nhập mật khẩu mới cho "${name}" (tối thiểu 6 ký tự):`, { type: 'prompt', defaultValue: '' });
    if (!newPass || newPass.length < 6) {
        if (newPass !== null) showPopup('Mật khẩu phải có ít nhất 6 ký tự');
        return;
    }
    fetch(`${API_BASE}/api/admin/users/${id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPass })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        showPopup('Đổi mật khẩu thành công!');
    })
    .catch(err => showPopup('Lỗi: ' + err.message));
}

// =============================================
// Settings Management
// =============================================
function loadSettings() {
    fetch(`${API_BASE}/api/admin/settings`)
        .then(res => res.json())
        .then(settings => {
            document.getElementById('settingDebtLimitEnabled').checked = settings.debt_limit_enabled === '1';
            document.getElementById('settingDebtLimitServings').value = settings.debt_limit_servings || '2';
            document.getElementById('settingDebtLimitMessage').value = settings.debt_limit_message || '';
            document.getElementById('settingConsecutivePromoEnabled').checked = settings.consecutive_promo_enabled === '1';
            document.getElementById('settingConsecutivePromoDays').value = settings.consecutive_promo_days || '5';
            document.getElementById('settingConsecutivePromoDiscount').value = settings.consecutive_promo_discount || '50';
            toggleSettingsFields();
        })
        .catch(err => {
            document.getElementById('settingsMessage').innerHTML = `<div class="error-message">Lỗi tải cài đặt: ${err.message}</div>`;
        });
}

function toggleSettingsFields() {
    const debtEnabled = document.getElementById('settingDebtLimitEnabled').checked;
    document.getElementById('debtLimitFields').style.display = debtEnabled ? 'block' : 'none';
    const promoEnabled = document.getElementById('settingConsecutivePromoEnabled').checked;
    document.getElementById('consecutivePromoFields').style.display = promoEnabled ? 'block' : 'none';
}

document.getElementById('settingDebtLimitEnabled').addEventListener('change', toggleSettingsFields);
document.getElementById('settingConsecutivePromoEnabled').addEventListener('change', toggleSettingsFields);

function saveSettings() {
    const settings = {
        debt_limit_enabled: document.getElementById('settingDebtLimitEnabled').checked ? '1' : '0',
        debt_limit_servings: document.getElementById('settingDebtLimitServings').value || '2',
        debt_limit_message: document.getElementById('settingDebtLimitMessage').value || '',
        consecutive_promo_enabled: document.getElementById('settingConsecutivePromoEnabled').checked ? '1' : '0',
        consecutive_promo_days: document.getElementById('settingConsecutivePromoDays').value || '5',
        consecutive_promo_discount: document.getElementById('settingConsecutivePromoDiscount').value || '50'
    };

    fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        document.getElementById('settingsMessage').innerHTML = '<div class="success-message">Lưu cài đặt thành công! ✅</div>';
        setTimeout(() => { document.getElementById('settingsMessage').innerHTML = ''; }, 3000);
    })
    .catch(err => {
        document.getElementById('settingsMessage').innerHTML = `<div class="error-message">Lỗi: ${err.message}</div>`;
    });
}

// Load today info on page load
loadTodayInfo();
loadHistory();
loadAllCustomerNames();
togglePaymentDateInputs();
switchPaymentView('debt');