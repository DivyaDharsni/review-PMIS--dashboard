(function () {
    'use strict';

    if (window.__PMIS_FINANCE_MENU_ACCESS_V41__) return;
    window.__PMIS_FINANCE_MENU_ACCESS_V41__ = true;

    function user() {
        return String(localStorage.getItem('danprel_username') || '')
            .trim()
            .toLowerCase();
    }

    function roleText() {
        return [
            localStorage.getItem('danprel_role'),
            localStorage.getItem('danprel_auth_role'),
            localStorage.getItem('danprel_designation')
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function allowed() {
        const u = user();
        const review = [
            'review@danprel',
            'review@danprel.com',
            'review.danprel.com'
        ].includes(u);

        return review || roleText().includes('admin');
    }

    function hrefOf(a) {
        return String(a?.getAttribute('href') || '')
            .replace(/^\.\//, '')
            .split('?')[0]
            .split('#')[0]
            .toLowerCase();
    }

    function enforceClass() {
        document.body.classList.toggle(
            'pmis-finance-restricted-allowed',
            allowed()
        );
    }

    function ensureAllowedLinks() {
        if (!allowed()) return;

        const side =
            document.getElementById('sidebar') ||
            document.getElementById('side');

        if (!side) return;

        const links = () => Array.from(side.querySelectorAll('a'));

        let invoice = links().find(
            a => hrefOf(a) === 'invoice_register.html'
        );

        if (!invoice) {
            invoice = document.createElement('a');
            invoice.id = 'pmisInvoiceRegisterMenuV77U';
            invoice.href = 'invoice_register.html';
            invoice.className = 'sidebar-btn';
            invoice.innerHTML =
                '<div class="sb-icon"><i class="bi bi-receipt-cutoff"></i></div>' +
                'Invoice Register';

            const cash = links().find(
                a => hrefOf(a) === 'cashflow.html'
            );

            if (cash) cash.insertAdjacentElement('afterend', invoice);
            else side.appendChild(invoice);
        }

        let analytics = links().find(
            a => hrefOf(a) === 'financial_analytics.html'
        );

        if (!analytics) {
            analytics = document.createElement('a');
            analytics.id = 'pmisFinancialAnalyticsMenuV77Y';
            analytics.href = 'financial_analytics.html';
            analytics.className = 'sidebar-btn';
            analytics.innerHTML =
                '<div class="sb-icon"><i class="bi bi-bar-chart-line-fill"></i></div>' +
                'Financial Analytics';

            invoice.insertAdjacentElement('afterend', analytics);
        }

        if (invoice.nextElementSibling !== analytics) {
            invoice.insertAdjacentElement('afterend', analytics);
        }
    }

    function start() {
        enforceClass();
        ensureAllowedLinks();

        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            enforceClass();
            ensureAllowedLinks();
            if (tries >= 30) clearInterval(timer);
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once:true });
    } else {
        start();
    }
})();
