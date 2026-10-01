/* PMIS_UNIFIED_NAV_EXACT_MAIN_V2 */
(function () {
  'use strict';

  if (window.__PMIS_UNIFIED_NAV_EXACT_MAIN_V2__) return;
  window.__PMIS_UNIFIED_NAV_EXACT_MAIN_V2__ = true;

  const HOME = 'project_review.html';
  const ACTION_KEY = 'pmis_cross_nav_action_v2';
  const FEEDBACK_KEY = 'pmis_cross_nav_feedback_v2';

  function pageName() {
    return String(location.pathname.split('/').pop() || HOME)
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
  }

  function isHome() {
    return pageName() === HOME;
  }

  function isLeadView() {
    const role = String(localStorage.getItem('danprel_auth_role') || '').trim().toLowerCase();
    const user = String(localStorage.getItem('danprel_username') || '').trim().toLowerCase();
    return role === 'lead_view' || user === 'projects@danprel' || user === 'project@danprel';
  }

  function isReviewUser() {
    return String(localStorage.getItem('danprel_username') || '').trim().toLowerCase() === 'review@danprel';
  }

  function roleClass() {
    const role = String(localStorage.getItem('danprel_role') || 'pm').trim().toLowerCase();
    document.body.classList.remove('role-pm', 'role-admin');
    document.body.classList.add('role-' + (role === 'admin' ? 'admin' : 'pm'));
  }

  function normalizeShell() {
    let sidebar = document.getElementById('sidebar');
    if (!sidebar) {
      sidebar = document.getElementById('side');
      if (sidebar) sidebar.id = 'sidebar';
    }
    if (!sidebar) return null;

    sidebar.className = 'sidebar';

    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
      overlay = document.getElementById('shade');
      if (overlay) overlay.id = 'sidebarOverlay';
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      document.body.appendChild(overlay);
    }
    overlay.className = 'sidebar-overlay';

    return { sidebar, overlay };
  }

  function toggleSidebar(force) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !overlay) return;

    const open = typeof force === 'boolean'
      ? force
      : !sidebar.classList.contains('active');

    sidebar.classList.toggle('active', open);
    overlay.classList.toggle('active', open);
  }

  window.pmisUnifiedToggleSidebarV2 = toggleSidebar;
  window.toggleSidebar = function () { toggleSidebar(); };
  window.menuFA = function () { toggleSidebar(); };

  function goHome() {
    location.href = HOME;
  }

  function forward(action, feedbackText) {
    if (isHome()) {
      runHomeAction(action, feedbackText);
      return;
    }

    sessionStorage.setItem(ACTION_KEY, action);
    if (feedbackText != null) {
      sessionStorage.setItem(FEEDBACK_KEY, String(feedbackText));
    }
    location.href = HOME;
  }

  function waitAndCall(name, maxAttempts = 40) {
    let attempt = 0;
    const timer = setInterval(function () {
      attempt += 1;
      const fn = window[name];
      if (typeof fn === 'function') {
        clearInterval(timer);
        try { fn(); }
        catch (error) { console.error('[PMIS NAV V2] Action failed:', name, error); }
      }
      else if (attempt >= maxAttempts) {
        clearInterval(timer);
        console.warn('[PMIS NAV V2] Dashboard action unavailable:', name);
      }
    }, 150);
  }

  function runHomeAction(action, suppliedFeedbackText) {
    const map = {
      calendar: 'openProjectCalendarV34',
      action_export: 'openActionPointExport',
      master_report: 'openMasterReportExport',
      my_feedback: 'openMyFeedbackPane',
      feedback_management: 'openAdminFeedbackPane'
    };

    if (action === 'submit_feedback') {
      const text = suppliedFeedbackText != null
        ? String(suppliedFeedbackText)
        : String(sessionStorage.getItem(FEEDBACK_KEY) || '');
      sessionStorage.removeItem(FEEDBACK_KEY);

      let attempt = 0;
      const timer = setInterval(function () {
        attempt += 1;
        const box = document.getElementById('feedbackText');
        if (box && typeof window.submitFeedback === 'function') {
          clearInterval(timer);
          box.value = text;
          window.submitFeedback();
        }
        else if (attempt >= 40) {
          clearInterval(timer);
          console.warn('[PMIS NAV V2] Feedback submit action unavailable.');
        }
      }, 150);
      return;
    }

    if (map[action]) waitAndCall(map[action]);
  }

  function consumePendingAction() {
    if (!isHome()) return;
    const action = String(sessionStorage.getItem(ACTION_KEY) || '');
    if (!action) return;
    sessionStorage.removeItem(ACTION_KEY);
    setTimeout(function () { runHomeAction(action); }, 250);
  }

  function logout() {
    [
      'danprel_auth','danprel_role','danprel_access_token','danprel_auth_role',
      'danprel_username','danprel_employee_id','danprel_display_name','danprel_designation'
    ].forEach(function (key) { localStorage.removeItem(key); });
    location.replace('login.html');
  }

  function sidebarMarkup() {
    const current = pageName();
    const active = function (file) { return current === file ? ' active' : ''; };
    const financeHidden = isLeadView() ? ' style="display:none!important"' : '';
    const analyticsHidden = isReviewUser() ? '' : ' style="display:none!important"';

    return `
      <div class="sidebar-header">
        <div class="pmis-unified-brand" id="pmisUnifiedHomeBrandV2" role="button" tabindex="0" title="Go to Project Dashboard">
          <div class="brand-logo-wrap"><img src="asset/image.png" alt="Logo"></div>
          <div>
            <div class="pmis-unified-brand-name">DANPREL</div>
            <div class="pmis-unified-brand-sub">Engineering Automation Pvt Ltd</div>
          </div>
        </div>
        <button type="button" class="pmis-unified-close" id="pmisUnifiedCloseV2" aria-label="Close menu">×</button>
      </div>

      <div class="sidebar-section-title">Navigation</div>
      <a href="project_review.html" class="sidebar-btn${active('project_review.html')}">
        <div class="sb-icon"><i class="bi bi-speedometer2"></i></div>Project Dashboard
      </a>
      <a href="resource_hub.html" class="sidebar-btn admin-only${active('resource_hub.html')}">
        <div class="sb-icon"><i class="bi bi-people-fill"></i></div>Resource Hub
      </a>
      <button type="button" class="sidebar-btn" data-pmis-action="calendar">
        <div class="sb-icon"><i class="bi bi-calendar-week-fill"></i></div>Project Calendar
      </button>

      <div class="sidebar-section-title" style="margin-top:20px">Reports</div>
      <button type="button" class="sidebar-btn" data-pmis-action="action_export">
        <div class="sb-icon"><i class="bi bi-file-earmark-arrow-down-fill"></i></div>Export Action Points
      </button>
      <button type="button" class="sidebar-btn" data-pmis-action="master_report">
        <div class="sb-icon"><i class="bi bi-file-earmark-bar-graph-fill"></i></div>Project Master Report
      </button>
      <a href="cashflow.html" class="sidebar-btn${active('cashflow.html')}"${financeHidden}>
        <div class="sb-icon"><i class="bi bi-graph-up-arrow"></i></div>Cashflow / Payments
      </a>
      <a href="invoice_register.html" class="sidebar-btn${active('invoice_register.html')}"${financeHidden}>
        <div class="sb-icon"><i class="bi bi-receipt-cutoff"></i></div>Invoice Register
      </a>
      <a href="financial_analytics.html" class="sidebar-btn${active('financial_analytics.html')}"${analyticsHidden}>
        <div class="sb-icon"><i class="bi bi-bar-chart-line-fill"></i></div>Financial Analytics
      </a>

      <div class="sidebar-section-title" style="margin-top:30px">Share Feedback</div>
      <div class="pmis-unified-feedback-wrap">
        <textarea id="feedbackText" rows="4" placeholder="Suggest features or report issues..."></textarea>
        <button type="button" id="btnSubmitFeedback">Submit Feedback</button>
      </div>

      <button type="button" class="sidebar-btn employee-only" data-pmis-action="my_feedback">
        <div class="sb-icon"><i class="bi bi-chat-square-text-fill"></i></div>
        My Feedback
        <span id="myFeedbackUpdateBadge" class="badge rounded-pill bg-danger ms-auto" style="display:none">0</span>
      </button>

      <button type="button" class="sidebar-btn admin-only" data-pmis-action="feedback_management">
        <div class="sb-icon"><i class="bi bi-inboxes-fill"></i></div>
        Feedback Management
        <span id="feedbackOpenBadge" class="badge rounded-pill bg-danger ms-auto" style="display:none">0</span>
      </button>

      <div class="sidebar-section-title" style="margin-top:18px">Account</div>
      <button type="button" class="sidebar-btn" id="pmisUnifiedLogoutV2">
        <div class="sb-icon"><i class="bi bi-box-arrow-right"></i></div>Logout
      </button>
    `;
  }

  function makeHeaderLogosHome() {
    const images = Array.from(document.querySelectorAll('img'))
      .filter(function (img) {
        const src = String(img.getAttribute('src') || '').toLowerCase();
        return src.includes('asset/image.png');
      });

    images.forEach(function (img) {
      img.classList.add('pmis-nav-home-logo-v2');
      img.title = 'Return to Project Dashboard';
      img.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        goHome();
      });
    });
  }

  function install() {
    roleClass();
    const shell = normalizeShell();
    if (!shell) {
      console.warn('[PMIS NAV V2] Sidebar shell not found.');
      return;
    }

    shell.sidebar.innerHTML = sidebarMarkup();
    shell.overlay.onclick = function () { toggleSidebar(false); };

    document.getElementById('pmisUnifiedHomeBrandV2')?.addEventListener('click', goHome);
    document.getElementById('pmisUnifiedHomeBrandV2')?.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goHome();
      }
    });
    document.getElementById('pmisUnifiedCloseV2')?.addEventListener('click', function () { toggleSidebar(false); });
    document.getElementById('pmisUnifiedLogoutV2')?.addEventListener('click', logout);

    shell.sidebar.querySelectorAll('[data-pmis-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        forward(String(button.getAttribute('data-pmis-action') || ''));
      });
    });

    document.getElementById('btnSubmitFeedback')?.addEventListener('click', function () {
      const text = String(document.getElementById('feedbackText')?.value || '').trim();
      if (!text) {
        alert('Please enter feedback before submitting.');
        return;
      }
      forward('submit_feedback', text);
    });

    makeHeaderLogosHome();
    consumePendingAction();

    console.log('[PMIS NAV V2] Exact Project Dashboard sidebar installed on', pageName());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once:true });
  }
  else {
    install();
  }
})();
