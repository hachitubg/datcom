const SITE_BASE_PATH = (() => {
    const firstSegment = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const rootPaths = new Set(['admin', 'admin2', 'admin-login', 'admin.html', 'api', 'assets', 'images', 'game.html']);
    return firstSegment && !rootPaths.has(firstSegment) ? `/${firstSegment}` : '';
})();
const API_BASE = `${window.location.origin}${SITE_BASE_PATH}`;

// =============================================
// User Auth
// =============================================
let currentUser = null;
const escapeHtml = AppUtils.escapeHtml;
const escapeAttr = AppUtils.escapeAttribute;
let consecutivePromoStatus = null;
let promoWalletStatus = null;
let orderCutoffState = {
    cutoffTime: '10:45',
    isOrderClosed: false
};
let shopClosedState = {
    isClosed: false,
    reason: 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.'
};
const STREAK_INTRO_STORAGE_KEY = 'datcom_streak_intro_dismissed_v1';

function checkUserAuth() {
    return fetch(`${API_BASE}/api/auth/me`)
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn && data.user) {
                currentUser = data.user;
                document.getElementById('userAuthLoggedOut').style.display = 'none';
                document.getElementById('userAuthLoggedIn').style.display = 'flex';
                document.getElementById('userAuthName').textContent = data.user.name;
            } else {
                currentUser = null;
                document.getElementById('userAuthLoggedOut').style.display = 'flex';
                document.getElementById('userAuthLoggedIn').style.display = 'none';
            }
            updatePromoAccess();
            loadConsecutivePromoStatus({ maybeShowIntro: true });
            loadPromoWalletSummary();
        })
        .catch(() => {
            currentUser = null;
            updatePromoAccess();
            loadConsecutivePromoStatus({ maybeShowIntro: true });
            updatePromoWalletButton(null);
        });
}

function updatePromoAccess() {
    const promoGroup = document.getElementById('promoGroup');
    if (!promoGroup) return;
    if (currentUser) {
        promoGroup.classList.remove('promo-group-disabled');
        const hint = promoGroup.querySelector('.promo-login-hint');
        if (hint) hint.remove();
    } else {
        promoGroup.classList.add('promo-group-disabled');
        if (!promoGroup.querySelector('.promo-login-hint')) {
            const hint = document.createElement('div');
            hint.className = 'promo-login-hint';
            hint.textContent = 'Đăng nhập để sử dụng mã khuyến mãi';
            promoGroup.appendChild(hint);
        }
    }
}

const authModal = document.getElementById('authModal');
const editNameModal = document.getElementById('editNameModal');

document.getElementById('btnShowLogin').addEventListener('click', () => {
    document.getElementById('authMessage').innerHTML = '';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('authModalTitle').textContent = 'Đăng nhập';
    authModal.style.display = 'flex';
});

document.getElementById('closeAuth').addEventListener('click', () => {
    authModal.style.display = 'none';
});

document.getElementById('btnSwitchToRegister').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('authMessage').innerHTML = '';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('authModalTitle').textContent = 'Đăng ký';
});

document.getElementById('btnSwitchToLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('authMessage').innerHTML = '';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('authModalTitle').textContent = 'Đăng nhập';
});

document.getElementById('btnLogin').addEventListener('click', () => {
    const phone = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!phone || !password) {
        document.getElementById('authMessage').innerHTML = '<div class="error-message">Vui lòng nhập đầy đủ thông tin</div>';
        return;
    }
    fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
    })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Đăng nhập thất bại');
        authModal.style.display = 'none';
        checkUserAuth();
    })
    .catch(err => {
        document.getElementById('authMessage').innerHTML = `<div class="error-message">${err.message}</div>`;
    });
});

document.getElementById('btnRegister').addEventListener('click', () => {
    const phone = document.getElementById('regPhone').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value;
    if (!phone || !name || !password) {
        document.getElementById('authMessage').innerHTML = '<div class="error-message">Vui lòng nhập đầy đủ thông tin</div>';
        return;
    }
    fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name, password })
    })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Đăng ký thất bại');
        authModal.style.display = 'none';
        checkUserAuth();
    })
    .catch(err => {
        document.getElementById('authMessage').innerHTML = `<div class="error-message">${err.message}</div>`;
    });
});

document.getElementById('btnUserLogout').addEventListener('click', () => {
    fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' })
        .finally(() => {
            currentUser = null;
            document.getElementById('userMenuDropdown').classList.remove('show');
            document.getElementById('userAuthLoggedOut').style.display = 'flex';
            document.getElementById('userAuthLoggedIn').style.display = 'none';
            updatePromoAccess();
            loadConsecutivePromoStatus();
            updatePromoWalletButton(null);
        });
});

document.getElementById('btnUserMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('userMenuDropdown').classList.toggle('show');
});

document.getElementById('btnEditUserName').addEventListener('click', () => {
    document.getElementById('userMenuDropdown').classList.remove('show');
    document.getElementById('editNameMessage').innerHTML = '';
    document.getElementById('editUserNameInput').value = currentUser?.name || '';
    editNameModal.style.display = 'flex';
    setTimeout(() => document.getElementById('editUserNameInput').focus(), 0);
});

document.getElementById('closeEditName').addEventListener('click', () => {
    editNameModal.style.display = 'none';
});

document.getElementById('btnSaveUserName').addEventListener('click', () => {
    const name = document.getElementById('editUserNameInput').value.trim();
    const messageEl = document.getElementById('editNameMessage');
    if (!name) {
        messageEl.innerHTML = '<div class="error-message">Vui lòng nhập họ và tên</div>';
        return;
    }

    fetch(`${API_BASE}/api/auth/me/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Không thể cập nhật tên');
        currentUser = data.user;
        document.getElementById('userAuthName').textContent = data.user.name;
        const customerNameInput = document.getElementById('customerName');
        if (customerNameInput && customerNameInput.value.trim()) {
            customerNameInput.value = data.user.name;
        }
        editNameModal.style.display = 'none';
        loadPromoWalletSummary();
    })
    .catch(err => {
        messageEl.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
    });
});

// Auth help tooltip
document.getElementById('btnAuthHelp').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('authHelpTooltip').classList.toggle('show');
});
document.addEventListener('click', () => {
    document.getElementById('authHelpTooltip').classList.remove('show');
    document.getElementById('userMenuDropdown').classList.remove('show');
});

// Modal controls
const orderModal = document.getElementById('orderModal');
const listModal = document.getElementById('listModal');

const paymentModal = document.getElementById('paymentModal');
const paymentDetailModal = document.getElementById('paymentDetailModal');
const paymentQrModal = document.getElementById('paymentQrModal');
const paymentHistoryModal = document.getElementById('paymentHistoryModal');
const feedbackModal = document.getElementById('feedbackModal');
const streakIntroModal = document.getElementById('streakIntroModal');
const streakStatusModal = document.getElementById('streakStatusModal');
const promoWalletModal = document.getElementById('promoWalletModal');

const customerNameInput = document.getElementById('customerName');
const feedbackContentInput = document.getElementById('feedbackContent');

document.getElementById('btnPayment').addEventListener('click', () => {
    if (currentUser && currentUser.name) {
        document.getElementById('paymentSearch').value = currentUser.name;
    }
    paymentModal.style.display = 'flex';
    loadPaymentList();
});

document.getElementById('mobileBtnOrder').addEventListener('click', () => {
    const orderBtn = document.getElementById('btnOrder');
    if (orderBtn.disabled) {
        showPopup(getOrderUnavailableMessage());
        return;
    }
    orderBtn.click();
});

document.getElementById('mobileBtnPayment').addEventListener('click', () => {
    document.getElementById('btnPayment').click();
});

document.getElementById('mobileBtnList').addEventListener('click', () => {
    document.getElementById('btnList').click();
});

document.getElementById('btnFeedback').addEventListener('click', openFeedbackModal);
document.getElementById('mobileBtnFeedback').addEventListener('click', openFeedbackModal);

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

document.getElementById('closeFeedback').addEventListener('click', closeFeedbackModal);
document.getElementById('cancelFeedback').addEventListener('click', closeFeedbackModal);
document.getElementById('btnStreakStatus').addEventListener('click', openStreakStatusModal);
document.getElementById('closeStreakStatus').addEventListener('click', () => {
    streakStatusModal.style.display = 'none';
});
document.getElementById('btnPromoWallet').addEventListener('click', openPromoWalletModal);
document.getElementById('closePromoWallet').addEventListener('click', () => {
    promoWalletModal.style.display = 'none';
});
document.getElementById('closeStreakIntro').addEventListener('click', closeStreakIntroModal);
document.getElementById('btnStreakIntroOk').addEventListener('click', closeStreakIntroModal);
document.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.promo-wallet-copy');
    if (!copyBtn) return;

    const code = copyBtn.dataset.code || '';
    try {
        await navigator.clipboard.writeText(code);
        showPopup('Đã sao chép mã khuyến mãi');
    } catch {
        showPopup(`Mã của bạn: ${code}`);
    }
});

document.getElementById('btnSearchPayment').addEventListener('click', loadPaymentList);
document.getElementById('paymentSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        loadPaymentList();
    }
});

document.getElementById('btnPaymentHistory').addEventListener('click', () => {
    if (currentUser && currentUser.name && !document.getElementById('historyNameSearch').value.trim()) {
        document.getElementById('historyNameSearch').value = currentUser.name;
    }
    loadPaymentHistory();
});
document.getElementById('historyPeriodFilter').addEventListener('change', togglePaymentHistoryInputs);
document.getElementById('btnApplyHistoryFilter').addEventListener('click', loadPaymentHistory);
document.getElementById('btnResetHistoryFilter').addEventListener('click', resetPaymentHistoryFilter);

feedbackContentInput.addEventListener('input', updateFeedbackCounter);

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
        showPopup('Bạn đã hủy thanh toán. Nếu cần, vui lòng quét lại mã QR để thanh toán.');
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
            showPopup('Thanh toán thành công! Hệ thống đã cập nhật trạng thái đơn hàng.');
        } else {
            showPopup('Đã nhận trạng thái thanh toán, hệ thống đang chờ xác nhận cuối cùng từ PayOS.');
        }
    } catch (error) {
        showPopup(`Thanh toán đã hoàn tất nhưng chưa cập nhật tự động: ${error.message}. Vui lòng liên hệ quản trị để kiểm tra.`);
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
                .map(name => `<option value="${escapeAttr(name)}"></option>`)
                .join('');
        })
        .catch(() => {
            // Không block luồng đặt cơm nếu API gợi ý lỗi.
        });
}

function openFeedbackModal() {
    document.getElementById('feedbackMessage').innerHTML = '';
    document.getElementById('feedbackForm').reset();
    updateFeedbackCounter();
    feedbackModal.style.display = 'flex';
    feedbackContentInput.focus();
}

function closeFeedbackModal() {
    feedbackModal.style.display = 'none';
}

function updateFeedbackCounter() {
    const currentLength = (feedbackContentInput.value || '').length;
    document.getElementById('feedbackCounter').textContent = `${currentLength} / 2000`;
}

document.getElementById('feedbackForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const message = (feedbackContentInput.value || '').trim();
    const messageBox = document.getElementById('feedbackMessage');

    if (!message) {
        messageBox.innerHTML = '<div class="error-message">Vui lòng nhập nội dung góp ý trước khi gửi.</div>';
        return;
    }

    try {
        await AppUtils.fetchJson(`${API_BASE}/api/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        messageBox.innerHTML = '<div class="success-message">Cảm ơn bạn. Góp ý đã được gửi ẩn danh thành công.</div>';
        document.getElementById('feedbackForm').reset();
        updateFeedbackCounter();
        setTimeout(() => {
            closeFeedbackModal();
        }, 1200);
    } catch (error) {
        messageBox.innerHTML = `<div class="error-message">${error.message}</div>`;
    }
});

function shouldShowStreakIntro(status) {
    if (!status || !status.enabled) return false;
    return localStorage.getItem(STREAK_INTRO_STORAGE_KEY) !== '1';
}

function closeStreakIntroModal() {
    if (document.getElementById('streakIntroDontShow').checked) {
        localStorage.setItem(STREAK_INTRO_STORAGE_KEY, '1');
    }
    streakIntroModal.style.display = 'none';
}

function updateStreakIntroCopy(status) {
    const requiredDays = Number(status?.requiredDays || 5);
    const discount = Number(status?.discountPercent || 0);
    const text = discount > 0
        ? `Đăng nhập và đặt cơm ${requiredDays} ngày bán liên tục để nhận mã giảm ${discount}% cho 1 suất.`
        : `Đăng nhập và đặt cơm ${requiredDays} ngày bán liên tục để nhận mã giảm giá.`;
    document.getElementById('streakIntroText').textContent = text;
}

function updateStreakButton(status) {
    const btn = document.getElementById('btnStreakStatus');
    if (!btn) return;

    const shouldShow = Boolean(status && status.enabled && status.loggedIn);
    btn.style.display = shouldShow ? 'inline-flex' : 'none';
    if (shouldShow) {
        btn.title = `Chuỗi đặt cơm: ${status.currentDays || 0}/${status.requiredDays || 0} ngày`;
    }
}

function updatePromoWalletButton(status) {
    const btn = document.getElementById('btnPromoWallet');
    const badge = document.getElementById('promoWalletBadge');
    if (!btn || !badge) return;

    const shouldShow = Boolean(currentUser);
    btn.style.display = shouldShow ? 'inline-flex' : 'none';

    const unseenCount = Number(status?.unseenCount || 0);
    if (shouldShow && unseenCount > 0) {
        badge.textContent = unseenCount > 9 ? '9+' : String(unseenCount);
        badge.style.display = 'inline-flex';
        btn.classList.add('has-new-promo');
    } else {
        badge.style.display = 'none';
        btn.classList.remove('has-new-promo');
    }
}

async function loadPromoWalletSummary() {
    if (!currentUser) {
        promoWalletStatus = null;
        updatePromoWalletButton(null);
        return null;
    }

    try {
        const status = await AppUtils.fetchJson(`${API_BASE}/api/promo-wallet`);
        promoWalletStatus = status;
        updatePromoWalletButton(status);
        return status;
    } catch {
        promoWalletStatus = null;
        updatePromoWalletButton(null);
        return null;
    }
}

function loadConsecutivePromoStatus({ maybeShowIntro = false } = {}) {
    return AppUtils.fetchJson(`${API_BASE}/api/consecutive-promo/status`)
        .then((status) => {
            consecutivePromoStatus = status;
            updateStreakButton(status);

            if (status.enabled && maybeShowIntro) {
                updateStreakIntroCopy(status);
                if (shouldShowStreakIntro(status)) {
                    document.getElementById('streakIntroDontShow').checked = false;
                    streakIntroModal.style.display = 'flex';
                }
            }

            return status;
        })
        .catch(() => {
            consecutivePromoStatus = null;
            updateStreakButton(null);
            return null;
        });
}

function getStreakProgress(status) {
    const requiredDays = Math.max(1, Number(status?.requiredDays || 1));
    const currentDays = Math.max(0, Number(status?.currentDays || 0));
    const cycleDays = currentDays >= requiredDays ? requiredDays : currentDays;
    return Math.min(100, Math.round((cycleDays / requiredDays) * 100));
}

function renderStreakStatus(status) {
    const container = document.getElementById('streakStatusContent');
    if (!status || !status.enabled) {
        container.innerHTML = '<div class="leaderboard-empty">Tính năng đang tắt.</div>';
        return;
    }

    if (!status.loggedIn) {
        container.innerHTML = `
            <div class="streak-empty-state">
                <div class="streak-empty-icon">🔐</div>
                <h3>Cần đăng nhập</h3>
                <p>Chuỗi ngày chỉ được tính cho các đơn đặt khi tài khoản đang đăng nhập.</p>
                <button type="button" class="btn-submit" id="btnOpenLoginFromStreak">ĐĂNG NHẬP</button>
            </div>
        `;
        document.getElementById('btnOpenLoginFromStreak').addEventListener('click', () => {
            streakStatusModal.style.display = 'none';
            document.getElementById('btnShowLogin').click();
        });
        return;
    }

    const requiredDays = Number(status.requiredDays || 5);
    const currentDays = Number(status.currentDays || 0);
    const remainingDays = Number(status.remainingDays || 0);
    const percent = getStreakProgress(status);

    const nextText = remainingDays <= 0
        ? 'Bạn đã đạt mốc nhận mã trong chu kỳ hiện tại.'
        : `Còn ${remainingDays} ngày bán nữa để chạm mốc tiếp theo.`;

    container.innerHTML = `
        <div class="streak-status-panel">
            <div class="streak-status-top">
                <div>
                    <span class="streak-kicker">Tiến độ hiện tại</span>
                    <h3>${currentDays} / ${requiredDays} ngày</h3>
                    <p>${escapeHtml(nextText)}</p>
                </div>
                <div class="streak-ring" style="--streak-pct:${percent}%">
                    <span>${percent}%</span>
                </div>
            </div>
            <div class="streak-progress-track">
                <div class="streak-progress-fill" style="width:${percent}%"></div>
            </div>
            <div class="streak-status-note">Thứ 7 và Chủ nhật được bỏ qua trong chuỗi ngày bán.</div>
        </div>
    `;
}

async function openStreakStatusModal() {
    streakStatusModal.style.display = 'flex';
    document.getElementById('streakStatusContent').innerHTML = '<div class="loading-text">Đang tải...</div>';
    const status = await loadConsecutivePromoStatus();
    renderStreakStatus(status);
}

function getPromoWalletNote(code) {
    if (code.source === 'admin_gift') {
        return `Mã quà tặng được nhận ngày ${AppUtils.formatDateTime(code.createdAt)}`;
    }
    if (code.source === 'auto_consecutive') {
        const streakText = Number(code.earnedStreakDays || 0) > 0
            ? ` · Mốc ${Number(code.earnedStreakDays)} ngày`
            : '';
        return `Mã chương trình đặt liên tục${streakText}`;
    }
    return `Mã khuyến mãi được tạo ngày ${AppUtils.formatDateTime(code.createdAt)}`;
}

function renderPromoWallet(status) {
    const container = document.getElementById('promoWalletContent');
    const codes = Array.isArray(status?.codes) ? status.codes : [];

    if (!currentUser) {
        container.innerHTML = `
            <div class="streak-empty-state">
                <div class="streak-empty-icon">🔐</div>
                <h3>Cần đăng nhập</h3>
                <p>Đăng nhập để xem các mã khuyến mãi đã nhận.</p>
            </div>
        `;
        return;
    }

    if (!codes.length) {
        container.innerHTML = '<div class="promo-wallet-empty">Bạn chưa có mã khuyến mãi nào.</div>';
        return;
    }

    container.innerHTML = `
        <div class="promo-wallet-list">
            ${codes.map((code) => {
                const used = Boolean(code.used);
                const statusLabel = used ? 'Đã sử dụng' : 'Chưa sử dụng';
                const statusClass = used ? 'promo-wallet-status-used' : 'promo-wallet-status-ready';
                return `
                    <div class="promo-wallet-row ${!code.seen && code.source === 'admin_gift' ? 'promo-wallet-row-new' : ''}">
                        <div class="promo-wallet-main">
                            <div class="promo-wallet-code">${escapeHtml(code.code)}</div>
                            <div class="promo-wallet-meta">Giảm ${Number(code.discountPercent || 0)}% cho 1 suất</div>
                            <div class="promo-wallet-note">${escapeHtml(getPromoWalletNote(code))}</div>
                            ${used ? `<div class="promo-wallet-meta">Dùng lúc: ${AppUtils.formatDateTime(code.usedAt)}</div>` : ''}
                        </div>
                        <div class="promo-wallet-actions">
                            <span class="promo-wallet-status ${statusClass}">${statusLabel}</span>
                            ${!used ? `<button type="button" class="promo-wallet-copy" data-code="${escapeAttr(code.code)}">Sao chép</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

async function openPromoWalletModal() {
    promoWalletModal.style.display = 'flex';
    document.getElementById('promoWalletContent').innerHTML = '<div class="loading-text">Đang tải...</div>';
    const status = await loadPromoWalletSummary();
    renderPromoWallet(status);

    if (status && Number(status.unseenCount || 0) > 0) {
        try {
            await AppUtils.fetchJson(`${API_BASE}/api/promo-wallet/mark-seen`, { method: 'POST' });
            promoWalletStatus = {
                ...status,
                unseenCount: 0,
                codes: (status.codes || []).map((code) => ({ ...code, seen: true }))
            };
            updatePromoWalletButton(promoWalletStatus);
        } catch {
            // Không chặn người dùng xem mã nếu thao tác đánh dấu đã xem lỗi.
        }
    }
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
                        <h4>${escapeHtml(row.name)} - ${row.quantity} suất</h4>
                        <p><strong>Còn phải thanh toán:</strong> ${AppUtils.formatCurrency(row.remainingAmount)}</p>
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
                container.innerHTML = '<div style="padding: 16px">Không có suất chưa thanh toán.</div>';
                return;
            }

            let html = `
                <div class="payment-detail-header">
                    <strong>${escapeHtml(data.name)}</strong>
                    <span>Tổng ${data.totalQuantity} suất • ${AppUtils.formatCurrency(data.totalAmount)}</span>
                </div>
                <div class="payment-detail-list">
            `;

            rows.forEach((row, index) => {
                const disc = Number(row.discount_percent || 0);
                const discBadge = disc > 0 ? `<span class="discount-badge">-${disc}% / 1 suất</span>` : '';
                const promoInfo = row.promo_code ? `<p class="promo-info-text">Mã KM: ${escapeHtml(row.promo_code)} (giảm ${disc}% cho 1 suất)</p>` : '';
                const originalQuantity = Number(row.originalQuantity || row.quantity || 0);
                const quantityNote = originalQuantity > Number(row.quantity || 0)
                    ? ` <span class="payment-partial-note">(đơn gốc ${originalQuantity} suất)</span>`
                    : '';
                html += `
                    <div class="order-item payment-detail-item ${disc > 0 ? 'order-item-discounted' : ''}">
                        <div class="order-info">
                            <h4>Còn nợ ${row.quantity} suất từ đơn ngày ${formatDateTime(row.createdAt)}${quantityNote} ${discBadge}</h4>
                            <h4>Còn phải thanh toán ${AppUtils.formatCurrency(row.amount)}</h4>
                            ${row.description ? `<p><strong>Ghi chú:</strong> ${escapeHtml(row.description)}</p>` : ''}
                            ${promoInfo}
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
            showPopup('Không xác định được tên người đặt cơm. Vui lòng tải lại danh sách.');
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
        showPopup('Không xác định được tên người đặt cơm. Vui lòng tải lại danh sách.');
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
        showPopup(`Lỗi tạo thanh toán: ${err.message}`);
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
                            <span class="history-simple-name">${escapeHtml(row.customer_name)}</span>
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

// =============================================
// Promo Code Check
// =============================================
document.getElementById('btnCheckPromo').addEventListener('click', () => {
    const code = document.getElementById('promoCode').value.trim();
    const msg = document.getElementById('promoMessage');
    if (!currentUser) {
        msg.innerHTML = '<span class="promo-invalid">Vui lòng đăng nhập để sử dụng mã khuyến mãi</span>';
        return;
    }
    if (!code) { msg.innerHTML = ''; return; }

    fetch(`${API_BASE}/api/promo-codes/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    })
    .then(res => res.json())
    .then(data => {
        if (data.valid) {
            msg.innerHTML = `<span class="promo-valid">Mã hợp lệ — Giảm ${data.discountPercent}%</span>`;
        } else {
            msg.innerHTML = `<span class="promo-invalid">Mã không hợp lệ hoặc đã được sử dụng</span>`;
        }
    })
    .catch(() => {
        msg.innerHTML = `<span class="promo-invalid">Lỗi kiểm tra mã</span>`;
    });
});

document.getElementById('btnOrder').addEventListener('click', () => {
    if (document.getElementById('btnOrder').disabled) {
        showPopup(getOrderUnavailableMessage());
        return;
    }
    document.getElementById('orderMessage').innerHTML = '';
    document.getElementById('orderForm').reset();
    document.getElementById('promoMessage').innerHTML = '';
    loadCustomerNameSuggestions();
    updatePromoAccess();
    // Auto-fill name if logged in
    if (currentUser && currentUser.name) {
        document.getElementById('customerName').value = currentUser.name;
    }
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
    if (e.target === feedbackModal) {
        feedbackModal.style.display = 'none';
    }
    if (e.target === authModal) {
        authModal.style.display = 'none';
    }
    if (e.target === editNameModal) {
        editNameModal.style.display = 'none';
    }
    if (e.target === streakIntroModal) {
        closeStreakIntroModal();
    }
    if (e.target === streakStatusModal) {
        streakStatusModal.style.display = 'none';
    }
    if (e.target === promoWalletModal) {
        promoWalletModal.style.display = 'none';
    }
    if (e.target === leaderboardModal) {
        leaderboardModal.style.display = 'none';
    }
});

function normalizeOrderCutoffState(data) {
    const cutoff = data.orderCutoff || {};
    const cutoffTime = data.orderCutoffTime || cutoff.cutoffTime || '10:45';
    return {
        cutoffTime,
        isOrderClosed: Boolean(cutoff.isOrderClosed)
    };
}

function normalizeShopClosedState(data) {
    const shopClosed = data.shopClosed || {};
    return {
        isClosed: Boolean(shopClosed.isClosed),
        reason: String(shopClosed.reason || '').trim() || 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.'
    };
}

function renderShopClosedNotice() {
    const panel = document.getElementById('shopClosedPanel');
    const reasonEl = document.getElementById('shopClosedReason');
    if (!panel || !reasonEl) return;

    panel.style.display = shopClosedState.isClosed ? 'flex' : 'none';
    reasonEl.textContent = shopClosedState.reason;
}

function getOrderUnavailableMessage() {
    if (shopClosedState.isClosed) {
        return `Hôm nay quán tạm đóng cửa. ${shopClosedState.reason}`;
    }
    if (orderCutoffState.isOrderClosed) {
        return 'Đã quá giờ đặt cơm, nếu muốn đặt thêm vui lòng liên hệ admin. Cảm ơn bạn ^^';
    }
    return 'Hiện tại chưa thể đặt cơm.';
}

function renderOrderCutoff() {
    const cutoffInfoEl = document.getElementById('orderCutoffInfo');
    if (!cutoffInfoEl) return;

    if (shopClosedState.isClosed) {
        cutoffInfoEl.classList.add('cutoff-closed');
        cutoffInfoEl.textContent = 'Hôm nay quán tạm đóng cửa, chưa nhận đơn mới.';
        return;
    }

    cutoffInfoEl.classList.toggle('cutoff-closed', orderCutoffState.isOrderClosed);
    if (orderCutoffState.isOrderClosed) {
        cutoffInfoEl.textContent = 'Đã quá giờ đặt cơm, nếu muốn đặt thêm vui lòng liên hệ admin. Cảm ơn bạn ^^';
        return;
    }

    cutoffInfoEl.innerHTML = `Thời gian cuối cùng nhận đơn là <strong id="orderCutoffTimeLabel">${orderCutoffState.cutoffTime || '10:45'}</strong>`;
}

function applyOrderButtonState(data) {
    const orderBtn = document.getElementById('btnOrder');
    const mobileOrderBtn = document.getElementById('mobileBtnOrder');
    const mobileText = mobileOrderBtn ? mobileOrderBtn.querySelector('.mobile-btn-text') : null;
    const remaining = Number(data.remaining || 0);

    if (shopClosedState.isClosed) {
        orderBtn.disabled = true;
        orderBtn.classList.add('disabled');
        orderBtn.innerHTML = '<span class="btn-icon">🍱</span><span>TẠM ĐÓNG</span>';
        if (mobileOrderBtn) mobileOrderBtn.disabled = true;
        if (mobileText) mobileText.textContent = 'Tạm đóng';
        return;
    }

    if (orderCutoffState.isOrderClosed) {
        orderBtn.disabled = true;
        orderBtn.classList.add('disabled');
        orderBtn.innerHTML = '<span class="btn-icon">⏰</span><span>ĐÃ CHỐT</span>';
        if (mobileOrderBtn) mobileOrderBtn.disabled = true;
        if (mobileText) mobileText.textContent = 'Đã chốt';
        return;
    }

    if (remaining <= 0) {
        orderBtn.disabled = true;
        orderBtn.classList.add('disabled');
        orderBtn.innerHTML = '<span class="btn-icon">❌</span><span>HẾT SUẤT</span>';
        if (mobileOrderBtn) mobileOrderBtn.disabled = true;
        if (mobileText) mobileText.textContent = 'Hết suất';
        return;
    }

    orderBtn.disabled = false;
    orderBtn.classList.remove('disabled');
    orderBtn.innerHTML = '<span class="btn-icon">🍚</span><span>ĐẶT CƠM</span>';
    if (mobileOrderBtn) mobileOrderBtn.disabled = false;
    if (mobileText) mobileText.textContent = 'Đặt cơm';
}

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
            orderCutoffState = normalizeOrderCutoffState(data);
            shopClosedState = normalizeShopClosedState(data);
            renderShopClosedNotice();
            renderOrderCutoff();

            applyOrderButtonState(data);

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
                `<span class="alt-item">${escapeHtml(item)}</span>`
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
                    const disc = Number(order.discount_percent || 0);
                    const discBadge = disc > 0 ? `<span class="discount-badge">-${disc}% / 1 suất</span>` : '';
                    const isOwner = currentUser && order.user_id === currentUser.id;
                    const createdAt = new Date(order.created_at + 'Z');
                    const diffMin = (Date.now() - createdAt.getTime()) / 60000;
                    const canModify = isOwner && diffMin <= 30;
                    return `
                        <div class="order-item ${disc > 0 ? 'order-item-discounted' : ''}">
                            <div class="order-info">
                                <h4>${orders.length - index}. ${escapeHtml(order.name)} đã đặt ${order.quantity} suất ${discBadge}</h4>
                                ${order.description ? `<p><strong>Ghi chú:</strong> ${escapeHtml(order.description)}</p>` : ''}
                                <p class="order-time">${AppUtils.formatDateTime(order.created_at)}</p>
                                ${isOwner ? `
                                    <div class="order-actions">
                                        ${canModify
                                            ? `<button class="btn-edit-order" data-id="${order.id}" data-quantity="${order.quantity}" data-description="${escapeAttr(order.description || '')}">Sửa</button>`
                                            : `<button class="btn-edit-order" disabled title="Quá 30 phút, liên hệ admin để sửa">Sửa</button>`
                                        }
                                        ${canModify
                                            ? `<button class="btn-delete-order" data-id="${order.id}">Xóa</button>`
                                            : `<button class="btn-delete-order" disabled title="Quá 30 phút, liên hệ admin để xóa">Xóa</button>`
                                        }
                                    </div>
                                ` : ''}
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
    const promoCode = document.getElementById('promoCode').value.trim() || null;

    if (!name) {
        showOrderMessage('Vui lòng nhập tên', 'error');
        return;
    }

    AppUtils.fetchJson(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, quantity, description, promoCode })
    })
    .then(data => {
        if (data.error) {
            showOrderMessage(data.error, 'error');
        } else {
            showOrderMessage('Đặt cơm thành công! 🎉', 'success');
            setTimeout(() => {
                orderModal.style.display = 'none';
                loadTodayInfo();
                loadConsecutivePromoStatus();
                loadPromoWalletSummary();
                // Hiển thị thông báo tặng mã KM nếu có
                if (data.bonus_promo) {
                    showPopup(data.bonus_promo.message);
                }
            }, 1500);
        }
    })
    .catch(err => showOrderMessage('Lỗi: ' + err.message, 'error'));
});

function showOrderMessage(message, type) {
    const messageDiv = document.getElementById('orderMessage');
    const className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
}

// Edit/Delete order handlers
document.getElementById('ordersList').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.btn-delete-order');
    if (deleteBtn && !deleteBtn.disabled) {
        const orderId = deleteBtn.dataset.id;
        const confirmed = await showPopup('Bạn có chắc muốn xóa đơn này?', { type: 'confirm', confirmLabel: 'Xóa', danger: true });
        if (!confirmed) return;
        try {
            const res = await fetch(`${API_BASE}/api/orders/${orderId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.error) {
                showPopup(data.error);
            } else {
                loadOrders();
                loadTodayInfo();
            }
        } catch (err) {
            showPopup('Lỗi: ' + err.message);
        }
        return;
    }

    if (deleteBtn && deleteBtn.disabled) {
        showPopup('Đã quá 30 phút, vui lòng liên hệ admin để xóa đơn này.');
        return;
    }

    const editBtn = e.target.closest('.btn-edit-order');
    if (editBtn && editBtn.disabled) {
        showPopup('Đã quá 30 phút, vui lòng liên hệ admin để chỉnh sửa đơn này.');
        return;
    }

    if (editBtn && !editBtn.disabled) {
        const orderId = editBtn.dataset.id;
        const oldQty = editBtn.dataset.quantity;
        const oldDesc = editBtn.dataset.description;

        const result = await showPopup('Chỉnh sửa đơn hàng', {
            type: 'prompt',
            confirmLabel: 'Lưu',
            fields: [
                { name: 'quantity', label: 'Số lượng suất', value: oldQty, inputType: 'number', placeholder: 'Nhập số lượng' },
                { name: 'description', label: 'Ghi chú', value: oldDesc, type: 'textarea', placeholder: 'Ví dụ: Ít mặn, thêm rau...' }
            ]
        });

        if (!result) return;
        const qty = parseInt(result.quantity);
        if (!qty || qty <= 0) { showPopup('Số lượng không hợp lệ'); return; }

        try {
            const res = await fetch(`${API_BASE}/api/orders/${orderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity: qty, description: result.description })
            });
            const data = await res.json();
            if (data.error) {
                showPopup(data.error);
            } else {
                loadOrders();
                loadTodayInfo();
            }
        } catch (err) {
            showPopup('Lỗi: ' + err.message);
        }
    }
});

// Load on page load
checkUserAuth();
handlePaymentReturn();
loadTodayInfo();
togglePaymentHistoryInputs();
loadCustomerNameSuggestions();
updateFeedbackCounter();
setInterval(loadTodayInfo, 5000); // Refresh every 5 seconds

// =============================================
// Leaderboard
// =============================================
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardContent = document.getElementById('leaderboardContent');
const leaderboardTitle = document.getElementById('leaderboardTitle');
const leaderboardMonthInput = document.getElementById('leaderboardMonth');

const VIETNAMESE_MONTHS = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
];

function formatMonthVi(monthStr) {
    // monthStr e.g. "2026-04"
    const parts = monthStr.split('-');
    if (parts.length !== 2) return monthStr;
    const year = parts[0];
    const month = parseInt(parts[1], 10);
    return `${VIETNAMESE_MONTHS[month - 1]} năm ${year}`;
}

function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getRankClass(rank) {
    if (rank === 1) return 'lb-row--gold';
    if (rank === 2) return 'lb-row--silver';
    if (rank === 3) return 'lb-row--bronze';
    return '';
}

function getRankIcon(rank) {
    if (rank === 1) return '<span class="lb-rank">🥇</span>';
    if (rank === 2) return '<span class="lb-rank">🥈</span>';
    if (rank === 3) return '<span class="lb-rank">🥉</span>';
    return `<span class="lb-rank--num">#${rank}</span>`;
}

function renderLeaderboard(data) {
    const { month, leaders } = data;
    leaderboardTitle.textContent = '🏆 Bảng xếp hạng';

    if (!leaders || leaders.length === 0) {
        leaderboardContent.innerHTML = `
            <p class="leaderboard-month">${escapeHtml(formatMonthVi(month))}</p>
            <div class="leaderboard-empty">Chưa có dữ liệu tháng này</div>`;
        return;
    }

    const rows = leaders.map((item, idx) => {
        const delay = (idx * 60) + 'ms';
        const rowClass = getRankClass(item.rank);
        const rankIcon = getRankIcon(item.rank);
        const safeName = escapeHtml(item.name);
        const pct = item.percentage;
        const daysLabel = item.days === 1 ? '1 ngày' : `${item.days} ngày`;

        return `<div class="lb-row ${rowClass}" style="animation-delay:${delay}">
            ${rankIcon}
            <div class="lb-info">
                <div class="lb-name">${safeName}</div>
                <div class="lb-bar-wrap">
                    <div class="lb-bar" data-pct="${pct}"></div>
                </div>
            </div>
            <div class="lb-days">${escapeHtml(daysLabel)}</div>
        </div>`;
    }).join('');

    leaderboardContent.innerHTML = `
        <p class="leaderboard-month">${escapeHtml(formatMonthVi(month))}</p>
        <div class="leaderboard-list">${rows}</div>`;

    // Animate progress bars after paint
    requestAnimationFrame(() => {
        leaderboardContent.querySelectorAll('.lb-bar').forEach((bar) => {
            const pct = Number(bar.dataset.pct || 0);
            requestAnimationFrame(() => { bar.style.width = pct + '%'; });
        });
    });
}

async function loadLeaderboard(month) {
    leaderboardContent.innerHTML = '<div class="loading-text">Đang tải...</div>';
    try {
        const selectedMonth = month || leaderboardMonthInput.value || getCurrentMonthValue();
        const res = await fetch(`${API_BASE}/api/leaderboard/monthly?month=${encodeURIComponent(selectedMonth)}`);
        const data = await res.json();
        if (data.error) {
            leaderboardContent.innerHTML = `<div class="leaderboard-empty">${escapeHtml(data.error)}</div>`;
        } else {
            leaderboardMonthInput.value = data.month || selectedMonth;
            renderLeaderboard(data);
        }
    } catch (err) {
        leaderboardContent.innerHTML = '<div class="leaderboard-empty">Không thể tải dữ liệu</div>';
    }
}

async function openLeaderboard() {
    if (!leaderboardMonthInput.value) {
        leaderboardMonthInput.value = getCurrentMonthValue();
    }
    leaderboardModal.style.display = 'flex';
    loadLeaderboard(leaderboardMonthInput.value);
}

document.getElementById('btnLeaderboard').addEventListener('click', openLeaderboard);
document.getElementById('closeLeaderboard').addEventListener('click', () => {
    leaderboardModal.style.display = 'none';
});
leaderboardMonthInput.addEventListener('change', () => {
    loadLeaderboard(leaderboardMonthInput.value);
});
