const API_BASE = window.location.origin;

// Modal controls
const orderModal = document.getElementById('orderModal');
const listModal = document.getElementById('listModal');

const paymentModal = document.getElementById('paymentModal');
const paymentDetailModal = document.getElementById('paymentDetailModal');
const paymentQrModal = document.getElementById('paymentQrModal');
const paymentHistoryModal = document.getElementById('paymentHistoryModal');

const customerNameInput = document.getElementById('customerName');

document.getElementById('btnPayment').addEventListener('click', () => {
    paymentModal.style.display = 'flex';
    loadPaymentList();
});

document.getElementById('mobileBtnOrder').addEventListener('click', () => {
    document.getElementById('btnOrder').click();
});

document.getElementById('mobileBtnPayment').addEventListener('click', () => {
    document.getElementById('btnPayment').click();
});

document.getElementById('mobileBtnList').addEventListener('click', () => {
    document.getElementById('btnList').click();
});

document.getElementById('closePayment').addEventListener('click', () => {
    paymentModal.style.display = 'none';
});

document.getElementById('closePaymentDetail').addEventListener('click', () => {
    paymentDetailModal.style.display = 'none';
});

document.getElementById('closePaymentQr').addEventListener('click', () => {
    paymentQrModal.style.display = 'none';
});

document.getElementById('closePaymentHistory').addEventListener('click', () => {
    paymentHistoryModal.style.display = 'none';
});

document.getElementById('btnSearchPayment').addEventListener('click', loadPaymentList);
document.getElementById('paymentSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        loadPaymentList();
    }
});

document.getElementById('btnPaymentHistory').addEventListener('click', loadPaymentHistory);
document.getElementById('historyPeriodFilter').addEventListener('change', togglePaymentHistoryInputs);
document.getElementById('btnApplyHistoryFilter').addEventListener('click', loadPaymentHistory);
document.getElementById('btnResetHistoryFilter').addEventListener('click', resetPaymentHistoryFilter);

customerNameInput.addEventListener('blur', () => {
    customerNameInput.value = AppUtils.normalizeName(customerNameInput.value);
});

function cleanPaymentQueryParams() {
    const url = new URL(window.location.href);
    ['payment', 'code', 'id', 'cancel', 'status', 'orderCode'].forEach((key) => {
        url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = (params.get('payment') || '').toLowerCase();
    const orderCode = params.get('orderCode');

    if (!payment) {
        return;
    }

    if (payment === 'cancel') {
        alert('Bạn đã hủy thanh toán. Nếu cần, vui lòng quét lại mã QR để thanh toán.');
        cleanPaymentQueryParams();
        return;
    }

    if (payment !== 'success' || !orderCode) {
        cleanPaymentQueryParams();
        return;
    }

    try {
        const data = await AppUtils.fetchJson(`${API_BASE}/api/payments/verify-return?orderCode=${encodeURIComponent(orderCode)}`);

        if (data.updated) {
            alert('Thanh toán thành công! Hệ thống đã cập nhật trạng thái đơn hàng.');
        } else {
            alert('Đã nhận trạng thái thanh toán, hệ thống đang chờ xác nhận cuối cùng từ PayOS.');
        }
    } catch (error) {
        alert(`Thanh toán đã hoàn tất nhưng chưa cập nhật tự động: ${error.message}. Vui lòng liên hệ quản trị để kiểm tra.`);
    } finally {
        cleanPaymentQueryParams();
        loadTodayInfo();
    }
}

function loadCustomerNameSuggestions() {
    AppUtils.fetchJson(`${API_BASE}/api/customers/names`)
        .then(names => {
            const datalist = document.getElementById('customerNameSuggestions');
            if (!Array.isArray(names)) {
                datalist.innerHTML = '';
                return;
            }

            datalist.innerHTML = names
                .map(name => `<option value="${name}"></option>`)
                .join('');
        })
        .catch(() => {
            // Không block luồng đặt cơm nếu API gợi ý lỗi.
        });
}

function loadPaymentList() {
    const keyword = document.getElementById('paymentSearch').value.trim();
    const url = keyword ? `${API_BASE}/api/payments/today?search=${encodeURIComponent(keyword)}` : `${API_BASE}/api/payments/today`;
    // API trả về công nợ chưa thanh toán được cộng dồn toàn bộ thời gian
    const list = document.getElementById('paymentList');
    list.innerHTML = '<div style="padding: 16px">Đang tải...</div>';

    fetch(url)
        .then(async (res) => {
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Không thể tải danh sách thanh toán');
            }
            return data;
        })
        .then(rows => {
            if (!Array.isArray(rows) || rows.length === 0) {
                list.innerHTML = '<div style="padding: 16px">Không có dữ liệu phù hợp.</div>';
                return;
            }

            list.innerHTML = rows.map((row) => `
                <div class="order-item payment-order-item">
                    <div class="order-info">
                        <h4>${row.name} - ${row.quantity} xuất</h4>
                        <p><strong>Tổng tiền:</strong> ${AppUtils.formatCurrency(row.totalAmount)}</p>
                    </div>
                    <div class="payment-action-group">
                        <button class="payment-detail-btn" data-customer-name="${encodeURIComponent(row.name)}">Chi tiết</button>
                        <button class="pay-btn" data-customer-name="${encodeURIComponent(row.name)}" ${row.remainingAmount <= 0 ? 'disabled' : ''}>Thanh toán</button>
                    </div>
                </div>
            `).join('');
        })
        .catch(err => {
            list.innerHTML = `<div style="padding:16px;color:#9b3f3f">Lỗi tải danh sách thanh toán: ${err.message}</div>`;
        });
}

function formatDateTime(value) {
    return AppUtils.formatDateTime(value);
}

function openPaymentDetail(name) {
    const container = document.getElementById('paymentDetailContent');
    container.innerHTML = '<div style="padding: 16px">Đang tải chi tiết...</div>';
    paymentDetailModal.style.display = 'flex';

    AppUtils.fetchJson(`${API_BASE}/api/payments/today/${encodeURIComponent(name)}/details`)
        .then((data) => {
            const rows = Array.isArray(data.rows) ? data.rows : [];
            if (!rows.length) {
                container.innerHTML = '<div style="padding: 16px">Không có xuất chưa thanh toán.</div>';
                return;
            }

            let html = `
                <div class="payment-detail-header">
                    <strong>${data.name}</strong>
                    <span>Tổng ${data.totalQuantity} xuất • ${AppUtils.formatCurrency(data.totalAmount)}</span>
                </div>
                <div class="payment-detail-list">
            `;

            rows.forEach((row, index) => {
                html += `
                    <div class="order-item payment-detail-item">
                        <div class="order-info">
                            <h4>Đã đặt ${row.quantity} xuất vào ngày ${formatDateTime(row.createdAt)}</h4>
                            <h4>Tổng tiền ${AppUtils.formatCurrency(row.amount)}</h4>
                        </div>
                    </div>
                `; 
            });

            html += '</div>';
            container.innerHTML = html;
        })
        .catch((error) => {
            container.innerHTML = `<div style="padding:16px;color:#9b3f3f">Lỗi tải chi tiết: ${error.message}</div>`;
        });
}

document.getElementById('paymentList').addEventListener('click', (event) => {
    const detailBtn = event.target.closest('.payment-detail-btn');
    if (detailBtn) {
        const encodedName = detailBtn.getAttribute('data-customer-name') || '';
        const name = decodeURIComponent(encodedName);
        if (!name) {
            alert('Không xác định được tên người đặt cơm. Vui lòng tải lại danh sách.');
            return;
        }
        openPaymentDetail(name);
        return;
    }

    const payBtn = event.target.closest('.pay-btn');
    if (!payBtn || payBtn.disabled) {
        return;
    }

    const encodedName = payBtn.getAttribute('data-customer-name') || '';
    const name = decodeURIComponent(encodedName);
    if (!name) {
        alert('Không xác định được tên người đặt cơm. Vui lòng tải lại danh sách.');
        return;
    }

    openPayQr(name);
});

window.openPayQr = function(name) {
    fetch(`${API_BASE}/api/payments/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }

        if (!data.payos || !data.payos.checkoutUrl) {
            throw new Error('Không lấy được link thanh toán');
        }

        // 👉 Redirect thẳng sang PayOS
        window.location.href = data.payos.checkoutUrl;
    })
    .catch(err => {
        alert(`Lỗi tạo thanh toán: ${err.message}`);
    });
}


function togglePaymentHistoryInputs() {
    const period = document.getElementById('historyPeriodFilter').value;
    const dateInput = document.getElementById('historyDateFilter');
    const weekInput = document.getElementById('historyWeekFilter');
    const monthInput = document.getElementById('historyMonthFilter');

    dateInput.style.display = period === 'date' ? 'block' : 'none';
    weekInput.style.display = period === 'week' ? 'block' : 'none';
    monthInput.style.display = period === 'month' ? 'block' : 'none';
}

function getWeekDateRange(weekValue) {
    if (!weekValue || !weekValue.includes('-W')) {
        return null;
    }

    const [yearPart, weekPart] = weekValue.split('-W');
    const year = Number(yearPart);
    const week = Number(weekPart);
    if (!Number.isFinite(year) || !Number.isFinite(week)) {
        return null;
    }

    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dayOfWeek = simple.getUTCDay();
    const monday = new Date(simple);
    if (dayOfWeek <= 4) {
        monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
    } else {
        monday.setUTCDate(simple.getUTCDate() + (8 - simple.getUTCDay()));
    }

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const toIsoDate = (date) => {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    return {
        fromDate: toIsoDate(monday),
        toDate: toIsoDate(sunday)
    };
}

function resetPaymentHistoryFilter() {
    document.getElementById('historyNameSearch').value = '';
    document.getElementById('historyPeriodFilter').value = 'all';
    document.getElementById('historyDateFilter').value = '';
    document.getElementById('historyWeekFilter').value = '';
    document.getElementById('historyMonthFilter').value = '';
    togglePaymentHistoryInputs();
    loadPaymentHistory();
}

function loadPaymentHistory() {
    const keyword = document.getElementById('historyNameSearch').value.trim();
    const period = document.getElementById('historyPeriodFilter').value;
    const selectedDate = document.getElementById('historyDateFilter').value;
    const selectedWeek = document.getElementById('historyWeekFilter').value;
    const selectedMonth = document.getElementById('historyMonthFilter').value;
    const historyBox = document.getElementById('paymentHistoryList');

    const params = new URLSearchParams();
    params.set('status', 'PAID');
    if (keyword) params.set('search', keyword);

    if (period === 'date') {
        if (!selectedDate) {
            historyBox.innerHTML = '<div style="padding:16px">Vui lòng chọn ngày cần lọc.</div>';
            paymentHistoryModal.style.display = 'flex';
            return;
        }
        params.set('period', 'date');
        params.set('date', selectedDate);
    } else if (period === 'month') {
        if (!selectedMonth) {
            historyBox.innerHTML = '<div style="padding:16px">Vui lòng chọn tháng cần lọc.</div>';
            paymentHistoryModal.style.display = 'flex';
            return;
        }
        params.set('period', 'month');
        params.set('month', selectedMonth);
    } else if (period === 'week') {
        const weekRange = getWeekDateRange(selectedWeek);
        if (!weekRange) {
            historyBox.innerHTML = '<div style="padding:16px">Vui lòng chọn tuần cần lọc.</div>';
            paymentHistoryModal.style.display = 'flex';
            return;
        }
        params.set('period', 'all');
        params.set('fromDate', weekRange.fromDate);
        params.set('toDate', weekRange.toDate);
    } else {
        params.set('period', 'all');
    }

    const url = `${API_BASE}/api/payments/history?${params.toString()}`;
    historyBox.innerHTML = '<div style="padding: 16px">Đang tải...</div>';
    paymentHistoryModal.style.display = 'flex';

    fetch(url)
        .then(res => res.json())
        .then(rows => {
            if (!rows || rows.length === 0) {
                historyBox.innerHTML = '<div style="padding:16px">Không tìm thấy lịch sử thanh toán phù hợp bộ lọc.</div>';
                return;
            }

            const toDateOnly = (value) => {
                if (!value) return '-';
                const s = String(value).replace(' ', 'T');
                const d = new Date(/[Zz]$|[+\-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z');
                return isNaN(d) ? String(value) : d.toLocaleDateString('vi-VN');
            };
            const statusMap = {
                PAID:      { cls: 'paid',      label: '✓ Đã thanh toán' },
                PENDING:   { cls: 'pending',   label: '⏳ Đang chờ' },
                CANCELLED: { cls: 'cancelled', label: '✗ Đã huỷ' },
                EXPIRED:   { cls: 'expired',   label: '⌛ Hết hạn' }
            };
            let html = '<div class="history-simple-list">';
            rows.forEach((row) => {
                const paidDate = toDateOnly(row.latest_paid_at || row.request_updated_at || row.request_created_at);
                const amount = AppUtils.formatCurrency(row.paid_amount || row.request_amount || 0);
                const statusKey = String(row.request_status || 'PENDING').toUpperCase();
                const { cls, label } = statusMap[statusKey] || { cls: 'pending', label: statusKey };
                html += `
                    <div class="history-simple-item">
                        <div class="history-simple-top">
                            <span class="history-simple-name">${row.customer_name}</span>
                            <span class="history-simple-status hss-${cls}">${label}</span>
                        </div>
                        <div class="history-simple-bottom">
                            <span class="history-simple-meta">${paidDate}</span>
                            <span class="history-simple-amount">${amount}</span>
                        </div>
                    </div>`;
            });
            html += '</div>';
            historyBox.innerHTML = html;
        })
        .catch(err => {
            historyBox.innerHTML = `<div style="padding:16px;color:#9b3f3f">Lỗi tải lịch sử: ${err.message}</div>`;
        });
}

document.getElementById('btnOrder').addEventListener('click', () => {
    document.getElementById('orderMessage').innerHTML = '';
    document.getElementById('orderForm').reset();
    loadCustomerNameSuggestions();
    orderModal.style.display = 'flex';
});

document.getElementById('btnList').addEventListener('click', loadOrders);

document.getElementById('closeOrder').addEventListener('click', () => {
    orderModal.style.display = 'none';
});

document.getElementById('closeList').addEventListener('click', () => {
    listModal.style.display = 'none';
});

document.getElementById('cancelOrder').addEventListener('click', () => {
    orderModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === orderModal) {
        orderModal.style.display = 'none';
    }
    if (e.target === listModal) {
        listModal.style.display = 'none';
    }
    if (e.target === paymentModal) {
        paymentModal.style.display = 'none';
    }
    if (e.target === paymentDetailModal) {
        paymentDetailModal.style.display = 'none';
    }
    if (e.target === paymentQrModal) {
        paymentQrModal.style.display = 'none';
    }
    if (e.target === paymentHistoryModal) {
        paymentHistoryModal.style.display = 'none';
    }
});

// Load today info
function loadTodayInfo() {
    fetch(`${API_BASE}/api/today`)
        .then(res => res.json())
        .then(data => {
            console.log('API Data:', data); // Debug log
            
            // Update menu items - menu should now be an object from the API
            let menuObj = {};
            
            if (typeof data.menu === 'object' && data.menu !== null) {
                // Menu is already an object
                menuObj = data.menu;
            } else if (typeof data.menu === 'string') {
                // Try to parse if it's a string
                try {
                    menuObj = JSON.parse(data.menu);
                } catch (e) {
                    // If it's not JSON, try to parse as formatted string
                    menuObj = parseMenu(data.menu);
                }
            }
            
            console.log('Menu Object:', menuObj); // Debug log
            
            // Update menu display
            updateMenuDisplay(menuObj);
            
            document.getElementById('remainingCount').textContent = data.remaining;
            document.getElementById('orderedCount').textContent = data.ordered;

            // Update button state
            const orderBtn = document.getElementById('btnOrder');
            if (data.remaining <= 0) {
                orderBtn.disabled = true;
                orderBtn.classList.add('disabled');
                orderBtn.textContent = '❌ Hết xuất';
                document.getElementById('mobileBtnOrder').disabled = true;
            } else {
                orderBtn.disabled = false;
                orderBtn.classList.remove('disabled');
                orderBtn.textContent = 'ĐẶT CƠM';
                document.getElementById('mobileBtnOrder').disabled = false;
            }

            // Update max quantity
            const quantityInput = document.getElementById('quantity');
            quantityInput.max = Math.max(1, data.remaining);
        })
        .catch(err => console.error('Lỗi:', err));
}

// Parse menu string to object
function parseMenu(menuString) {
    const result = { monChinh: '', monPhu: '', rau: '', canh: '', alternatives: '' };
    
    if (!menuString) return result;
    
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
        } else if (part.includes('Thay thế')) {
            result.alternatives = part.replace(/.*Thay thế\s*:?\s*/, '').trim();
        }
    });
    
    return result;
}

// Update menu display on homepage
function updateMenuDisplay(menuObj) {
    // Ensure we have valid menu object
    if (!menuObj || typeof menuObj !== 'object') {
        console.warn('Invalid menu object:', menuObj);
        return;
    }

    const menuItems = document.querySelectorAll('.menu-item');
    
    // Update each menu item
    if (menuObj.monChinh && menuItems[0]) {
        menuItems[0].querySelector('.menu-value').textContent = menuObj.monChinh;
    }
    if (menuObj.monPhu && menuItems[1]) {
        menuItems[1].querySelector('.menu-value').textContent = menuObj.monPhu;
    }
    if (menuObj.rau && menuItems[2]) {
        menuItems[2].querySelector('.menu-value').textContent = menuObj.rau;
    }
    if (menuObj.canh && menuItems[3]) {
        menuItems[3].querySelector('.menu-value').textContent = menuObj.canh;
    }
    
    // Update alternatives
    if (menuObj.alternatives) {
        const alternativesText = menuObj.alternatives;
        const altItems = alternativesText.split('+').map(item => item.trim());
        const alternativesDiv = document.querySelector('.alternatives');
        
        if (alternativesDiv) {
            alternativesDiv.innerHTML = altItems.map(item => 
                `<span class="alt-item">${item}</span>`
            ).join('');
        }
    }
}

// Load orders list
function loadOrders() {
    AppUtils.fetchJson(`${API_BASE}/api/orders/today`)
        .then(orders => {
            const ordersList = document.getElementById('ordersList');
            if (orders.length === 0) {
                ordersList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Chưa có đơn hàng</div>';
            } else {
                ordersList.innerHTML = orders.map((order, index) => {
                    return `
                        <div class="order-item">
                            <div class="order-info">
                                <h4>${orders.length - index}. ${order.name} đã đặt ${order.quantity} xuất</h4>
                                ${order.description ? `<p><strong>Ghi chú:</strong> ${order.description}</p>` : ''}
                                <p class="order-time">${AppUtils.formatDateTime(order.created_at)}</p>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            listModal.style.display = 'flex';
        })
        .catch(err => console.error('Lỗi:', err));
}

// Submit order
document.getElementById('orderForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const name = AppUtils.normalizeName(document.getElementById('customerName').value);
    const quantity = parseInt(document.getElementById('quantity').value);
    const description = document.getElementById('description').value.trim();

    if (!name) {
        showOrderMessage('Vui lòng nhập tên', 'error');
        return;
    }

    AppUtils.fetchJson(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, quantity, description })
    })
    .then(data => {
        if (data.error) {
            showOrderMessage(data.error, 'error');
        } else {
            showOrderMessage('Đặt cơm thành công! 🎉', 'success');
            setTimeout(() => {
                orderModal.style.display = 'none';
                loadTodayInfo();
            }, 1500);
        }
    })
    .catch(err => showOrderMessage('Lỗi: ' + err.message, 'error'));
});

function showOrderMessage(message, type) {
    const messageDiv = document.getElementById('orderMessage');
    const className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.innerHTML = `<div class="${className}">${message}</div>`;
}

// Load on page load
handlePaymentReturn();
loadTodayInfo();
togglePaymentHistoryInputs();
loadCustomerNameSuggestions();
setInterval(loadTodayInfo, 5000); // Refresh every 5 seconds