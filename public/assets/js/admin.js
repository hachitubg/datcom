const SITE_BASE_PATH = (() => {
    const firstSegment = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const rootPaths = new Set(['admin', 'admin2', 'admin-login', 'admin.html', 'api', 'assets', 'images', 'game.html']);
    return firstSegment && !rootPaths.has(firstSegment) ? `/${firstSegment}` : '';
})();
const API_BASE = SITE_BASE_PATH;
document.addEventListener('DOMContentLoaded', () => {
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) backBtn.setAttribute('href', SITE_BASE_PATH || '/');
    if (SITE_BASE_PATH) {
        const roleSelect = document.getElementById('newUserRole');
        roleSelect?.querySelector('option[value="admin"]')?.remove();
        if (roleSelect) roleSelect.value = 'user';
    }
});
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
let feedbackRows = [];
let feedbackCurrentPage = 1;
let kitchenOrderFilter = 'pending';
const escapeHtml = AppUtils.escapeHtml;
const escapeAttr = AppUtils.escapeAttribute;

function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

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

    const normalized = AppUtils.getSearchKey(query);
    const matches = allCustomerNames.filter(n =>
        n.toLowerCase().includes(query) ||
        AppUtils.getSearchKey(n).includes(normalized)
    );
    if (!matches.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = matches.slice(0, 12).map(name =>
        `<div class="name-suggestion-item" onmousedown="selectHistoryName('${encodeURIComponent(name)}')">${escapeHtml(name)}</div>`
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
                        <div class="stat-lbl">Tổng suất</div>
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
                    promoHtml = row.promos.map(p => {
                        const fullPriceText = Number(p.full_price_quantity || 0) > 0
                            ? ` · ${p.full_price_quantity} suất còn lại tính giá gốc`
                            : '';
                        return `<div class="promo-detail-note">🎫 Mã <strong>${escapeHtml(p.promo_code)}</strong>: giảm ${p.discount_percent}% cho ${p.discount_quantity || 1} suất × ${AppUtils.formatCurrency(p.finalPrice)}/suất${fullPriceText}</div>`;
                    }).join('');
                }
                return `
                    <div class="customer-history-order-row ${rowClass}">
                        <div>
                            <div style="font-weight:600; color:#A0826D; margin-bottom:3px;">${row.date}</div>
                            <div class="admin-payment-meta">${row.quantity} suất × ${AppUtils.formatCurrency(row.unitPrice)}</div>
                            ${row.paidAmount > 0 ? `<div class="admin-payment-meta" style="color:#2d7a2d;">Đã trả: ${AppUtils.formatCurrency(row.paidAmount)}</div>` : ''}
                            ${row.remainingAmount > 0 ? `<div class="admin-payment-meta" style="color:#c46060;">Còn nợ: ${AppUtils.formatCurrency(row.remainingAmount)}</div>` : ''}
                            ${promoHtml}
                        </div>
                        <div style="text-align:right; flex-shrink:0;">
                            <span class="payment-status-badge ${cls}">${escapeHtml(label)}</span>
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
        kitchenOrderFilter = 'pending';
        historyCurrentPage = 1;
        updateKitchenFilterButtons();
        loadHistory();
    } else if (tab === 'payments') {
        switchPaymentView(currentPaymentView);
    } else if (tab === 'promos') {
        loadPromoCodes();
        loadPromoUserOptions();
    } else if (tab === 'streaks') {
        loadConsecutiveStreaks();
    } else if (tab === 'users') {
        loadUsers();
    } else if (tab === 'settings') {
        loadSettings();
    } else if (tab === 'feedback') {
        loadFeedbackList();
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
            const cutoffInput = document.getElementById('dailyCutoffTime');
            if (cutoffInput) {
                cutoffInput.value = data.orderCutoffTime || (data.orderCutoff && data.orderCutoff.cutoffTime) || '10:45';
            }
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
    const cutoffTime = (document.getElementById('dailyCutoffTime')?.value || '10:45').trim();
    if (!quantity || quantity < 1) {
        showMessage('todayMessage', 'Vui lòng nhập số lượng hợp lệ', 'error');
        return;
    }
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(cutoffTime)) {
        showMessage('todayMessage', 'Giờ chốt không hợp lệ', 'error');
        return;
    }

    fetch(`${API_BASE}/api/admin/quantity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, cutoffTime })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showMessage('todayMessage', data.error, 'error');
        } else {
            showMessage('todayMessage', 'Cập nhật số lượng và giờ chốt thành công! ✅', 'success');
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
            const today = getLocalDateInputValue();
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
    summary.innerHTML = `Tổng số suất ngày <strong>${selectedDate}</strong>: <strong>${selected?.ordered || 0}</strong>`;
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
    const dateLabel = document.getElementById('orderToolsDateLabel');
    if (dateLabel) dateLabel.textContent = `Đang xem ngày ${date}`;
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
    renderKitchenSummary();
    if (!historyOrders.length) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Không có đơn hàng trong ngày này.</div>';
        return;
    }

    const filteredOrders = historyOrders.filter((order) => {
        const isDeleted = Boolean(order.is_deleted);
        const isDone = order.kitchen_status === 'done';
        if (kitchenOrderFilter === 'pending') {
            return (!isDeleted && !isDone) || (isDeleted && order.kitchen_status === 'cancel_pending');
        }
        if (kitchenOrderFilter === 'done') {
            return (!isDeleted && isDone) || (isDeleted && order.kitchen_status === 'cancel_done');
        }
        if (kitchenOrderFilter === 'changes') {
            return isDeleted || order.change_action === 'edited';
        }
        return true;
    });

    if (!filteredOrders.length) {
        list.innerHTML = '<div class="kitchen-empty">Không có đơn phù hợp với trạng thái này.</div>';
        return;
    }

    const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
    if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
    const startIndex = (historyCurrentPage - 1) * PAGE_SIZE;
    const pageRows = filteredOrders.slice(startIndex, startIndex + PAGE_SIZE);

    const rowsHtml = pageRows.map((order, pageIndex) => {
        const displayNumber = filteredOrders.length - (startIndex + pageIndex);
        const disc = Number(order.discount_percent || 0);
        const isDeleted = Boolean(order.is_deleted);
        const isDone = order.kitchen_status === 'done';
        const isCancelHandled = order.kitchen_status === 'cancel_done';
        const changeAction = order.change_action || 'created';
        const deletedByLabel = order.actor_type === 'admin' ? 'Admin đã xóa' : 'Khách đã xóa';
        const changeNote = changeAction === 'edited'
            ? `<div class="order-change-note order-change-edited">Đơn đã sửa lúc ${AppUtils.formatDateTime(order.change_at)}${isDone ? ' · Đã xử lý lại' : ' · Cần kiểm tra lại'}</div>`
            : changeAction === 'deleted'
                ? `<div class="order-change-note order-change-deleted">${deletedByLabel} lúc ${AppUtils.formatDateTime(order.change_at)}${isCancelHandled ? ' · Đã xử lý hủy' : ' · Cần xử lý hủy'}</div>`
                : '';
        const discBadge = disc > 0 ? `<span class="discount-badge">-${disc}% / 1 suất</span>` : '';
        const promoInfo = disc > 0 ? `<div class="admin-payment-meta promo-info-text">Mã KM: ${escapeHtml(order.promo_code || '')} — Giảm ${disc}% cho 1 suất</div>` : '';
        const kitchenControl = isDeleted
            ? `<button class="kitchen-cancel-btn ${isCancelHandled ? 'handled' : ''}" type="button"
                    ${isCancelHandled ? 'disabled' : `onclick="acknowledgeDeletedOrder(${Number(order.change_log_id || 0)}, this)"`}>
                    ${isCancelHandled ? 'Đã xử lý hủy' : 'Xác nhận đã xử lý hủy'}
               </button>`
            : `<label class="kitchen-check ${isDone ? 'checked' : ''}">
                    <input type="checkbox" ${isDone ? 'checked' : ''}
                        onchange="toggleOrderKitchenStatus(${order.id}, this)">
                    <span>${isDone ? `Đã làm xong ${order.quantity} suất` : `Đánh dấu xong ${order.quantity} suất`}</span>
               </label>`;
        return `
        <div class="order-row kitchen-order-card ${isDone ? 'kitchen-order-done' : 'kitchen-order-pending'} ${disc > 0 ? 'order-row-discounted' : ''} ${isDeleted ? 'order-row-deleted' : ''} ${changeAction === 'edited' ? 'order-row-edited' : ''}">
            <div class="order-info kitchen-order-main">
                <div class="kitchen-order-heading">
                    <div class="order-name"><span class="kitchen-order-number">${displayNumber}.</span> ${escapeHtml(order.name)} ${discBadge}</div>
                    <span class="kitchen-quantity">${order.quantity} suất</span>
                </div>
                ${order.description ? `<div class="order-details"><strong>Ghi chú:</strong> ${escapeHtml(order.description)}</div>` : ''}
                ${promoInfo}
                ${changeNote}
                <div class="admin-payment-meta">Thời gian đặt: ${AppUtils.formatDateTime(order.created_at)}</div>
                ${isDone && order.kitchen_completed_at ? `<div class="kitchen-completed-time">Hoàn thành: ${AppUtils.formatDateTime(order.kitchen_completed_at)}</div>` : ''}
            </div>
            <div class="kitchen-order-controls">
                ${kitchenControl}
                ${isDeleted ? '' : `<button class="edit-icon-btn" title="Chỉnh sửa đơn" onclick="openOrderEditModal(${order.id}, '${encodeURIComponent(order.name)}', ${order.quantity}, '${encodeURIComponent(order.description || '')}', '${currentHistoryDetailDate}')">Sửa</button>`}
            </div>
        </div>
        `;
    }).join('');

    list.innerHTML = rowsHtml + renderPaginationControls('historyCurrentPage', historyCurrentPage, totalPages, 'renderHistoryOrders');
}

function renderKitchenSummary() {
    const summary = document.getElementById('kitchenSummary');
    if (!summary) return;
    const activeOrders = historyOrders.filter((order) => !order.is_deleted);
    const pendingServings = activeOrders
        .filter((order) => order.kitchen_status !== 'done')
        .reduce((sum, order) => sum + Number(order.quantity || 0), 0);
    const doneServings = activeOrders
        .filter((order) => order.kitchen_status === 'done')
        .reduce((sum, order) => sum + Number(order.quantity || 0), 0);
    const totalServings = activeOrders.reduce((sum, order) => sum + Number(order.quantity || 0), 0);
    const pendingChanges = historyOrders.filter((order) => (
        (order.is_deleted && order.kitchen_status === 'cancel_pending')
        || (!order.is_deleted && order.change_action === 'edited' && order.kitchen_status !== 'done')
    )).length;
    summary.innerHTML = `
        <div><span>Suất mới đặt</span><strong>${pendingServings} suất</strong></div>
        <div><span>Đã hoàn thành</span><strong>${doneServings} suất</strong></div>
        <div class="${pendingChanges ? 'has-alert' : ''}"><span>Sửa / hủy cần xử lý</span><strong>${pendingChanges}</strong></div>
        <div><span>Tổng số suất</span><strong>${totalServings} suất</strong></div>
    `;
}

function setKitchenOrderFilter(filter) {
    kitchenOrderFilter = ['all', 'pending', 'done', 'changes'].includes(filter) ? filter : 'all';
    historyCurrentPage = 1;
    updateKitchenFilterButtons();
    renderHistoryOrders();
}

function updateKitchenFilterButtons() {
    document.querySelectorAll('.kitchen-filter-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.filter === kitchenOrderFilter);
    });
}

function toggleOrderKitchenStatus(orderId, checkbox) {
    const status = checkbox.checked ? 'done' : 'pending';
    checkbox.disabled = true;
    fetch(`${API_BASE}/api/admin/orders/${orderId}/kitchen-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    })
        .then(res => res.json().then(data => {
            if (!res.ok || data.error) throw new Error(data.error || 'Không cập nhật được trạng thái');
        }))
        .then(() => loadOrderListByDate(currentHistoryDetailDate))
        .catch((error) => {
            checkbox.checked = !checkbox.checked;
            checkbox.disabled = false;
            showPopup(`Lỗi cập nhật trạng thái: ${error.message}`);
        });
}

function acknowledgeDeletedOrder(changeLogId, button) {
    if (!changeLogId) return;
    button.disabled = true;
    fetch(`${API_BASE}/api/admin/order-changes/${changeLogId}/acknowledge`, { method: 'PUT' })
        .then(res => res.json().then(data => {
            if (!res.ok || data.error) throw new Error(data.error || 'Không xác nhận được yêu cầu hủy');
        }))
        .then(() => loadOrderListByDate(currentHistoryDetailDate))
        .catch((error) => {
            button.disabled = false;
            showPopup(`Lỗi xử lý yêu cầu hủy: ${error.message}`);
        });
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
            kitchenOrderFilter = 'pending';
            historyCurrentPage = 1;
            updateKitchenFilterButtons();
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
    const summary = document.getElementById('adminDebtSummaryMeta');
    container.innerHTML = '<div class="loading">Đang tải...</div>';
    if (summary) {
        summary.innerHTML = 'Đang tính tổng công nợ...';
    }
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
    const summary = document.getElementById('adminDebtSummaryMeta');
    if (!debtRows.length) {
        if (summary) {
            summary.innerHTML = 'Tổng công nợ theo bộ lọc: <strong>0đ</strong>';
        }
        container.innerHTML = '<div style="padding: 14px; color:#999; text-align:center;">Không có công nợ cần xử lý.</div>';
        return;
    }

    const totalRemaining = debtRows.reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0);
    if (summary) {
        summary.innerHTML = `Tổng khách theo bộ lọc: <strong>${debtRows.length}</strong> · Tổng tiền cần thu: <strong>${AppUtils.formatCurrency(totalRemaining)}</strong>`;
    }

    const totalPages = Math.ceil(debtRows.length / PAGE_SIZE);
    if (debtCurrentPage > totalPages) debtCurrentPage = totalPages;
    const startIndex = (debtCurrentPage - 1) * PAGE_SIZE;
    const pageRows = debtRows.slice(startIndex, startIndex + PAGE_SIZE);

    const rowsHtml = pageRows.map((row) => {
        return `
            <div class="admin-payment-row">
                <div>
                    <div class="order-name payment-name-link" onclick="openCustomerOrderModal('${encodeURIComponent(row.name || '')}')">${escapeHtml(row.name)}</div>
                    <div class="admin-payment-meta">Số suất: ${row.quantity} </br> Tổng tiền: ${AppUtils.formatCurrency(row.totalAmount || 0)}</div>
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
    const summary = document.getElementById('adminPaymentSummaryMeta');
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
    if (summary) {
        summary.innerHTML = 'Đang tính tổng thanh toán...';
    }
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
    const summary = document.getElementById('adminPaymentSummaryMeta');
    if (!paymentRows.length) {
        if (summary) {
            summary.innerHTML = 'Tổng thanh toán thành công theo bộ lọc: <strong>0đ</strong>';
        }
        container.innerHTML = '<div style="padding: 16px; color: #999; text-align: center;">Không có giao dịch theo bộ lọc hiện tại.</div>';
        return;
    }

    const totalRequestAmount = paymentRows.reduce((sum, row) => sum + Number(row.request_amount || 0), 0);
    const totalPaidAmount = paymentRows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const successfulPaidAmount = paymentRows.reduce((sum, row) => {
        const statusText = String(row.request_status || 'PENDING').toUpperCase();
        return statusText === 'PAID' ? sum + Number(row.paid_amount || 0) : sum;
    }, 0);
    if (summary) {
        summary.innerHTML = `Tổng giao dịch theo bộ lọc: <strong>${paymentRows.length}</strong> · Tổng đã thu: <strong>${AppUtils.formatCurrency(totalPaidAmount)}</strong>`;
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
                    <div class="order-name" style="display:flex;align-items:center;gap:8px;">${escapeHtml(row.customer_name)} <span class="payment-status-badge ${cls}">${escapeHtml(label)}</span></div>
                    <div class="admin-payment-meta">Ngày: ${escapeHtml(row.date)} | OrderCode: ${row.order_code}</div>
                    <div class="admin-payment-meta">Số tiền: ${AppUtils.formatCurrency(amount)} | Đã thanh toán: ${AppUtils.formatCurrency(paidAmount)} | Ref: ${escapeHtml(row.latest_reference || row.payment_link_id || '-')}</div>
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

function onFeedbackSearchKeyDown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        loadFeedbackList();
    }
}

function loadFeedbackList() {
    const search = (document.getElementById('feedbackSearchInput')?.value || '').trim();
    const summary = document.getElementById('feedbackSummaryInfo');
    const container = document.getElementById('feedbackList');
    const params = new URLSearchParams();

    if (search) {
        params.set('search', search);
    }

    container.innerHTML = '<div class="loading">Đang tải...</div>';
    if (summary) {
        summary.innerHTML = 'Đang tải góp ý...';
    }

    const query = params.toString();
    const url = query ? `${API_BASE}/api/admin/feedback?${query}` : `${API_BASE}/api/admin/feedback`;

    fetch(url)
        .then(res => res.json())
        .then(rows => {
            feedbackRows = rows || [];
            feedbackCurrentPage = 1;
            renderFeedbackList();
        })
        .catch(err => {
            container.innerHTML = `<div style="padding: 14px; color:red; text-align:center;">Lỗi tải góp ý: ${err.message}</div>`;
        });
}

function renderFeedbackList() {
    const summary = document.getElementById('feedbackSummaryInfo');
    const container = document.getElementById('feedbackList');

    if (!feedbackRows.length) {
        if (summary) {
            summary.innerHTML = 'Không có góp ý nào theo bộ lọc hiện tại.';
        }
        container.innerHTML = '<div style="padding: 14px; color:#999; text-align:center;">Chưa có góp ý nào để hiển thị.</div>';
        return;
    }

    if (summary) {
        summary.innerHTML = `Tổng góp ý theo bộ lọc: <strong>${feedbackRows.length}</strong>`;
    }

    const totalPages = Math.ceil(feedbackRows.length / PAGE_SIZE);
    if (feedbackCurrentPage > totalPages) feedbackCurrentPage = totalPages;
    const startIndex = (feedbackCurrentPage - 1) * PAGE_SIZE;
    const pageRows = feedbackRows.slice(startIndex, startIndex + PAGE_SIZE);

    const rowsHtml = pageRows.map((row) => `
        <article class="feedback-admin-card">
            <div class="feedback-admin-meta">
                <span class="feedback-admin-badge">Ẩn danh</span>
                <span>${AppUtils.formatDateTime(row.created_at)}</span>
            </div>
            <p class="feedback-admin-text">${escapeHtml(row.message || '')}</p>
        </article>
    `).join('');

    container.innerHTML = rowsHtml + renderPaginationControls('feedbackCurrentPage', feedbackCurrentPage, totalPages, 'renderFeedbackList');
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
                    promoHtml = row.promos.map(p => {
                        const fullPriceText = Number(p.full_price_quantity || 0) > 0
                            ? ` · ${p.full_price_quantity} suất còn lại tính giá gốc`
                            : '';
                        return `<div class="promo-detail-note">🎫 Mã <strong>${escapeHtml(p.promo_code)}</strong>: giảm ${p.discount_percent}% cho ${p.discount_quantity || 1} suất × ${AppUtils.formatCurrency(p.finalPrice)}/suất${fullPriceText}</div>`;
                    }).join('');
                }
                return `
                <div class="day-modal-order-item">
                    <div><strong>Ngày:</strong> ${row.date}</div>
                    <div><strong>Số suất:</strong> ${row.quantity}</div>
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
    element.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
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
function loadConsecutiveStreaks() {
    const list = document.getElementById('streakAdminList');
    const summary = document.getElementById('streakAdminSummary');
    if (!list || !summary) return;
    list.innerHTML = '<div class="loading">Đang tải...</div>';

    fetch(`${API_BASE}/api/admin/consecutive-streaks`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            const activeRows = (data.rows || []).filter(row => Number(row.current_days || 0) > 0);
            const nearTarget = activeRows.filter(row => Number(row.remaining_days || 0) <= 1).length;
            summary.innerHTML = `
                <div><span>Trạng thái</span><strong class="${data.enabled ? 'streak-enabled' : 'streak-disabled'}">${data.enabled ? 'Đang bật' : 'Đang tắt'}</strong></div>
                <div><span>Chuỗi đang hoạt động</span><strong>${activeRows.length}</strong></div>
                <div><span>Sắp đạt mốc</span><strong>${nearTarget}</strong></div>
                <div><span>Batch gần nhất</span><strong>${data.lastBatchDate || 'Chưa chạy'}</strong></div>
            `;

            if (!activeRows.length) {
                list.innerHTML = '<div class="streak-admin-empty">Hiện chưa có người dùng nào đang duy trì chuỗi đặt cơm.</div>';
                return;
            }

            list.innerHTML = `<div class="streak-admin-list">${activeRows.map(row => {
                const currentDays = Number(row.current_days || 0);
                const remainingDays = Number(row.remaining_days || 0);
                const cycleDays = currentDays > 0 && currentDays % data.requiredDays === 0
                    ? data.requiredDays
                    : currentDays % data.requiredDays;
                const percent = Math.min(100, Math.round((cycleDays / data.requiredDays) * 100));
                const targetText = remainingDays === 0
                    ? (row.current_cycle_awarded ? 'Đã nhận mã chu kỳ này' : 'Đủ điều kiện, chờ batch 06:00')
                    : `Còn ${remainingDays} ngày để đạt mốc`;
                const cycleStatus = Number(row.current_milestone_days || 0) <= 0
                    ? 'Chưa đạt mốc'
                    : row.current_cycle_awarded
                        ? `Đã cấp mốc ${Number(row.current_milestone_days)} ngày`
                        : `Chưa cấp mốc ${Number(row.current_milestone_days)} ngày`;
                return `
                    <div class="streak-admin-row">
                        <div class="streak-admin-person">
                            <strong>${escapeHtml(row.name)}</strong>
                            <span>${escapeHtml(row.phone)} · Đặt gần nhất: ${row.last_order_date || 'Chưa có'}</span>
                        </div>
                        <div class="streak-admin-progress">
                            <div><strong>${currentDays} ngày</strong><span>${escapeHtml(targetText)}</span></div>
                            <div class="streak-admin-track"><span style="width:${percent}%"></span></div>
                        </div>
                        <div class="streak-admin-awards">
                            <strong>${Number(row.promo_count || 0)} mã</strong>
                            <span>${escapeHtml(cycleStatus)}</span>
                        </div>
                    </div>
                `;
            }).join('')}</div>`;
        })
        .catch(err => {
            list.innerHTML = `<div class="error-message">Lỗi tải danh sách chuỗi: ${escapeHtml(err.message)}</div>`;
        });
}

let promoUserAccounts = [];

function renderPromoUserOptions(searchValue = '') {
    const select = document.getElementById('newPromoUser');
    if (!select) return;
    const selectedValue = select.value;
    const searchKey = AppUtils.getSearchKey(searchValue);
    const filteredUsers = promoUserAccounts.filter((user) => {
        if (!searchKey) return true;
        return AppUtils.getSearchKey(`${user.name} ${user.phone}`).includes(searchKey);
    });
    const userOptions = filteredUsers
        .map(user => `<option value="${user.id}">${escapeHtml(user.name)} - ${escapeHtml(user.phone)}</option>`)
        .join('');
    const emptyOption = searchKey && !filteredUsers.length
        ? '<option value="" disabled>Không tìm thấy tài khoản phù hợp</option>'
        : '';
    select.innerHTML = `<option value="">Không gửi tới tài khoản cụ thể</option>${emptyOption}${userOptions}`;
    if (filteredUsers.some((user) => String(user.id) === selectedValue)) {
        select.value = selectedValue;
    }
}

function loadPromoUserOptions() {
    const select = document.getElementById('newPromoUser');
    if (!select) return;

    fetch(`${API_BASE}/api/admin/users`)
        .then(res => res.json())
        .then(users => {
            promoUserAccounts = (users || []).filter(user => user.role === 'user');
            renderPromoUserOptions(document.getElementById('newPromoUserSearch')?.value || '');
        })
        .catch(() => {
            select.innerHTML = '<option value="">Không tải được danh sách tài khoản</option>';
        });
}

document.getElementById('newPromoUserSearch')?.addEventListener('input', (event) => {
    renderPromoUserOptions(event.target.value);
});

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
                let sourceInfo = '<div class="admin-payment-meta">Mã tạo thủ công, không gắn tài khoản cụ thể</div>';
                if (c.source === 'admin_gift') {
                    sourceInfo = `<div class="admin-payment-meta">Mã quà tặng cho ${escapeHtml(c.issued_to_name || 'khách hàng')} · Nhận ngày ${AppUtils.formatDateTime(c.created_at)}</div>`;
                } else if (c.source === 'auto_consecutive') {
                    const earnedDate = c.earned_streak_date ? ` · Đạt ngày ${escapeHtml(c.earned_streak_date)}` : '';
                    sourceInfo = `<div class="admin-payment-meta">Mã chương trình đặt liên tục cho ${escapeHtml(c.issued_to_name || 'khách hàng')} · Mốc ${Number(c.earned_streak_days || 0)} ngày${earnedDate}</div>`;
                }
                return `
                    <div class="admin-payment-row ${isUsed ? 'promo-used' : ''}">
                        <div>
                            <div class="order-name" style="font-family:monospace; letter-spacing:1px;">${escapeHtml(c.code)}</div>
                            <div class="admin-payment-meta">Giảm <strong>${c.discount_percent}%</strong> · Tạo: ${AppUtils.formatDateTime(c.created_at)}</div>
                            ${sourceInfo}
                            <span class="payment-status-badge ${statusCls}">${escapeHtml(statusLabel)}</span>
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

function generatePromoCode() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const datePart = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
    ].join('');
    const timePart = [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds())
    ].join('');
    const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
    const code = `DATCOM-${datePart}-${timePart}${suffix}`;
    const input = document.getElementById('newPromoCode');
    input.value = code;
    input.focus();
    input.select();
}

function createPromoCode() {
    const codeInput = document.getElementById('newPromoCode');
    if (!codeInput.value.trim()) {
        generatePromoCode();
    }
    const code = codeInput.value.trim().toUpperCase();
    const discount = Number(document.getElementById('newPromoDiscount').value || 0);
    const issuedToUserId = Number(document.getElementById('newPromoUser')?.value || 0);
    const msgEl = document.getElementById('promoAdminMessage');

    if (!code || discount <= 0 || discount > 100) {
        msgEl.innerHTML = '<div class="error-message">Vui lòng nhập mã và phần trăm giảm giá hợp lệ (1-100%)</div>';
        return;
    }

    fetch(`${API_BASE}/api/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, discountPercent: discount, issuedToUserId })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        msgEl.innerHTML = '<div class="success-message">Tạo mã khuyến mãi thành công!</div>';
        document.getElementById('newPromoCode').value = '';
        document.getElementById('newPromoDiscount').value = '';
        if (document.getElementById('newPromoUser')) {
            document.getElementById('newPromoUser').value = '';
        }
        if (document.getElementById('newPromoUserSearch')) {
            document.getElementById('newPromoUserSearch').value = '';
            renderPromoUserOptions('');
        }
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
let userCurrentPage = 1;
const USER_PAGE_SIZE = 10;

function loadUsers(page = userCurrentPage) {
    const container = document.getElementById('userList');
    const pagination = document.getElementById('userPagination');
    container.innerHTML = '<div class="loading">Đang tải...</div>';
    pagination.innerHTML = '';

    fetch(`${API_BASE}/api/admin/users?page=${page}&limit=${USER_PAGE_SIZE}`)
        .then(res => res.json().then(data => {
            if (!res.ok || data.error) throw new Error(data.error || 'Không tải được danh sách người dùng');
            return data;
        }))
        .then(data => {
            const users = data.rows || [];
            userCurrentPage = data.page || 1;
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
                            <div class="order-name">${escapeHtml(u.name)} ${roleBadge}</div>
                            <div class="admin-payment-meta">SĐT: ${escapeHtml(u.phone)} · Tạo: ${AppUtils.formatDateTime(u.created_at)}</div>
                        </div>
                        <div class="admin-payment-actions">
                            <button class="btn-warning btn-small" onclick="resetUserPassword(${u.id}, '${encodeURIComponent(u.name)}')">Đổi MK</button>
                            <button class="btn-danger btn-small" onclick="deleteUser(${u.id}, '${encodeURIComponent(u.name)}')">Xóa</button>
                        </div>
                    </div>
                `;
            }).join('');
            pagination.innerHTML = `
                <button class="btn-secondary btn-small" type="button" onclick="loadUsers(${data.page - 1})" ${data.page <= 1 ? 'disabled' : ''}>TRƯỚC</button>
                <span>Trang ${data.page}/${data.totalPages} · ${data.total} tài khoản</span>
                <button class="btn-secondary btn-small" type="button" onclick="loadUsers(${data.page + 1})" ${data.page >= data.totalPages ? 'disabled' : ''}>SAU</button>
            `;
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
        loadUsers(1);
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
            loadUsers(userCurrentPage);
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
let shopClosurePage = 1;

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
            document.getElementById('settingShopClosedEnabled').checked = settings.shop_closed_enabled === '1';
            document.getElementById('settingShopClosedReason').value = settings.shop_closed_reason || 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.';
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
    const shopClosedEnabled = document.getElementById('settingShopClosedEnabled').checked;
    document.getElementById('shopClosedFields').style.display = shopClosedEnabled ? 'block' : 'none';
}

function openShopClosureHistory() {
    shopClosurePage = 1;
    document.getElementById('shopClosureHistoryModal').style.display = 'flex';
    loadShopClosureHistory(shopClosurePage);
}

function closeShopClosureHistory() {
    document.getElementById('shopClosureHistoryModal').style.display = 'none';
}

function loadShopClosureHistory(page = 1) {
    const list = document.getElementById('shopClosureHistoryList');
    const pagination = document.getElementById('shopClosurePagination');
    if (!list) return;
    list.classList.add('loading');
    list.innerHTML = 'Đang tải...';
    pagination.innerHTML = '';
    fetch(`${API_BASE}/api/admin/shop-closures?page=${page}&limit=8`)
        .then(res => res.json().then(data => {
            if (!res.ok || data.error) throw new Error(data.error || 'Không tải được lịch nghỉ');
            return data;
        }))
        .then(data => {
            shopClosurePage = data.page;
            list.classList.remove('loading');
            if (!data.rows.length) {
                list.innerHTML = '<div class="shop-closure-empty">Chưa có ngày nghỉ nào được khai báo.</div>';
                return;
            }
            list.innerHTML = data.rows.map(row => `
                <div class="shop-closure-item">
                    <div>
                        <strong>${escapeHtml(formatDate(row.closure_date))}</strong>
                        <span>${escapeHtml(row.reason)}</span>
                    </div>
                    <button class="btn-danger btn-small" type="button" onclick="deleteShopClosure('${row.closure_date}')">XÓA</button>
                </div>
            `).join('');
            pagination.innerHTML = `
                <button class="btn-secondary btn-small" type="button" onclick="loadShopClosureHistory(${data.page - 1})" ${data.page <= 1 ? 'disabled' : ''}>TRƯỚC</button>
                <span>Trang ${data.page}/${data.totalPages} · ${data.total} ngày nghỉ</span>
                <button class="btn-secondary btn-small" type="button" onclick="loadShopClosureHistory(${data.page + 1})" ${data.page >= data.totalPages ? 'disabled' : ''}>SAU</button>
            `;
        })
        .catch(err => {
            list.classList.remove('loading');
            list.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        });
}

function deleteShopClosure(date) {
    showPopup(`Xóa ngày nghỉ ${formatDate(date)}?`, { type: 'confirm', danger: true })
        .then(confirmed => {
            if (!confirmed) return;
            fetch(`${API_BASE}/api/admin/shop-closures/${encodeURIComponent(date)}`, { method: 'DELETE' })
                .then(res => res.json().then(data => {
                    if (!res.ok || data.error) throw new Error(data.error || 'Không xóa được ngày nghỉ');
                }))
                .then(() => {
                    showClosureHistoryMessage('Đã xóa ngày nghỉ và tính lại chuỗi đặt cơm.');
                    loadShopClosureHistory(shopClosurePage);
                    loadSettings();
                })
                .catch(err => showClosureHistoryMessage(err.message, true));
        });
}

function showClosureHistoryMessage(message, isError = false) {
    const element = document.getElementById('closureHistoryMessage');
    element.innerHTML = `<div class="${isError ? 'error-message' : 'success-message'}">${escapeHtml(message)}</div>`;
    setTimeout(() => { element.innerHTML = ''; }, 4000);
}

document.getElementById('settingDebtLimitEnabled').addEventListener('change', toggleSettingsFields);
document.getElementById('settingConsecutivePromoEnabled').addEventListener('change', toggleSettingsFields);
document.getElementById('settingShopClosedEnabled').addEventListener('change', toggleSettingsFields);

function saveSettings() {
    const settings = {
        debt_limit_enabled: document.getElementById('settingDebtLimitEnabled').checked ? '1' : '0',
        debt_limit_servings: document.getElementById('settingDebtLimitServings').value || '2',
        debt_limit_message: document.getElementById('settingDebtLimitMessage').value || '',
        consecutive_promo_enabled: document.getElementById('settingConsecutivePromoEnabled').checked ? '1' : '0',
        consecutive_promo_days: document.getElementById('settingConsecutivePromoDays').value || '5',
        consecutive_promo_discount: document.getElementById('settingConsecutivePromoDiscount').value || '50',
        shop_closed_enabled: document.getElementById('settingShopClosedEnabled').checked ? '1' : '0',
        shop_closed_reason: document.getElementById('settingShopClosedReason').value || 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.'
    };

    fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    })
    .then(res => res.json().then(data => {
        if (!res.ok || data.error) throw new Error(data.error || 'Không lưu được cài đặt');
        return data;
    }))
    .then(data => {
        const closureMessage = data.shopClosedToday
            ? 'Quán đã được đóng hôm nay và lưu vào lịch sử nghỉ.'
            : 'Đã lưu cài đặt. Quán đang mở hôm nay.';
        document.getElementById('settingsMessage').innerHTML = `<div class="success-message">${escapeHtml(closureMessage)}</div>`;
        loadSettings();
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
