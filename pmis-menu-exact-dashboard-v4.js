/* PMIS_MENU_EXACT_DASHBOARD_V4
   Finance-page sidebar only.
   Uses the same markup/order/interaction model as project_review.html.
*/
(function () {
    'use strict';

    if (window.__PMIS_MENU_EXACT_DASHBOARD_V4__) return;
    window.__PMIS_MENU_EXACT_DASHBOARD_V4__ = true;

    const HOME = 'project_review.html';
    const ACTION_KEY = 'pmis_nav_v4_action';
    const FEEDBACK_KEY = 'pmis_nav_v4_feedback';

    function pageName() {
        return String(location.pathname.split('/').pop() || '')
            .split('?')[0]
            .split('#')[0]
            .toLowerCase();
    }

    function username() {
        return String(localStorage.getItem('danprel_username') || '')
            .trim()
            .toLowerCase();
    }

    function roleText() {
        return [
            localStorage.getItem('danprel_role'),
            localStorage.getItem('danprel_auth_role')
        ]
            .filter(Boolean)
            .join(' ')
            .trim()
            .toLowerCase();
    }

    function isLeadView() {
        const role = String(localStorage.getItem('danprel_auth_role') || '')
            .trim()
            .toLowerCase();

        const user = username();

        return (
            role === 'lead_view' ||
            user === 'projects@danprel' ||
            user === 'project@danprel'
        );
    }

    function isReviewUser() {
        const u = username();

        const reviewLogin = [
            'review@danprel',
            'review@danprel.com',
            'review.danprel.com'
        ].includes(u);

        return reviewLogin || roleText().includes('admin');
    }

    function isAdminLike() {
        const role = roleText();

        return (
            role.includes('admin') ||
            isReviewUser()
        );
    }

    function applyRoleClass() {
        document.body.classList.remove('role-admin', 'role-pm');

        if (isAdminLike()) {
            document.body.classList.add('role-admin');
        } else {
            document.body.classList.add('role-pm');
        }
    }

    function active(file) {
        return pageName() === file ? ' active' : '';
    }

    function financeLinksMarkup() {
        if (isLeadView()) return '';

        const analytics = isReviewUser()
            ? `
        <a id="pmisFinancialAnalyticsMenuV77Y"
           href="financial_analytics.html"
           class="sidebar-btn${active('financial_analytics.html')}">
            <div class="sb-icon">
                <i class="bi bi-bar-chart-line-fill"></i>
            </div>
            Financial Analytics
        </a>`
            : '';

        return `
        <a id="pmisCashflowMenuV75M"
           href="cashflow.html"
           class="sidebar-btn${active('cashflow.html')}">
            <div class="sb-icon"
                 style="background:rgba(20,184,166,.18);">
                <i class="bi bi-graph-up-arrow"
                   style="color:#2dd4bf;"></i>
            </div>
            Cashflow / Payments
        </a>

        <a id="pmisInvoiceRegisterMenuV77U"
           href="invoice_register.html"
           class="sidebar-btn${active('invoice_register.html')}">
            <div class="sb-icon">
                <i class="bi bi-receipt-cutoff"></i>
            </div>
            Invoice Register
        </a>
        ${analytics}`;
    }

    function sidebarMarkup() {
        return `
        <div class="sidebar-header">
            <div class="d-flex align-items-center gap-3 pmis-home-brand"
                 id="pmisV4HomeBrand"
                 role="button"
                 tabindex="0"
                 title="Go to Project Dashboard">
                <div class="brand-logo-wrap"
                     style="width:40px;height:40px;">
                    <img src="asset/image.png" alt="Logo">
                </div>
                <div>
                    <div style="font-weight:900;font-size:1.1rem;color:white;">
                        DANPREL
                    </div>
                    <div style="font-size:.6rem;color:#94a3b8;text-transform:uppercase;">
                        Engineering Automation Pvt Ltd
                    </div>
                </div>
            </div>

            <button type="button"
                    class="btn-close btn-close-white"
                    id="pmisV4Close"
                    aria-label="Close"></button>
        </div>

        <div class="sidebar-section-title">Navigation</div>

        <a href="project_review.html"
           class="sidebar-btn">
            <div class="sb-icon">
                <i class="bi bi-speedometer2"></i>
            </div>
            Project Dashboard
        </a>

        <a href="resource_hub.html"
           class="sidebar-btn admin-only">
            <div class="sb-icon">
                <i class="bi bi-people-fill"></i>
            </div>
            Resource Hub
        </a>

        <button type="button"
                class="sidebar-btn"
                data-pmis-v4-action="calendar">
            <div class="sb-icon"
                 style="background:rgba(37,99,235,.18);">
                <i class="bi bi-calendar-week-fill"
                   style="color:#60a5fa;"></i>
            </div>
            Project Calendar
        </button>

        <div class="sidebar-section-title"
             style="margin-top:20px;">
            Reports
        </div>

        <button type="button"
                class="sidebar-btn"
                data-pmis-v4-action="action_export">
            <div class="sb-icon"
                 style="background:rgba(20,184,166,.18);">
                <i class="bi bi-file-earmark-arrow-down-fill"
                   style="color:#14b8a6;"></i>
            </div>
            Export Action Points
        </button>

        <button type="button"
                class="sidebar-btn"
                data-pmis-v4-action="master_report">
            <div class="sb-icon"
                 style="background:rgba(245,158,11,.18);">
                <i class="bi bi-file-earmark-bar-graph-fill"
                   style="color:#f59e0b;"></i>
            </div>
            Project Master Report
        </button>

        ${financeLinksMarkup()}

        <div class="sidebar-section-title"
             style="margin-top:30px;">
            Share Feedback
        </div>

        <div class="px-3 pb-4">
            <textarea id="pmisV4FeedbackText"
                      class="form-control mb-3"
                      rows="4"
                      placeholder="Suggest features or report issues..."
                      style="border-radius:16px;font-size:.9rem;border:none;padding:15px;resize:none;"></textarea>

            <button type="button"
                    class="btn w-100"
                    id="pmisV4SubmitFeedback"
                    style="background:#14b8a6;color:white;border-radius:16px;height:54px;font-size:1rem;font-weight:800;box-shadow:0 8px 16px rgba(20,184,166,.2);">
                Submit Feedback
            </button>
        </div>

        <div class="px-3 pmis-my-feedback-v37">
            <button type="button"
                    class="sidebar-btn employee-only"
                    data-pmis-v4-action="my_feedback">
                <div class="sb-icon">
                    <i class="bi bi-chat-square-text-fill"></i>
                </div>
                My Feedback
            </button>
        </div>

        <div class="px-3 pb-4 pmis-feedback-management-v35">
            <button type="button"
                    class="sidebar-btn admin-only"
                    data-pmis-v4-action="feedback_management">
                <div class="sb-icon">
                    <i class="bi bi-inboxes-fill"></i>
                </div>
                Feedback Management
            </button>
        </div>

        <div class="sidebar-section-title"
             style="margin-top:18px;">
            Account
        </div>

        <button type="button"
                class="sidebar-btn"
                id="pmisV4Logout">
            <div class="sb-icon">
                <i class="bi bi-box-arrow-right"></i>
            </div>
            Logout
        </button>`;
    }

    function shell() {
        let sidebar =
            document.getElementById('sidebar') ||
            document.getElementById('side');

        if (!sidebar) {
            console.error('[PMIS NAV V4] Sidebar element not found.');
            return null;
        }

        sidebar.id = 'sidebar';
        sidebar.className = 'sidebar';

        let overlay =
            document.getElementById('sidebarOverlay') ||
            document.getElementById('shade');

        if (!overlay) {
            overlay = document.createElement('div');
            sidebar.insertAdjacentElement('afterend', overlay);
        }

        overlay.id = 'sidebarOverlay';
        overlay.className = 'sidebar-overlay';

        return { sidebar, overlay };
    }

    function setOpen(open) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (!sidebar || !overlay) return;

        sidebar.classList.toggle('active', Boolean(open));
        overlay.classList.toggle('active', Boolean(open));
    }

    function toggle() {
        const sidebar = document.getElementById('sidebar');
        setOpen(!sidebar?.classList.contains('active'));
    }

    function goHome() {
        location.href = HOME;
    }

    function forward(action, feedbackText) {
        if (feedbackText != null) {
            sessionStorage.setItem(FEEDBACK_KEY, String(feedbackText));
        }

        sessionStorage.setItem(ACTION_KEY, action);
        location.href = HOME;
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

    function bind(shellParts) {
        const { sidebar, overlay } = shellParts;

        overlay.onclick = () => setOpen(false);

        document
            .getElementById('pmisV4Close')
            ?.addEventListener('click', () => setOpen(false));

        const homeBrand =
            document.getElementById('pmisV4HomeBrand');

        homeBrand?.addEventListener('click', goHome);

        homeBrand?.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                goHome();
            }
        });

        document
            .getElementById('pmisV4Logout')
            ?.addEventListener('click', logout);

        sidebar
            .querySelectorAll('[data-pmis-v4-action]')
            .forEach(button => {
                button.addEventListener('click', () => {
                    forward(
                        String(
                            button.getAttribute(
                                'data-pmis-v4-action'
                            ) || ''
                        )
                    );
                });
            });

        document
            .getElementById('pmisV4SubmitFeedback')
            ?.addEventListener('click', () => {
                const text =
                    String(
                        document
                            .getElementById(
                                'pmisV4FeedbackText'
                            )
                            ?.value || ''
                    ).trim();

                if (!text) {
                    alert(
                        'Please enter feedback before submitting.'
                    );
                    return;
                }

                forward('submit_feedback', text);
            });

        /*
         * Finance pages already call one of these names from their
         * existing hamburger buttons. Make both use the same menu.
         */
        window.toggleSidebar = toggle;
        window.menuFA = toggle;

        /*
         * Header logo on every finance page returns to the dashboard.
         */
        document.querySelectorAll('img').forEach(img => {
            const src =
                String(img.getAttribute('src') || '')
                    .toLowerCase();

            if (!src.includes('asset/image.png')) return;

            if (
                img.closest('#sidebar') ||
                img.dataset.pmisV4HeaderHome === '1'
            ) {
                return;
            }

            img.dataset.pmisV4HeaderHome = '1';
            img.style.cursor = 'pointer';
            img.title = 'Return to Project Dashboard';

            img.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                goHome();
            });
        });
    }

    let rebuilding = false;

    function rebuild() {
        if (rebuilding) return;

        const parts = shell();
        if (!parts) return;

        rebuilding = true;

        applyRoleClass();
        parts.sidebar.innerHTML = sidebarMarkup();
        bind(parts);

        rebuilding = false;
    }

    function correct() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return false;

        const counts = {};

        sidebar
            .querySelectorAll('a.sidebar-btn')
            .forEach(link => {
                const href =
                    String(
                        link.getAttribute('href') || ''
                    )
                        .replace(/^\.\//, '')
                        .split('?')[0]
                        .split('#')[0]
                        .toLowerCase();

                counts[href] = (counts[href] || 0) + 1;
            });

        if (counts['project_review.html'] !== 1) return false;

        if (!isLeadView()) {
            if (counts['cashflow.html'] !== 1) return false;
            if (counts['invoice_register.html'] !== 1) return false;
        }

        if (
            isReviewUser() &&
            counts['financial_analytics.html'] !== 1
        ) {
            return false;
        }

        if (
            !isReviewUser() &&
            (counts['financial_analytics.html'] || 0) !== 0
        ) {
            return false;
        }

        if (!document.getElementById('pmisV4HomeBrand')) {
            return false;
        }

        return true;
    }

    function guard() {
        rebuild();

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        let queued = false;

        const observer =
            new MutationObserver(mutations => {
                if (rebuilding) return;

                if (
                    !mutations.some(
                        mutation =>
                            mutation.type === 'childList'
                    )
                ) {
                    return;
                }

                if (queued) return;

                queued = true;

                requestAnimationFrame(() => {
                    queued = false;

                    if (!correct()) {
                        rebuild();
                    }
                });
            });

        observer.observe(
            sidebar,
            {
                childList: true,
                subtree: false
            }
        );

        /*
         * Older PMIS menu scripts perform delayed retries.
         * Guard the exact menu for a short window only.
         */
        let attempts = 0;

        const timer =
            setInterval(() => {
                attempts += 1;

                if (!correct()) {
                    rebuild();
                }

                if (attempts >= 30) {
                    clearInterval(timer);
                }
            }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            guard,
            { once: true }
        );
    } else {
        guard();
    }

    console.log(
        '[PMIS NAV V4] Exact dashboard sidebar active on',
        pageName()
    );
})();
