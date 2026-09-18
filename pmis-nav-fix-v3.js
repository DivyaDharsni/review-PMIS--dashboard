/* PMIS_NAV_FIX_V3
 * Goal:
 * - Leave the native Project Dashboard sidebar intact.
 * - Remove duplicate finance links on the dashboard.
 * - Give Cashflow / Invoice Register / Financial Analytics the same expanded
 *   menu structure as the dashboard without fighting the existing V77U/V77Y scripts.
 * - Make DANPREL branding return to project_review.html.
 */
(function () {
    'use strict';

    if (window.__PMIS_NAV_FIX_V3__) return;
    window.__PMIS_NAV_FIX_V3__ = true;

    const HOME = 'project_review.html';
    const ACTION_KEY = 'pmis_nav_v3_action';
    const FEEDBACK_KEY = 'pmis_nav_v3_feedback';

    function pageName() {
        return String(location.pathname.split('/').pop() || HOME)
            .split('?')[0]
            .split('#')[0]
            .toLowerCase();
    }

    function isHome() {
        return pageName() === HOME;
    }

    function normHref(link) {
        return String(link?.getAttribute('href') || '')
            .trim()
            .replace(/^\.\//, '')
            .split('?')[0]
            .split('#')[0]
            .toLowerCase();
    }

    function isLeadView() {
        const role = String(localStorage.getItem('danprel_auth_role') || '').trim().toLowerCase();
        const user = String(localStorage.getItem('danprel_username') || '').trim().toLowerCase();
        return role === 'lead_view' || user === 'projects@danprel' || user === 'project@danprel';
    }

    function isReviewUser() {
        return String(localStorage.getItem('danprel_username') || '')
            .trim()
            .toLowerCase() === 'review@danprel';
    }

    function syncRoleClasses() {
        const role = String(localStorage.getItem('danprel_role') || '').trim().toLowerCase();
        document.body.classList.toggle('pmis-admin', role.includes('admin'));
    }

    function getSidebar() {
        return document.getElementById('sidebar') || document.getElementById('side');
    }

    function getOverlay() {
        return document.getElementById('sidebarOverlay') || document.getElementById('shade');
    }

    function toggleFinanceSidebar(force) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (!sidebar || !overlay) return;

        const open = typeof force === 'boolean'
            ? force
            : !sidebar.classList.contains('active');

        sidebar.classList.toggle('active', open);
        overlay.classList.toggle('active', open);
    }

    function goHome() {
        location.href = HOME;
    }

    function makeLogosHome() {
        document.querySelectorAll('img').forEach(function (img) {
            const src = String(img.getAttribute('src') || '').toLowerCase();
            if (!src.includes('asset/image.png')) return;

            if (img.dataset.pmisHomeV3 === '1') return;
            img.dataset.pmisHomeV3 = '1';
            img.style.cursor = 'pointer';
            img.title = 'Return to Project Dashboard';

            img.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                goHome();
            });
        });
    }

    /* ------------------------------------------------------------------
       PROJECT DASHBOARD:
       Do NOT rebuild or restyle its sidebar.
       Only remove duplicate finance links introduced by overlapping scripts.
       ------------------------------------------------------------------ */

    function choosePreferred(links, preferredIds) {
        for (const id of preferredIds) {
            const found = links.find(link => link.id === id);
            if (found) return found;
        }
        return links[0] || null;
    }

    function dedupeDashboardFinanceLinks() {
        if (!isHome()) return;

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        const groups = [
            {
                href: 'cashflow.html',
                preferred: ['pmisCashflowMenuV75M', 'pmisCashflowMenuV75A']
            },
            {
                href: 'invoice_register.html',
                preferred: ['pmisLocalInvoiceRegister', 'pmisInvoiceRegisterMenuV77U']
            },
            {
                href: 'financial_analytics.html',
                preferred: ['pmisLocalFinancialAnalytics', 'pmisFinancialAnalyticsMenuV77Y']
            }
        ];

        const kept = {};

        groups.forEach(function (group) {
            const links = Array.from(sidebar.querySelectorAll('a.sidebar-btn'))
                .filter(link => normHref(link) === group.href);

            if (!links.length) return;

            const keep = choosePreferred(links, group.preferred);
            kept[group.href] = keep;

            links.forEach(function (link) {
                if (link !== keep) link.remove();
            });
        });

        /* Keep the finance order stable without changing the rest of dashboard. */
        const cash = kept['cashflow.html'] ||
            Array.from(sidebar.querySelectorAll('a.sidebar-btn'))
                .find(link => normHref(link) === 'cashflow.html');

        const invoice = kept['invoice_register.html'] ||
            Array.from(sidebar.querySelectorAll('a.sidebar-btn'))
                .find(link => normHref(link) === 'invoice_register.html');

        const analytics = kept['financial_analytics.html'] ||
            Array.from(sidebar.querySelectorAll('a.sidebar-btn'))
                .find(link => normHref(link) === 'financial_analytics.html');

        if (cash && invoice && cash.nextElementSibling !== invoice) {
            cash.insertAdjacentElement('afterend', invoice);
        }

        if (invoice && analytics && invoice.nextElementSibling !== analytics) {
            invoice.insertAdjacentElement('afterend', analytics);
        }

        makeLogosHome();
    }

    function startDashboardGuard() {
        dedupeDashboardFinanceLinks();

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        let queued = false;

        const observer = new MutationObserver(function (mutations) {
            if (!mutations.some(m => m.type === 'childList')) return;
            if (queued) return;

            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                dedupeDashboardFinanceLinks();
            });
        });

        observer.observe(sidebar, { childList: true, subtree: false });

        /* Existing local menu scripts retry for a few seconds. */
        let tries = 0;
        const timer = setInterval(function () {
            tries += 1;
            dedupeDashboardFinanceLinks();
            if (tries >= 30) clearInterval(timer);
        }, 400);
    }

    /* ------------------------------------------------------------------
       FINANCE PAGES:
       Build the dashboard-style sidebar once, using the canonical IDs that
       the existing Invoice / Analytics scripts already expect.
       ------------------------------------------------------------------ */

    function activeClass(file) {
        return pageName() === file ? ' active' : '';
    }

    function financeSidebarMarkup() {
        const hideFinance = isLeadView();
        const showAnalytics = isReviewUser();

        return `
            <div class="sidebar-header">
                <div class="pmis-v3-brand" id="pmisV3HomeBrand" role="button" tabindex="0" title="Go to Project Dashboard">
                    <div class="brand-logo-wrap">
                        <img src="asset/image.png" alt="Logo">
                    </div>
                    <div>
                        <div class="pmis-v3-brand-name">DANPREL</div>
                        <div class="pmis-v3-brand-sub">Engineering Automation Pvt Ltd</div>
                    </div>
                </div>
                <button type="button" class="pmis-v3-close" id="pmisV3Close" aria-label="Close menu">×</button>
            </div>

            <div class="sidebar-section-title">Navigation</div>

            <a href="project_review.html" class="sidebar-btn${activeClass('project_review.html')}">
                <div class="sb-icon"><i class="bi bi-speedometer2"></i></div>
                Project Dashboard
            </a>

            <a href="resource_hub.html" class="sidebar-btn admin-only${activeClass('resource_hub.html')}">
                <div class="sb-icon"><i class="bi bi-people-fill"></i></div>
                Resource Hub
            </a>

            <button type="button" class="sidebar-btn" data-pmis-v3-action="calendar">
                <div class="sb-icon"><i class="bi bi-calendar-week-fill"></i></div>
                Project Calendar
            </button>

            <div class="sidebar-section-title" style="margin-top:20px;">Reports</div>

            <button type="button" class="sidebar-btn" data-pmis-v3-action="action_export">
                <div class="sb-icon"><i class="bi bi-file-earmark-arrow-down-fill"></i></div>
                Export Action Points
            </button>

            <button type="button" class="sidebar-btn" data-pmis-v3-action="master_report">
                <div class="sb-icon"><i class="bi bi-file-earmark-bar-graph-fill"></i></div>
                Project Master Report
            </button>

            ${hideFinance ? '' : `
            <a id="pmisCashflowMenuV75A" href="cashflow.html" class="sidebar-btn${activeClass('cashflow.html')}">
                <div class="sb-icon"><i class="bi bi-graph-up-arrow"></i></div>
                Cashflow / Payments
            </a>

            <a id="pmisInvoiceRegisterMenuV77U" href="invoice_register.html" class="sidebar-btn${activeClass('invoice_register.html')}">
                <div class="sb-icon"><i class="bi bi-receipt-cutoff"></i></div>
                Invoice Register
            </a>
            `}

            ${showAnalytics ? `
            <a id="pmisFinancialAnalyticsMenuV77Y" href="financial_analytics.html" class="sidebar-btn${activeClass('financial_analytics.html')}">
                <div class="sb-icon"><i class="bi bi-bar-chart-line-fill"></i></div>
                Financial Analytics
            </a>
            ` : ''}

            <div class="sidebar-section-title" style="margin-top:30px;">Share Feedback</div>

            <div class="pmis-v3-feedback">
                <textarea id="pmisV3FeedbackText" rows="4" placeholder="Suggest features or report issues..."></textarea>
                <button type="button" id="pmisV3SubmitFeedback">Submit Feedback</button>
            </div>

            <button type="button" class="sidebar-btn employee-only" data-pmis-v3-action="my_feedback">
                <div class="sb-icon"><i class="bi bi-chat-square-text-fill"></i></div>
                My Feedback
            </button>

            <button type="button" class="sidebar-btn admin-only" data-pmis-v3-action="feedback_management">
                <div class="sb-icon"><i class="bi bi-inboxes-fill"></i></div>
                Feedback Management
            </button>

            <div class="sidebar-section-title" style="margin-top:18px;">Account</div>

            <button type="button" class="sidebar-btn" id="pmisV3Logout">
                <div class="sb-icon"><i class="bi bi-box-arrow-right"></i></div>
                Logout
            </button>
        `;
    }

    function normalizeFinanceShell() {
        let sidebar = getSidebar();
        if (!sidebar) return null;

        if (sidebar.id !== 'sidebar') sidebar.id = 'sidebar';
        sidebar.className = 'sidebar';

        let overlay = getOverlay();

        if (!overlay) {
            overlay = document.createElement('div');
            document.body.appendChild(overlay);
        }

        overlay.id = 'sidebarOverlay';
        overlay.className = 'sidebar-overlay';

        return { sidebar, overlay };
    }

    function logout() {
        if (typeof window.pmisCashflowLogout === 'function') {
            window.pmisCashflowLogout();
            return;
        }

        if (typeof window.logoutFA === 'function') {
            window.logoutFA();
            return;
        }

        [
            'danprel_auth',
            'danprel_access_token',
            'danprel_role',
            'danprel_auth_role',
            'danprel_username',
            'danprel_employee_id',
            'danprel_display_name',
            'danprel_designation'
        ].forEach(key => localStorage.removeItem(key));

        location.replace('login.html');
    }

    function forwardToHome(action, feedbackText) {
        if (feedbackText != null) {
            sessionStorage.setItem(FEEDBACK_KEY, String(feedbackText));
        }

        sessionStorage.setItem(ACTION_KEY, action);
        location.href = HOME;
    }

    function bindFinanceSidebar(sidebar, overlay) {
        overlay.onclick = function () {
            toggleFinanceSidebar(false);
        };

        document.getElementById('pmisV3Close')?.addEventListener('click', function () {
            toggleFinanceSidebar(false);
        });

        const brand = document.getElementById('pmisV3HomeBrand');

        brand?.addEventListener('click', goHome);
        brand?.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                goHome();
            }
        });

        document.getElementById('pmisV3Logout')?.addEventListener('click', logout);

        sidebar.querySelectorAll('[data-pmis-v3-action]').forEach(function (button) {
            button.addEventListener('click', function () {
                forwardToHome(String(button.getAttribute('data-pmis-v3-action') || ''));
            });
        });

        document.getElementById('pmisV3SubmitFeedback')?.addEventListener('click', function () {
            const text = String(document.getElementById('pmisV3FeedbackText')?.value || '').trim();

            if (!text) {
                alert('Please enter feedback before submitting.');
                return;
            }

            forwardToHome('submit_feedback', text);
        });

        /* Existing page menu buttons can keep calling either function name. */
        window.toggleSidebar = function () {
            toggleFinanceSidebar();
        };

        window.menuFA = function () {
            toggleFinanceSidebar();
        };

        makeLogosHome();
    }

    function financeSidebarIsCorrect(sidebar) {
        const links = Array.from(sidebar.querySelectorAll('a.sidebar-btn'));

        const count = function (href) {
            return links.filter(link => normHref(link) === href).length;
        };

        if (count('project_review.html') !== 1) return false;
        if (!isLeadView() && count('cashflow.html') !== 1) return false;
        if (!isLeadView() && count('invoice_register.html') !== 1) return false;
        if (isReviewUser() && count('financial_analytics.html') !== 1) return false;
        if (!isReviewUser() && count('financial_analytics.html') !== 0) return false;
        if (count('resource_hub.html') !== 1) return false;

        /* The old V2/raw-dashboard copy created duplicate finance entries. */
        if (links.some((link, index) =>
            links.findIndex(other => normHref(other) === normHref(link)) !== index
        )) {
            return false;
        }

        return true;
    }

    let rebuilding = false;

    function rebuildFinanceSidebar() {
        if (isHome() || rebuilding) return;

        const shell = normalizeFinanceShell();
        if (!shell) return;

        rebuilding = true;

        shell.sidebar.innerHTML = financeSidebarMarkup();
        bindFinanceSidebar(shell.sidebar, shell.overlay);

        rebuilding = false;
    }

    function startFinanceGuard() {
        syncRoleClasses();
        rebuildFinanceSidebar();

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        let queued = false;

        const observer = new MutationObserver(function (mutations) {
            if (rebuilding) return;
            if (!mutations.some(m => m.type === 'childList')) return;
            if (queued) return;

            queued = true;

            requestAnimationFrame(function () {
                queued = false;

                if (!financeSidebarIsCorrect(sidebar)) {
                    rebuildFinanceSidebar();
                }
            });
        });

        observer.observe(sidebar, { childList: true, subtree: false });

        /* Cover V77U/V77Y delayed menu initialization without permanent polling. */
        let tries = 0;
        const timer = setInterval(function () {
            tries += 1;

            if (!financeSidebarIsCorrect(sidebar)) {
                rebuildFinanceSidebar();
            }

            if (tries >= 24) {
                clearInterval(timer);
            }
        }, 300);
    }

    /* ------------------------------------------------------------------
       Pending actions are executed only after returning to the dashboard.
       ------------------------------------------------------------------ */

    function runPendingHomeAction() {
        if (!isHome()) return;

        const action = String(sessionStorage.getItem(ACTION_KEY) || '');
        if (!action) return;

        sessionStorage.removeItem(ACTION_KEY);

        const map = {
            calendar: 'openProjectCalendarV34',
            action_export: 'openActionPointExport',
            master_report: 'openMasterReportExport',
            my_feedback: 'openMyFeedbackPane',
            feedback_management: 'openAdminFeedbackPane'
        };

        if (action === 'submit_feedback') {
            const text = String(sessionStorage.getItem(FEEDBACK_KEY) || '');
            sessionStorage.removeItem(FEEDBACK_KEY);

            let attempts = 0;
            const timer = setInterval(function () {
                attempts += 1;

                const box = document.getElementById('feedbackText');

                if (box && typeof window.submitFeedback === 'function') {
                    clearInterval(timer);
                    box.value = text;
                    window.submitFeedback();
                }
                else if (attempts >= 40) {
                    clearInterval(timer);
                }
            }, 150);

            return;
        }

        const fnName = map[action];
        if (!fnName) return;

        let attempts = 0;
        const timer = setInterval(function () {
            attempts += 1;

            if (typeof window[fnName] === 'function') {
                clearInterval(timer);
                window[fnName]();
            }
            else if (attempts >= 40) {
                clearInterval(timer);
            }
        }, 150);
    }

    function start() {
        syncRoleClasses();
        makeLogosHome();

        if (isHome()) {
            startDashboardGuard();
            runPendingHomeAction();
        }
        else {
            startFinanceGuard();
        }

        console.log('[PMIS NAV V3] Sidebar fix active on', pageName());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
    else {
        start();
    }
})();
