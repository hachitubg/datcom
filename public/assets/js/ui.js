(function initSharedUi() {
    const iconNames = new Set(['trophy', 'gamepad-2', 'flame', 'utensils', 'ticket', 'user-round',
        'log-in', 'log-out', 'pencil', 'clipboard-list', 'credit-card', 'message-square', 'settings',
        'users', 'chef-hat', 'gift', 'house', 'circle-help', 'calendar-days', 'history', 'circle-pause',
        'leaf', 'soup', 'beef', 'chevron-down', 'plus']);
    function renderIcons(root) {
        const icons = [...(root.querySelectorAll?.('[data-icon]') || [])];
        if (root.matches?.('[data-icon]')) icons.unshift(root);
        for (const placeholder of icons) {
            const name = placeholder.dataset.icon;
            if (!iconNames.has(name)) continue;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', `ui-icon ${placeholder.className || ''}`);
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `/assets/icons/lucide.svg#${name}`);
            svg.appendChild(use);
            placeholder.replaceWith(svg);
        }
    }
    renderIcons(document.body);
    new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) renderIcons(node);
        }));
    }).observe(document.body, { childList: true, subtree: true });

    const accountName = document.getElementById('userAuthName');
    const accountButton = document.getElementById('btnUserMenu');
    const accountMenu = document.getElementById('userMenuDropdown');
    if (accountName && accountButton && accountMenu) {
        const syncAccount = () => {
            const fullName = accountName.textContent.trim();
            accountButton.title = fullName || 'Tài khoản';
            accountButton.setAttribute('aria-label', fullName ? `Tài khoản: ${fullName}` : 'Tài khoản');
            accountButton.setAttribute('aria-expanded', String(accountMenu.classList.contains('show')));
            const heading = accountMenu.querySelector('.user-menu-account-name');
            if (heading && heading.textContent !== fullName) heading.textContent = fullName;
        };
        const accountObserver = new MutationObserver(syncAccount);
        accountObserver.observe(accountName, { childList: true, subtree: true, characterData: true });
        accountObserver.observe(accountMenu, { attributes: true, attributeFilter: ['class'] });
        syncAccount();
    }

    const tabStrip = document.querySelector('.tab-buttons');
    if (tabStrip) {
        new MutationObserver(() => {
            const active = tabStrip.querySelector('.tab-btn.active');
            if (!active || tabStrip.scrollWidth <= tabStrip.clientWidth) return;
            const stripBox = tabStrip.getBoundingClientRect();
            const buttonBox = active.getBoundingClientRect();
            if (buttonBox.left < stripBox.left) tabStrip.scrollLeft -= stripBox.left - buttonBox.left;
            else if (buttonBox.right > stripBox.right) tabStrip.scrollLeft += buttonBox.right - stripBox.right;
        }).observe(tabStrip, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    const modals = [...document.querySelectorAll('.modal')];
    const opened = [];
    const returnFocus = new WeakMap();
    const focusable = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
    const visible = (element) => element.getClientRects().length > 0;

    for (const modal of modals) {
        const content = modal.querySelector('.modal-content');
        if (!content) continue;
        const title = content.querySelector('h2');
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.tabIndex = -1;
        if (title) {
            if (!title.id) title.id = `${modal.id}Title`;
            content.setAttribute('aria-labelledby', title.id);
        }
        for (const closeButton of content.querySelectorAll('.close, .modal-close')) {
            closeButton.setAttribute('aria-label', 'Đóng');
            if (closeButton.tagName !== 'BUTTON') {
                closeButton.setAttribute('role', 'button');
                closeButton.tabIndex = 0;
                closeButton.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        closeButton.click();
                    }
                });
            }
        }
    }

    function syncModalFocus() {
        for (const modal of modals) {
            const index = opened.indexOf(modal);
            if (visible(modal) && index === -1) {
                returnFocus.set(modal, document.activeElement);
                opened.push(modal);
                const content = modal.querySelector('.modal-content');
                const first = [...modal.querySelectorAll(focusable)].find(visible);
                (first || content)?.focus({ preventScroll: true });
            } else if (!visible(modal) && index !== -1) {
                const wasTop = index === opened.length - 1;
                opened.splice(index, 1);
                if (wasTop) {
                    const previous = returnFocus.get(modal);
                    if (previous?.isConnected && visible(previous)) previous.focus({ preventScroll: true });
                }
            }
        }
        document.body.classList.toggle('ui-modal-open', opened.length > 0);
    }

    const observer = new MutationObserver(syncModalFocus);
    modals.forEach((modal) => observer.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] }));
    syncModalFocus();

    document.addEventListener('keydown', (event) => {
        if (document.querySelector('.popup-overlay')) return;
        if (event.key === 'Escape' && accountMenu?.classList.contains('show')) {
            accountMenu.classList.remove('show');
            accountButton.focus({ preventScroll: true });
        }
        const modal = opened[opened.length - 1];
        if (!modal) return;
        if (event.key === 'Escape') {
            const closeButton = modal.querySelector('.modal-close, .close');
            if (closeButton) { event.preventDefault(); closeButton.click(); }
        }
        if (event.key !== 'Tab') return;
        const items = [...modal.querySelectorAll(focusable)].filter(visible);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
        }
    });
}());
