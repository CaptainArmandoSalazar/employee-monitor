/* global electronAPI */
'use strict';

const api = window.electronAPI;

// ── State ─────────────────────────────────────────────────
let currentEmployee = null;
let isAdmin = false;
let isHR = false;
let isManager = false;
let timerInterval = null;
let clockInTime = null;
let editingEmployeeId = null;
let resetPwEmployeeId = null;

// Shorthand
function g(id) { return document.getElementById(id); }


function validateStrongPassword(pw) {
  if (pw.length < 8)
    return 'Password must be at least 8 characters long';
  if (!/[A-Z]/.test(pw))
    return 'Password must contain at least one uppercase letter (A-Z)';
  if (!/[a-z]/.test(pw))
    return 'Password must contain at least one lowercase letter (a-z)';
  if (!/\d/.test(pw))
    return 'Password must contain at least one number (0-9)';
  if (!/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(pw))
    return 'Password must contain at least one special character (!@#$%^&*...)';
  return null; // valid
}

// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
async function boot() {
  try {
    currentEmployee = await api.getEmployee();
    if (!currentEmployee) { await api.showLogin(); return; }

    const role = currentEmployee.role;
    isAdmin = role === 'super_admin';
    isHR = role === 'hr';
    isManager = role === 'manager';
    const name = currentEmployee.employee_name || 'User';
    document.querySelectorAll(`.role-only.role-${role}`).forEach(el => el.classList.remove('hidden'));
    g('sidebar-name').textContent = name;
    g('sidebar-role').textContent = currentEmployee.role;
    g('sidebar-avatar').textContent = name.charAt(0).toUpperCase();

    if (isAdmin) {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    g('greeting').textContent = `${greet}, ${name.split(' ')[0]}`;
    g('overview-date').textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const active = await api.getActiveSession();
    if (active) {
      // Restore clock-in time from actual session timestamp (survives app restart)
      if (active.clock_in) {
        const clockInStr = String(active.clock_in);
        const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
          ? clockInStr
          : clockInStr + 'Z';
        clockInTime = new Date(clockInISO).getTime();
      } else {
        clockInTime = await api.getClockInTime() || Date.now();
      }

      setClocked(true);
      startTimer();


      // Try sessionStorage first (same session, app didn't fully restart)
      const saved = sessionStorage.getItem('clockin_data');
      if (saved) {
        try {
          const r = JSON.parse(saved);
          fillClockInPanel(r.deviceInfo || {}, r.netInfo || {}, r.geo || {}, r.netSpeed || {}, r.session || {});
          g('clockin-details').classList.remove('hidden');
        } catch { /* ignore */ }
      } else {
        // App restarted — fetch device/network info from DB to repopulate panel
        try {
          const [devR, netR] = await Promise.all([
            api.getAdminDeviceInfo({ session_id: active.session_id, limit: '1' }),
            api.getAdminNetworkInfo({ session_id: active.session_id, limit: '1' }),
          ]);
          const d = (devR && devR.ok && Array.isArray(devR.data) && devR.data[0]) ? devR.data[0] : {};
          const n = (netR && netR.ok && Array.isArray(netR.data) && netR.data[0]) ? netR.data[0] : {};
          fillClockInPanel(d, n, active, {}, active);
          g('clockin-details').classList.remove('hidden');
        } catch { /* ignore */ }
      }

      // Refresh keystrokes from DB for this resumed session
      setTimeout(refreshKeystrokesFromDB, 2000);
    }

    await loadOverview();
    bindNav();
    bindWindowControls();
    bindClockButtons();
    bindModalButtons();
    if (isAdmin || isHR || isManager) bindAdminButtons();

  } catch (err) {
    console.error('Boot error:', err);
  }
}

// ══════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════
function bindNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });
  g('btn-logout').addEventListener('click', async () => {
    try {
      stopTimer();
      await api.logout();
      await api.showLogin();
    } catch (e) {
      console.error('Logout error:', e);
      // Force navigation anyway
      await api.showLogin();
    }
  });
  const btnViewAll = g('btn-view-all-sessions');
  if (btnViewAll) btnViewAll.addEventListener('click', () => switchPage('my-sessions'));
  const btnChangePw = g('btn-change-password');
  if (btnChangePw) btnChangePw.addEventListener('click', openChangePasswordModal);
}

function switchPage(pageId) {
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = g('page-' + pageId);
  const navBtn = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  const role = currentEmployee?.role;
  if (pageId === 'overview') loadOverview();
  if (pageId === 'my-sessions') { showSub('my-sessions', 'my-sessions-list'); loadMySessions(); }
  if (pageId === 'super-admins') { showSub('super-admins', 'super-admins-list'); loadRolePage('super_admin', 'super-admins-body', 'super-admins'); }
  if (pageId === 'hrs') { showSub('hrs', 'hrs-list'); loadRolePage('hr', 'hrs-body', 'hrs'); }
  if (pageId === 'managers') { showSub('managers', 'managers-list'); loadRolePage('manager', 'managers-body', 'managers'); }
  if (pageId === 'employees') { showSub('employees', 'employees-list'); loadRolePage('employee', 'employees-body', 'employees'); }
  if (pageId === 'my-employees') { showSub('my-employees', 'my-employees-list'); loadRolePage('employee', 'my-employees-body', 'my-employees'); }
  if (pageId === 'settings') { loadSettings(); }
  // legacy
  if (pageId === 'admins') { showSub('admins', 'admins-list'); loadAdmins(); }
}

async function loadRolePage(role, tbodyId, pageKey) {
  const tbody = g(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = loadingRow(tbodyId === 'employees-body' ? 7 : 6);
  try {
    const params = { role, active_only: 'false' };
    const r = await api.listEmployees(params);
    const list = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    if (!list.length) { tbody.innerHTML = emptyRow(tbodyId === 'employees-body' ? 7 : 6, 'No records found'); return; }

    // Map pageKey → subpage prefix for drill-down
    const pageMap = {
      'super-admins': 'super-admins',
      'hrs': 'hrs',
      'managers': 'managers',
      'employees': 'employees',
      'my-employees': 'my-employees',
    };
    const pfx = pageMap[pageKey] || pageKey;
    let managerMap = {};
    if (tbodyId === 'employees-body') {
      try {
        const [mr, hr] = await Promise.all([
          api.listEmployees({ role: 'manager', active_only: 'false' }),
          api.listEmployees({ role: 'hr', active_only: 'false' }),
        ]);
        const managers = (mr && mr.ok && Array.isArray(mr.data)) ? mr.data : [];
        const hrs = (hr && hr.ok && Array.isArray(hr.data)) ? hr.data : [];
        managers.forEach(m => { managerMap[m.employee_id] = m.employee_name; });
        hrs.forEach(h => { managerMap[h.employee_id] = `${h.employee_name} (HR)`; });
      } catch { /* ignore, show — as fallback */ }
    }
    tbody.innerHTML = list.map(e => `
  <tr>
    <td><div style="display:flex;align-items:center;gap:8px;">
      <div class="avatar" style="width:28px;height:28px;font-size:11px;">${e.employee_name.charAt(0).toUpperCase()}</div>
      <strong>${esc(e.employee_name)}</strong>
    </div></td>
    <td class="td-muted">${esc(e.email)}</td>
    <td>${esc(e.department || '—')}</td>
    ${tbodyId === 'employees-body' ? `<td class="td-muted">${esc(managerMap[e.manager_id] || '—')}</td>` : ''}
    <td class="td-muted">${e.date_of_joining ? fmtDate(e.date_of_joining) : '—'}</td>
    <td>${e.status ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
<td>
  <div style="display:flex;gap:6px;">
${(isAdmin || isHR) ? `
    <button class="btn btn-ghost btn-sm"
            data-action="edit-user"
            data-emp-id="${esc(String(e.employee_id))}"
            data-emp-name="${esc(e.employee_name)}"
            data-emp-email="${esc(e.email)}"
            data-emp-dept="${esc(e.department || '')}"
            data-emp-role="${esc(e.role)}"
            data-emp-manager="${esc(e.manager_id || '')}">
      Edit
    </button>` : ''}
    <button class="btn btn-ghost btn-sm"
            data-action="view-user"
            data-emp-id="${esc(String(e.employee_id))}"
            data-emp-name="${esc(e.employee_name)}"
            data-page="${pfx}">
      View
    </button>
    ${(isAdmin || isHR) && e.role !== 'super_admin' ? `
    <button class="btn btn-danger btn-sm"
            data-action="remove-user"
            data-emp-id="${esc(String(e.employee_id))}"
            data-emp-name="${esc(e.employee_name)}"
            data-emp-status="${e.status}">
      ${e.status ? 'Deactivate' : 'Activate'}
    </button>` : ''}
  </div>
</td>
  </tr>`).join('');
  } catch (e) { tbody.innerHTML = emptyRow(6, 'Error: ' + e.message); }
}

function showSub(pageId, subId) {
  const page = g('page-' + pageId);
  if (!page) { console.error('showSub: page not found for', pageId); return; }
  page.querySelectorAll('.subpage').forEach(s => s.classList.remove('active'));
  const target = g(subId);
  if (target) {
    target.classList.add('active');
  } else {
    console.error('showSub: target subpage not found:', subId);
  }
}

// ══════════════════════════════════════════════════════════
// WINDOW CONTROLS
// ══════════════════════════════════════════════════════════
function bindWindowControls() {
  g('btn-minimize').addEventListener('click', () => api.minimize());
  g('btn-close').addEventListener('click', async () => {
    if (await api.isClocked()) {
      if (confirm('You are clocked in. Clock out before closing?')) await doClockOut();
    }
    api.closeWindow();
  });
}

// ══════════════════════════════════════════════════════════
// CLOCK IN / OUT
// ══════════════════════════════════════════════════════════
function bindClockButtons() {
  g('btn-clock-in').addEventListener('click', doClockIn);
  g('btn-clock-out').addEventListener('click', doClockOut);
}

async function doClockIn() {
  const loader = g('clock-in-loading');
  g('btn-clock-in').classList.add('hidden');
  loader.classList.remove('hidden');
  try {
    const r = await api.clockIn();
    if (r.success) {
      clockInTime = Date.now();
      setClocked(true); startTimer();
      g('session-meta').textContent = `Clocked in at ${fmtTime(r.session.clock_in)}`;
      fillClockInPanel(r.deviceInfo || {}, r.netInfo || {}, r.geo || {}, r.netSpeed || {}, r.session || {});
      g('clockin-details').classList.remove('hidden');
      sessionStorage.setItem('clockin_data', JSON.stringify({
        deviceInfo: r.deviceInfo || {}, netInfo: r.netInfo || {},
        geo: r.geo || {}, netSpeed: r.netSpeed || {}, session: r.session || {},
      }));
      // Reset keystrokes display on new clock-in
    } else {
      alert('Clock-in failed: ' + (r.error || 'Unknown'));
      setClocked(false);
    }
  } catch (e) { alert('Clock-in error: ' + e.message); setClocked(false); }
  finally { loader.classList.add('hidden'); }
}

async function doClockOut() {
  const btn = g('btn-clock-out');
  btn.disabled = true; btn.textContent = 'Clocking out…';
  try {
    const r = await api.clockOut();
    if (r.success) {
      stopTimer(); setClocked(false); clockInTime = null;
      g('clockin-details').classList.add('hidden');
      sessionStorage.removeItem('clockin_data');
      await loadOverview();
    } else {
      const err = r.error || '';
      if (err.toLowerCase().includes('token') || err.toLowerCase().includes('expired') || err.toLowerCase().includes('auth')) {
        stopTimer(); setClocked(false); clockInTime = null;
        sessionStorage.removeItem('clockin_data');
        await api.showLogin();
      } else {
        alert('Clock-out failed: ' + err);
      }
    }
  } catch (e) {
    stopTimer(); setClocked(false); clockInTime = null;
    sessionStorage.removeItem('clockin_data');
  }
  finally { btn.disabled = false; btn.innerHTML = '■ Clock Out'; }
}
// ADD this function near the top of dashboard.js with other utility functions:
function formatRawKeystrokes(raw) {
  if (!raw) return '';
  return esc(raw)
    .replace(/\[SPACE\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">␣</span>')
    .replace(/\[ENTER\]/g, '<span style="background:var(--accent-dim);border-radius:3px;padding:0 4px;font-size:10px;color:var(--accent);">↵</span>')
    .replace(/\[BACKSPACE\]/g, '<span style="background:var(--danger-dim);border-radius:3px;padding:0 4px;font-size:10px;color:var(--danger);">⌫</span>')
    .replace(/\[TAB\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">⇥</span>')
    .replace(/\[UP\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">↑</span>')
    .replace(/\[DOWN\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">↓</span>')
    .replace(/\[LEFT\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">←</span>')
    .replace(/\[RIGHT\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">→</span>')
    .replace(/\[DEL\]/g, '<span style="background:var(--danger-dim);border-radius:3px;padding:0 4px;font-size:10px;color:var(--danger);">⌦</span>')
    .replace(/\[F(\d+)\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">F$1</span>')
    .replace(/\[([A-Z_]+)\]/g, '<span style="background:var(--bg-hover);border-radius:3px;padding:0 4px;font-size:10px;color:var(--text-muted);">$1</span>');
}
function fillClockInPanel(d, n, geo, sp, s) {
  const loc = geo.location || ((s.city && s.country) ? `${s.city}, ${s.country}` : s.city || s.country || '—');
  const pairs = [
    ['di-location', loc],
    ['di-latlon', (geo.latitude && geo.longitude) ? `${(+geo.latitude).toFixed(4)}, ${(+geo.longitude).toFixed(4)}` : '—'],
    ['di-ip', geo.ip || n.ip_address || '—'],
    ['di-connection', n.connection_type || '—'],
    ['di-ssid', n.ssid || 'Not detected'],
    ['di-mac', n.mac_address || '—'],
    ['di-device-name', d.device_name || '—'],
    ['di-os', d.os || '—'],
    ['di-cpu', d.cpu || '—'],
    ['di-ram', d.ram ? `RAM: ${d.ram}` : '—'],
    ['di-storage', (d.storage_total && d.storage_free) ? `${d.storage_free} GB free / ${d.storage_total} GB` : '—'],
    ['di-speed', sp.download ? `↓ ${sp.download} Mbps  ping ${sp.ping}ms` : '—'],
  ];
  pairs.forEach(([id, val]) => { const el = g(id); if (el) el.textContent = val; });
}

function setClocked(on) {
  g('session-dot').classList.toggle('active', on);
  g('status-dot').style.background = on ? 'var(--success)' : 'var(--text-muted)';
  g('session-status-text').textContent = on ? 'Session active' : 'Not clocked in';
  g('session-timer').classList.toggle('active', on);
  g('btn-clock-in').classList.toggle('hidden', on);
  g('btn-clock-out').classList.toggle('hidden', !on);
  if (!on) {
    g('session-timer').textContent = '00:00:00';
    g('session-meta').textContent = 'Clock in to start tracking';
  }
}

// ── Timer ─────────────────────────────────────────────────
function startTimer() { stopTimer(); timerInterval = setInterval(tick, 1000); tick(); }
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function tick() {
  if (!clockInTime) return;
  const el = g('session-timer');
  if (el) el.textContent = fmtDuration(Math.floor((Date.now() - clockInTime) / 1000));
}
async function refreshStats() {
  if (!await api.isClocked()) return;
  try {
    const s = await api.getTrackingStats();
    const idleSecs = s.idle || 0;

    // Active = total elapsed − idle time
    if (clockInTime) {
      const totalElapsed = Math.floor((Date.now() - clockInTime) / 1000);
      const activeSecs = Math.max(0, totalElapsed - idleSecs);
      const elActive = g('stat-active');
      if (elActive) elActive.textContent = sToHm(activeSecs);
    }

    const elIdle = g('stat-idle');
    if (elIdle) elIdle.textContent = sToHm(idleSecs);
  } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════
async function loadOverview() {
  try {
    const sessions = await api.getMySessions(10);
    const arr = Array.isArray(sessions) ? sessions : [];
    const tbody = g('recent-sessions-body');
    tbody.innerHTML = arr.length
      ? arr.slice(0, 5).map(s => `
          <tr>
            <td>${fmtDate(s.date || s.clock_in)}</td>
            <td class="td-mono">${fmtTime(s.clock_in)}</td>
            <td class="td-mono">${s.clock_out ? fmtTime(s.clock_out) : '<span class="text-success">Active</span>'}</td>
            <td>${sToHm(s.total_active_time)}</td>
            <td>${statusBadge(s.session_status)}</td>
          </tr>`).join('')
      : emptyRow(5, 'No sessions yet');

    // ── Org Stats Cards (Super Admin only) ────────────────
    const orgStatsContainer = g('org-stats-container');
    if (orgStatsContainer) {
      if (isAdmin) {
        orgStatsContainer.style.display = '';
        orgStatsContainer.innerHTML = `<div style="padding:20px;text-align:center;"><span class="spinner"></span></div>`;
        try {
          const [saRes, hrRes, mgrRes, empRes] = await Promise.all([
            api.listEmployees({ role: 'super_admin', active_only: 'false' }),
            api.listEmployees({ role: 'hr', active_only: 'false' }),
            api.listEmployees({ role: 'manager', active_only: 'false' }),
            api.listEmployees({ role: 'employee', active_only: 'false' }),
          ]);

          const saCount = (saRes && saRes.ok && Array.isArray(saRes.data)) ? saRes.data.length : 0;
          const hrCount = (hrRes && hrRes.ok && Array.isArray(hrRes.data)) ? hrRes.data.length : 0;
          const mgrCount = (mgrRes && mgrRes.ok && Array.isArray(mgrRes.data)) ? mgrRes.data.length : 0;
          const empCount = (empRes && empRes.ok && Array.isArray(empRes.data)) ? empRes.data.length : 0;
          const totalCount = saCount + hrCount + mgrCount + empCount;

          const statCards = [
            { icon: '🏢', label: 'Total Organization', value: totalCount, color: 'var(--accent)', border: 'var(--accent)' },
            { icon: '🛡️', label: 'Super Admins', value: saCount, color: 'var(--info)', border: 'var(--info)' },
            { icon: '👔', label: 'HRs', value: hrCount, color: 'var(--warning)', border: 'var(--warning)' },
            { icon: '🏢', label: 'Managers', value: mgrCount, color: 'var(--success)', border: 'var(--success)' },
            { icon: '👥', label: 'Employees', value: empCount, color: '#a78bfa', border: '#a78bfa' },
          ];

          orgStatsContainer.innerHTML = `
            <div style="
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
              gap: 14px;
              margin-bottom: 4px;
            ">
              ${statCards.map(c => `
                <div style="
                  background: var(--bg-surface);
                  border: 1px solid var(--border);
                  border-left: 4px solid ${c.border};
                  border-radius: var(--radius);
                  padding: 18px 20px;
                  display: flex;
                  flex-direction: column;
                  gap: 10px;
                  transition: border-color .2s, transform .15s;
                  cursor: default;
                "
                  onmouseenter="this.style.transform='translateY(-2px)';this.style.borderColor='${c.border}';"
                  onmouseleave="this.style.transform='translateY(0)';"
                >
                  <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="
                      font-size: 10px;
                      font-weight: 700;
                      text-transform: uppercase;
                      letter-spacing: .07em;
                      color: var(--text-muted);
                    ">${esc(c.label)}</div>
                    <div style="
                      width: 32px; height: 32px;
                      border-radius: var(--radius-sm);
                      background: ${c.border}22;
                      display: flex; align-items: center; justify-content: center;
                      font-size: 16px;
                    ">${c.icon}</div>
                  </div>
                  <div style="
                    font-size: 36px;
                    font-weight: 800;
                    color: ${c.color};
                    line-height: 1;
                    font-variant-numeric: tabular-nums;
                  ">${c.value}</div>
                  <div style="
                    font-size: 11px;
                    color: var(--text-muted);
                  ">Total registered</div>
                </div>
              `).join('')}
            </div>`;
        } catch (e) {
          orgStatsContainer.innerHTML = `<p class="text-muted" style="font-size:13px;">Could not load organization stats.</p>`;
        }
      } else {
        orgStatsContainer.style.display = 'none';
      }
    }

  } catch (e) { console.error('loadOverview:', e); }
}

// ══════════════════════════════════════════════════════════
// MY SESSIONS
// ══════════════════════════════════════════════════════════
async function loadMySessions() {
  const container = g('my-sessions-body');
  container.innerHTML = `<div style="padding:40px;text-align:center;"><span class="spinner"></span></div>`;

  try {
    const dateFilter = g('my-session-filter-date').value;
    const sessions = await api.getMySessions(200);
    let arr = Array.isArray(sessions) ? sessions : [];
    if (dateFilter) {
      arr = arr.filter(s => (s.date || (s.clock_in || '').substring(0, 10)) === dateFilter);
    }
    if (!arr.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><span class="empty-title">No sessions found</span></div>`;
      return;
    }

    // Keystroke totals
    const ksMap = {};
    try {
      const kr = await api.getAdminKeystrokes({ limit: '500' });
      if (kr && kr.ok && Array.isArray(kr.data)) {
        kr.data.forEach(k => {
          ksMap[k.session_id] = (ksMap[k.session_id] || 0) + (k.keys_pressed_count || 0);
        });
      }
    } catch { /* optional */ }

    // Group by date
    const grouped = {};
    arr.forEach(s => {
      const dateKey = (s.date || (s.clock_in || '').slice(0, 10) || 'Unknown').slice(0, 10);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(s);
    });

    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    container.innerHTML = sortedDates.map(dateKey => {
      const daySessions = grouped[dateKey];
      const dayActive = daySessions.reduce((a, s) => a + (s.total_active_time || 0), 0);
      const dayIdle = daySessions.reduce((a, s) => a + (s.total_idle_time || 0), 0);
      const dayTotal = dayActive + dayIdle;
      const dayKeys = daySessions.reduce((a, s) => a + (ksMap[s.session_id] || 0), 0);
      const firstClockin = daySessions[daySessions.length - 1]?.clock_in;
      const lastClockout = daySessions[0]?.clock_out;
      const hasActive = daySessions.some(s => s.session_status === 'active');
      const cardId = `my-day-sessions-${dateKey.replace(/-/g, '')}`;

      return `
          <div class="hover-border" style="
            background:var(--bg-surface);
            border:1px solid var(--border);
            border-radius:var(--radius-lg);
            overflow:hidden;
          ">
          <!-- Card Header -->
          <div style="
            background:var(--bg-raised);
            border-bottom:1px solid var(--border);
            padding:16px 20px;
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            flex-wrap:wrap;
          ">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="
                width:36px;height:36px;border-radius:var(--radius-sm);
                background:var(--accent-dim);border:1px solid var(--accent);
                display:flex;align-items:center;justify-content:center;
                font-size:16px;
              ">📅</div>
              <div>
                <div style="font-size:15px;font-weight:700;color:var(--text-primary);">
                  ${fmtDate(dateKey)}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                  ${daySessions.length} session${daySessions.length !== 1 ? 's' : ''} this day
                </div>
              </div>
            </div>
            ${hasActive
          ? `<span class="badge badge-success">🟢 Active Now</span>`
          : `<span class="badge badge-muted">Completed</span>`}
          </div>

          <!-- Card Body -->
          <div style="padding:16px 20px;">
            <div style="
              display:grid;
              grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
              gap:12px;
              margin-bottom:16px;
            ">
              <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">🕐 Clock In</div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);font-family:var(--font-mono);">
                  ${firstClockin ? fmtTime(firstClockin) : '—'}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">🕑 Clock Out</div>
                <div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:${hasActive ? 'var(--success)' : 'var(--text-primary)'};">
                  ${hasActive ? 'Active' : (lastClockout ? fmtTime(lastClockout) : '—')}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⏱ Total Time</div>
                <div style="font-size:13px;font-weight:700;color:var(--accent);">
                  ${sToHm(dayTotal)}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--success);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⚡ Active Time</div>
                <div style="font-size:13px;font-weight:700;color:var(--success);">
                  ${sToHm(dayActive)}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--warning);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">💤 Idle Time</div>
                <div style="font-size:13px;font-weight:700;color:var(--warning);">
                  ${sToHm(dayIdle)}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⌨️ Keystrokes</div>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">
                  ${dayKeys.toLocaleString()}
                </div>
              </div>

              <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">📋 Sessions</div>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">
                  ${daySessions.length}
                </div>
              </div>
            </div>

            <!-- View Sessions Button -->
            <div style="display:flex;justify-content:flex-end;">
              <button
                class="btn btn-ghost btn-sm"
                data-action="toggle-day-sessions"
                data-card-id="${cardId}"
                style="display:flex;align-items:center;gap:6px;"
              >
                📂 View Sessions
              </button>
            </div>

            <!-- Expandable Sessions Table -->
            <div id="${cardId}" class="hidden" style="margin-top:14px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:10px;">
                All Sessions on ${fmtDate(dateKey)}
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Clock In</th>
                      <th>Clock Out</th>
                      <th>Active</th>
                      <th>Idle</th>
                      <th>Keystrokes</th>
                      <th>Status</th>
                      <th>View</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${daySessions.map((s, idx) => `
                      <tr>
                        <td class="td-muted">${idx + 1}</td>
                        <td class="td-mono">${fmtTime(s.clock_in)}</td>
                        <td class="td-mono">
                          ${s.clock_out
              ? fmtTime(s.clock_out)
              : '<span class="text-success">Active</span>'}
                        </td>
                        <td class="text-success">${sToHm(s.total_active_time)}</td>
                        <td class="text-warning">${sToHm(s.total_idle_time)}</td>
                        <td>${(ksMap[s.session_id] || 0).toLocaleString()}</td>
                        <td>${statusBadge(s.session_status)}</td>
                        <td>
                          <button class="btn btn-ghost btn-sm"
                                  data-action="view-session"
                                  data-sid="${esc(s.session_id)}"
                                  data-page="my-sessions"
                                  data-back="my-sessions-list">
                            View
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>`;
    }).join('');

  } catch (e) {
    console.error('loadMySessions:', e);
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><span class="empty-title">Error loading sessions: ${esc(e.message)}</span></div>`;
  }
}
// ══════════════════════════════════════════════════════════
// SETTINGS — VERSION HISTORY
// ══════════════════════════════════════════════════════════
async function loadSettings() {
  const container = g('settings-version-content');
  if (!container) return;

  // Reset to card view every time settings is opened
  container.innerHTML = `<div style="padding:40px;text-align:center;"><span class="spinner"></span></div>`;

  try {
    const info = await api.getAppVersion();
    const current = info.current || '1.0.14';
    const history = info.history || [];
    const latest = history[0] || {};
    const latestClean = info.updateAvailableVersion
      ? info.updateAvailableVersion
      : (latest.version || '').replace('v', '');
    const isOutdated = latestClean && current !== latestClean;

    // ── CARD VIEW (default) ────────────────────────────────
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;max-width:480px;">

        <!-- Version Card -->
<div id="version-summary-card" class="version-card">
          <!-- Glow -->
          <div style="
            position:absolute;top:-50px;right:-50px;width:180px;height:180px;border-radius:50%;
            background:radial-gradient(circle, rgba(108,99,255,.2) 0%, transparent 65%);
            pointer-events:none;
          "></div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:16px;">🚀</span>
                <span style="
                  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
                  color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent);
                  padding:2px 8px;border-radius:999px;
                ">Current Version</span>
              </div>
              <div style="font-size:28px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">
                v${esc(current)}
              </div>
              ${latest.date ? `
              <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                📅 Released: <strong style="color:var(--text-primary);">${fmtSettingsDate(latest.date)}</strong>
              </div>` : ''}
            </div>

            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
              ${isOutdated ? `
              <div style="
              background:rgba(245,158,11,.15);border:1px solid var(--warning);
                border-radius:var(--radius);padding:8px 14px;text-align:center;
              ">
                <div style="font-size:10px;color:var(--warning);font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Update Available</div>
                <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:var(--text-primary);margin-top:2px;">v${esc(latestClean)}</div>
                <div style="margin-top:8px;">
                  ${info.updateDownloaded
          ? `<button id="btn-install-now-card" class="btn btn-success btn-sm" style="width:100%;">⚡ Install Now</button>`
          : `<button id="btn-download-card" class="btn btn-primary btn-sm" style="width:100%;">⬇ Download</button>`
        }
                </div>
              </div>
              ` : `
              <div style="
                background:var(--success-dim);border:1px solid var(--success);
                border-radius:var(--radius);padding:8px 14px;text-align:center;
              ">
                <div style="font-size:10px;color:var(--success);font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Status</div>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-top:2px;">✅ Up to date</div>
              </div>
              `}
              <div style="font-size:11px;color:var(--accent);display:flex;align-items:center;gap:4px;">
                View full changelog <span style="font-size:14px;">→</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Update available detail (only if outdated) -->
        ${isOutdated ? `
        <div style="
          background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);
          border-radius:var(--radius);padding:16px 20px;
        ">
          <div style="font-size:12px;font-weight:700;color:var(--warning);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">
            ⚠ v${esc(latestClean)} is available — you are on v${esc(current)}
          </div>
          ${latest.changes && latest.changes.length ? `
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${latest.changes.map(c => `
              <div style="display:flex;align-items:flex-start;gap:8px;">
                <span style="color:var(--warning);font-size:12px;margin-top:1px;">◆</span>
                <span style="font-size:12px;color:var(--text-secondary);">${esc(c)}</span>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
        ` : ''}

      </div>`;

    // ── Click card → show full changelog ──────────────────
    g('version-summary-card').addEventListener('click', () => {
      showFullChangelog(current, history, info.updateDownloaded, info.updateAvailableVersion);
    });
    // Wire download/install buttons on card view
    const dlCardBtn = g('btn-download-card');
    if (dlCardBtn) dlCardBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent card click opening changelog
      handleDownloadUpdate(dlCardBtn);
    });

    const installCardBtn = g('btn-install-now-card');
    if (installCardBtn) installCardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      api.installUpdate();
    });

  } catch (e) {
    container.innerHTML = `<p class="text-muted" style="padding:20px;">Error loading version info: ${esc(e.message)}</p>`;
  }
}

// ── Full Changelog View ───────────────────────────────────
function showFullChangelog(current, history, updateDownloaded = false, updateAvailableVersion = null) {
  const container = g('settings-version-content');
  const latest = history[0] || {};
  const older = history.slice(1);
  const latestClean = updateAvailableVersion
    ? updateAvailableVersion
    : (latest.version || '').replace('v', '');
  const isOutdated = latestClean && current !== latestClean;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:24px;">

      <!-- Back button -->
      <div>
        <button id="btn-back-settings" class="back-btn">← Back to Settings</button>
      </div>

      <!-- ── SECTION 1: Latest Version (only if update available) ── -->
      ${isOutdated ? `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--warning);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span>🆕</span> Latest Version
        </div>
        <div style="
          background: rgba(245,158,11,.08);
          border: 1px solid rgba(245,158,11,.4);
          border-left: 4px solid var(--warning);
          border-radius: var(--radius);
          padding: 20px 24px;
        ">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
            <div>
              <div style="font-size:28px;font-weight:800;font-family:var(--font-mono);color:var(--warning);">
                v${esc(latestClean)}
              </div>
              ${latest.date ? `
              <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                📅 Released: <strong style="color:var(--text-primary);">${fmtSettingsDate(latest.date)}</strong>
              </div>` : ''}
              ${latest.changes && latest.changes.length ? `
              <div style="margin-top:14px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;">What's New</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${latest.changes.map(c => `
                    <div style="display:flex;align-items:flex-start;gap:8px;">
                      <span style="color:var(--warning);font-size:12px;margin-top:2px;">◆</span>
                      <span style="font-size:13px;color:var(--text-primary);">${esc(c)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end;">
              <div style="
                background:rgba(245,158,11,.15);
                border:1px solid var(--warning);
                border-radius:var(--radius-sm);
                padding:6px 12px;
                font-size:11px;font-weight:700;
                color:var(--warning);
                text-transform:uppercase;letter-spacing:.06em;
              ">⚠ Update Available</div>
              ${updateDownloaded
        ? `<button id="btn-install-now" class="btn btn-success">⚡ Install & Restart</button>`
        : `<button id="btn-download-update" class="btn btn-primary">⬇ Download Update</button>`}
            </div>
          </div>
        </div>
      </div>` : ''}

      <!-- ── SECTION 2: Current Version ── -->
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span>💻</span> Current Version
        </div>
        <div style="
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-left: 4px solid ${isOutdated ? 'var(--text-muted)' : 'var(--success)'};
          border-radius: var(--radius);
          padding: 20px 24px;
          display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
        ">
          <div>
            <div style="font-size:28px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);">
              v${esc(current)}
            </div>
            ${isOutdated
      ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">A newer version is available above</div>`
      : `<div style="font-size:12px;color:var(--success);margin-top:4px;">✅ You are on the latest version</div>`}
          </div>
          <div style="
            background: ${isOutdated ? 'rgba(255,255,255,.05)' : 'var(--success-dim)'};
            border: 1px solid ${isOutdated ? 'var(--border)' : 'var(--success)'};
            border-radius: var(--radius-sm);
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 700;
            color: ${isOutdated ? 'var(--text-muted)' : 'var(--success)'};
          ">
            ${isOutdated ? 'Outdated' : '✅ Up to date'}
          </div>
        </div>
      </div>

      <!-- ── SECTION 3: Version History ── -->
      ${history.length ? `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span>📦</span> Version History
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${history.map(v => {
        const vClean = v.version.replace('v', '');
        const isCurrent = vClean === current;
        return `
            <div style="
              background: var(--bg-surface);
              border: 1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'};
              border-left: 3px solid ${isCurrent ? 'var(--accent)' : 'var(--border-light)'};
              border-radius: var(--radius);
              padding: 16px 20px;
              transition: border-color .15s;
            ">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:${v.changes && v.changes.length ? '12px' : '0'};">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="font-size:16px;font-weight:700;font-family:var(--font-mono);color:${isCurrent ? 'var(--accent)' : 'var(--text-primary)'};">
                    v${esc(vClean)}
                  </div>
                  ${isCurrent ? `<span style="
                    font-size:10px;font-weight:600;
                    background:var(--accent-dim);border:1px solid var(--accent);
                    color:var(--accent);padding:2px 8px;border-radius:999px;
                  ">Current</span>` : `<span style="
                    font-size:10px;font-weight:600;
                    background:var(--bg-raised);border:1px solid var(--border-light);
                    color:var(--text-muted);padding:2px 8px;border-radius:999px;
                  ">Previous</span>`}
                </div>
                <div style="font-size:12px;color:var(--text-muted);">
                  📅 ${v.date ? fmtSettingsDate(v.date) : '—'}
                </div>
              </div>
              ${v.changes && v.changes.length ? `
              <div style="display:flex;flex-direction:column;gap:5px;">
                ${v.changes.map(c => `
                  <div style="display:flex;align-items:flex-start;gap:8px;">
                    <span style="color:var(--text-muted);font-size:12px;margin-top:2px;">▸</span>
                    <span style="font-size:12px;color:var(--text-secondary);">${esc(c)}</span>
                  </div>
                `).join('')}
              </div>` : ''}
            </div>`;
      }).join('')}
        </div>
      </div>` : ''}

      <!-- Footer -->
      <div style="
        background:var(--bg-surface);border:1px solid var(--border);
        border-radius:var(--radius);padding:14px 20px;
        display:flex;gap:24px;flex-wrap:wrap;align-items:center;
      ">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:2px;">Product</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">AV DEVS Collab</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:2px;">Installed</div>
          <div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:var(--text-primary);">v${esc(current)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:2px;">Latest</div>
          <div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:${isOutdated ? 'var(--warning)' : 'var(--success)'};">v${esc(latestClean || current)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:2px;">Developer</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">AvDevs</div>
        </div>
      </div>

    </div>`;

  g('btn-back-settings').addEventListener('click', () => loadSettings());

  const dlBtn = g('btn-download-update');
  if (dlBtn) dlBtn.addEventListener('click', () => handleDownloadUpdate(dlBtn));

  const installBtn = g('btn-install-now');
  if (installBtn) installBtn.addEventListener('click', () => api.installUpdate());
}

function fmtSettingsDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch { return dateStr; }
}
g('btn-refresh-my-sessions').addEventListener('click', loadMySessions);
g('my-session-filter-date').addEventListener('change', loadMySessions);

// ── Single delegated click handler for ALL view buttons ──
document.addEventListener('click', async function (e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const sid = btn.dataset.sid;
  const pageId = btn.dataset.page;
  const backSub = btn.dataset.back;
  const empId = btn.dataset.empId;
  const empName = btn.dataset.empName;

  if (action === 'view-session' && sid && pageId && backSub) {
    openSessionDetail(sid, pageId, backSub);
  }
  if (action === 'edit-user' && empId) {
    openEditUserModal(empId, btn.dataset.empName, btn.dataset.empEmail, btn.dataset.empDept, btn.dataset.empRole, btn.dataset.empManager);
  }
  if (action === 'view-user' && empId && empName && pageId) {
    openUserSessions(empId, empName, pageId);
  }
  if (action === 'view-user-session' && sid && pageId && backSub) {
    openSessionDetail(sid, pageId, backSub);
  }
  if (action === 'remove-user') {
    const empId = btn.dataset.empId;
    const empName = btn.dataset.empName;
    const isActive = btn.dataset.empStatus === 'true';
    const actionStr = isActive ? 'deactivate' : 'reactivate';

    if (!confirm(`Are you sure you want to ${actionStr} ${empName}?`)) return;

    btn.disabled = true;
    btn.textContent = isActive ? 'Deactivating…' : 'Activating…';

    try {
      const r = isActive
        ? await api.deactivateEmployee(empId)
        : await api.reactivateEmployee(empId);

      if (r && (r.ok || r.status === 204)) {
        // Refresh the current page
        const activePage = document.querySelector('.page-view.active');
        if (activePage) {
          const pageId = activePage.id.replace('page-', '');
          switchPage(pageId);
        }
      } else {
        alert('Action failed. Please try again.');
        btn.disabled = false;
        btn.textContent = isActive ? 'Deactivate' : 'Activate';
      }
    } catch (e) {
      alert('Error: ' + e.message);
      btn.disabled = false;
      btn.textContent = isActive ? 'Deactivate' : 'Activate';
    }
  }
  if (action === 'toggle-day-sessions') {
    const cardId = btn.dataset.cardId;
    const section = document.getElementById(cardId);
    if (!section) return;
    const isHidden = section.classList.contains('hidden');
    section.classList.toggle('hidden');
    btn.textContent = isHidden ? '📂 Hide Sessions' : '📂 View Sessions';
  }
  if (action === 'back-to-sub') {
    const targetPage = btn.dataset.targetPage;
    const targetSub = btn.dataset.targetSub;
    if (targetPage && targetSub) showSub(targetPage, targetSub);
  }
  if (action === 'open-keystrokes') {
    openKeystrokesPage(sid, pageId, backSub);
  }
  if (action === 'open-netspeed') {
    openNetSpeedPage(sid, pageId, backSub);
  }
  if (action === 'open-activity') {
    openActivityPage(sid, pageId, backSub);
  }
});

async function openEditUserModal(id, name, email, dept, role, currentManagerId) {
  editingEmployeeId = id;
  g('modal-emp-title').textContent = 'Edit Employee';
  g('emp-name').value = name;
  g('emp-email').value = email;
  g('emp-email').disabled = true;
  g('emp-department').value = dept || '';
  g('emp-role').value = role;
  g('emp-password-group').style.display = 'none';
  g('modal-emp-alert').classList.add('hidden');

  // Always show manager group when editing an employee
  const managerGroup = g('emp-manager-group');
  if (managerGroup) {
    managerGroup.style.display = 'block';
    await populateManagerDropdown();
    // Pre-select current manager
    const sel = g('emp-manager-id');
    if (sel && currentManagerId) sel.value = currentManagerId;
  }

  // Restrict role options based on current user
  const roleEl = g('emp-role');
  if (roleEl) {
    const allowed = {
      super_admin: ['super_admin', 'hr', 'manager', 'employee'],
      hr: ['hr', 'manager', 'employee'],
      manager: ['employee'],
    }[currentEmployee?.role] || [];
    Array.from(roleEl.options).forEach(opt => {
      opt.disabled = !allowed.includes(opt.value);
    });
  }

  g('modal-employee').classList.remove('hidden');
}

async function handleDownloadUpdate(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Downloading…';
  btn.style.cursor = 'not-allowed';

  try {
    const r = await api.downloadUpdate();
    if (r && r.ok) {
      btn.innerHTML = '⚡ Install & Restart';
      btn.disabled = false;
      btn.style.cursor = 'pointer';
      btn.className = 'btn btn-success btn-sm';
      btn.style.width = '100%';
      btn.onclick = () => api.installUpdate();
    } else {
      btn.innerHTML = '❌ ' + (r?.error || 'Failed');
      btn.disabled = false;
      btn.style.cursor = 'pointer';
      setTimeout(() => {
        btn.innerHTML = '⬇ Retry Download';
        btn.className = 'btn btn-primary btn-sm';
      }, 3000);
    }
  } catch (e) {
    btn.innerHTML = '❌ Error';
    btn.disabled = false;
    btn.style.cursor = 'pointer';
  }
}

async function openActivityPage(sessionId, pageId, backDetailSubId) {
  const actSubId =
    pageId === 'my-sessions' ? 'my-session-activity'
      : pageId === 'super-admins' ? 'super-admin-session-activity'
        : pageId === 'hrs' ? 'hr-session-activity'
          : pageId === 'managers' ? 'manager-session-activity'
            : pageId === 'my-employees' ? 'my-emp-session-activity'
              : 'emp-session-activity';
  const container = g(actSubId);
  if (!container) return;
  container.innerHTML = spinHtml();
  showSub(pageId, actSubId);

  try {
    // Fetch both activity logs and website logs in parallel
    const [actR, webR] = await Promise.all([
      api.getAdminActivity({ session_id: sessionId, limit: '500' }),
      api.getAdminWebsite({ session_id: sessionId, limit: '500' }),
    ]);

    const actRows = (actR && actR.ok && Array.isArray(actR.data)) ? actR.data : [];
    const webRows = (webR && webR.ok && Array.isArray(webR.data)) ? webR.data : [];

    // ── Stats ──────────────────────────────────────────────
    const totalAppTime = actRows.reduce((a, r) => a + (r.duration || 0), 0);
    const totalWebTime = webRows.reduce((a, r) => a + (r.duration || 0), 0);
    const uniqueApps = new Set(actRows.map(r => r.app_name)).size;
    const uniqueDomains = new Set(webRows.map(r => r.domain)).size;

    // ── Top apps aggregation ───────────────────────────────
    const appMap = {};
    actRows.forEach(r => {
      const app = r.app_name || 'Unknown';
      if (!appMap[app]) appMap[app] = { name: app, duration: 0, count: 0 };
      appMap[app].duration += r.duration || 0;
      appMap[app].count++;
    });
    const topApps = Object.values(appMap)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    // ── Top domains aggregation ────────────────────────────
    const domainMap = {};
    webRows.forEach(r => {
      const domain = r.domain || 'Unknown';
      if (!domainMap[domain]) domainMap[domain] = { domain, duration: 0, count: 0, title: r.title || '' };
      domainMap[domain].duration += r.duration || 0;
      domainMap[domain].count++;
    });
    const topDomains = Object.values(domainMap)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    const maxAppDur = topApps.length ? Math.max(...topApps.map(a => a.duration)) : 1;
    const maxDomainDur = topDomains.length ? Math.max(...topDomains.map(d => d.duration)) : 1;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="back-btn"
                  data-action="back-to-sub"
                  data-target-page="${pageId}"
                  data-target-sub="${backDetailSubId}">
            ← Back to Session
          </button>
          <div>
            <div class="page-title">🌐 Activity Tracking</div>
            <div class="page-subtitle">
              App usage &amp; website visits for this session
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));">
          <div class="stat-card accent">
            <div class="stat-label">App Time</div>
            <div class="stat-value" style="font-size:20px;">${sToHm(totalAppTime)}</div>
            <div class="stat-sub">${uniqueApps} unique apps</div>
          </div>
          <div class="stat-card success">
            <div class="stat-label">Web Time</div>
            <div class="stat-value" style="font-size:20px;">${sToHm(totalWebTime)}</div>
            <div class="stat-sub">${uniqueDomains} unique sites</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">App Switches</div>
            <div class="stat-value" style="font-size:20px;">${actRows.length}</div>
            <div class="stat-sub">Total events</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-label">Website Visits</div>
            <div class="stat-value" style="font-size:20px;">${webRows.length}</div>
            <div class="stat-sub">Total visits</div>
          </div>
        </div>

        <!-- Top Apps -->
        ${topApps.length ? `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">💻 Top Applications</div>
              <div class="card-subtitle">Most used apps this session</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${topApps.map(app => `
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="
                  min-width:140px;
                  font-size:13px;
                  font-weight:600;
                  color:var(--text-primary);
                  overflow:hidden;
                  text-overflow:ellipsis;
                  white-space:nowrap;
                ">${esc(app.name)}</div>
                <div style="flex:1;">
                  <div class="progress-bar">
                    <div class="progress-fill accent"
                         style="width:${Math.round((app.duration / maxAppDur) * 100)}%;">
                    </div>
                  </div>
                </div>
                <div style="min-width:60px;text-align:right;font-size:12px;color:var(--text-secondary);">
                  ${sToHm(app.duration)}
                </div>
                <div style="min-width:50px;text-align:right;font-size:11px;color:var(--text-muted);">
                  ${app.count}x
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- Top Websites -->
        ${topDomains.length ? `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🌐 Top Websites</div>
              <div class="card-subtitle">Most visited websites this session</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${topDomains.map(d => `
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="
                  min-width:160px;
                  font-size:13px;
                  font-weight:600;
                  color:var(--accent);
                  overflow:hidden;
                  text-overflow:ellipsis;
                  white-space:nowrap;
                ">${esc(d.domain)}</div>
                <div style="flex:1;">
                  <div class="progress-bar">
                    <div class="progress-fill success"
                         style="width:${Math.round((d.duration / maxDomainDur) * 100)}%;">
                    </div>
                  </div>
                </div>
                <div style="min-width:60px;text-align:right;font-size:12px;color:var(--text-secondary);">
                  ${sToHm(d.duration)}
                </div>
                <div style="min-width:50px;text-align:right;font-size:11px;color:var(--text-muted);">
                  ${d.count}x
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- Detailed App Log Table -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📋 Detailed App Activity Log</div>
            <div class="card-subtitle">${actRows.length} events recorded</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>#</th>
                <th>Application</th>
                <th>Window Title</th>
                <th>Duration</th>
                <th>Start Time</th>
                <th>End Time</th>
              </tr></thead>
              <tbody>
                ${actRows.length
        ? actRows.map((r, i) => `
                    <tr>
                      <td class="td-muted">${i + 1}</td>
                      <td><strong>${esc(r.app_name || '—')}</strong></td>
                      <td class="td-muted" style="max-width:250px;">
                        <div class="truncate">${esc(r.window_title || '—')}</div>
                      </td>
                      <td class="text-success">${sToHm(r.duration || 0)}</td>
                      <td class="td-mono td-muted">${fmtDateTime(r.start_time)}</td>
                      <td class="td-mono td-muted">${fmtDateTime(r.end_time)}</td>
                    </tr>`).join('')
        : emptyRow(6, 'No app activity recorded for this session')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Detailed Website Log Table -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🌍 Detailed Website Activity Log</div>
            <div class="card-subtitle">${webRows.length} visits recorded</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>#</th>
                <th>Domain</th>
                <th>Page Title</th>
                <th>Duration</th>
                <th>Visited At</th>
              </tr></thead>
              <tbody>
                ${webRows.length
        ? webRows.map((r, i) => `
                    <tr>
                      <td class="td-muted">${i + 1}</td>
                      <td>
                        <span style="color:var(--accent);font-weight:600;">
                          ${esc(r.domain || '—')}
                        </span>
                      </td>
                      <td class="td-muted" style="max-width:300px;">
                        <div class="truncate">${esc(r.title || '—')}</div>
                      </td>
                      <td class="text-success">${sToHm(r.duration || 0)}</td>
                      <td class="td-mono td-muted">${fmtDateTime(r.timestamp)}</td>
                    </tr>`).join('')
        : emptyRow(5, 'No website activity recorded for this session')}
              </tbody>
            </table>
          </div>
        </div>

      </div>`;

  } catch (e) {
    container.innerHTML = `
      <div style="padding:20px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${backDetailSubId}">
          ← Back
        </button>
        <p class="text-muted" style="margin-top:12px;">Error: ${esc(e.message)}</p>
      </div>`;
  }
}
// ══════════════════════════════════════════════════════════
// SESSION DETAIL
// ══════════════════════════════════════════════════════════
async function openSessionDetail(sessionId, pageId, backSubId) {
  const detailSubId =
    pageId === 'my-sessions' ? 'my-session-detail'
      : pageId === 'super-admins' ? 'super-admin-session-detail'
        : pageId === 'hrs' ? 'hr-session-detail'
          : pageId === 'managers' ? 'manager-session-detail'
            : pageId === 'my-employees' ? 'my-emp-session-detail'
              : 'emp-session-detail';

  const container = g(detailSubId);
  if (!container) {
    console.error('openSessionDetail: container not found:', detailSubId);
    return;
  }

  container.innerHTML = spinHtml();
  showSub(pageId, detailSubId);

  try {
    // ── 1. Get session data ────────────────────────────
    let session = null;
    const sidStr = String(sessionId).toLowerCase().trim();

    // Try own sessions first
    try {
      const ownSessions = await api.getMySessions(200);
      if (Array.isArray(ownSessions)) {
        session = ownSessions.find(s => String(s.session_id).toLowerCase().trim() === sidStr) || null;
      }
    } catch (err) { console.warn('getMySessions err:', err); }

    // Admin fallback
    if (!session && (isAdmin || isHR || isManager)) {
      try {
        const r = await api.getAdminSessions({ limit: '200' });
        if (r && r.ok && Array.isArray(r.data)) {
          session = r.data.find(s => String(s.session_id).toLowerCase().trim() === sidStr) || null;
        }
      } catch (err) { console.warn('getAdminSessions err:', err); }
    }

    // ── 2. Keystroke total ─────────────────────────────
    let totalKeys = 0;
    try {
      const kr = await api.getAdminKeystrokes({ session_id: sessionId, limit: '500' });
      if (kr && kr.ok && Array.isArray(kr.data)) {
        totalKeys = kr.data.reduce((a, k) => a + (k.keys_pressed_count || 0), 0);
      }
    } catch { /* optional */ }

    // ── 3. Render ──────────────────────────────────────
    const ci = session ? fmtTime(session.clock_in) : '—';
    const co = session
      ? (session.clock_out ? fmtTime(session.clock_out) : '<span class="text-success">Active</span>')
      : '—';
    const at = session ? sToHm(session.total_active_time) : '—';
    const it = session ? sToHm(session.total_idle_time) : '—';
    const dt = session ? fmtDate(session.date || session.clock_in) : '—';
    const lo = session ? esc(locStr(session)) : '—';
    const ip = session ? esc(session.ip_address || '—') : '—';
    const lat = session && session.latitude ? (+session.latitude).toFixed(6) : null;
    const lon = session && session.longitude ? (+session.longitude).toFixed(6) : null;
    const cds = (lat && lon) ? `${lat}, ${lon}` : '—';
    const city = session ? esc(session.city || '—') : '—';
    const country = session ? esc(session.country || '—') : '—';
    const netSpeedStart = session && session.network_speed_start
      ? `${session.network_speed_start} Mbps` : '—';

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">

        <div style="display:flex;align-items:center;gap:12px;">
          <button class="back-btn"
                  data-action="back-to-sub"
                  data-target-page="${pageId}"
                  data-target-sub="${backSubId}">
            ← Back
          </button>
          <div>
            <div class="page-title">Session Detail</div>
            <div class="page-subtitle">${dt}</div>
          </div>
        </div>

        <!-- ── Summary tiles ── -->
        <div class="detail-grid">
          <div class="detail-tile">
            <div class="detail-tile-label">🕐 Clock In</div>
            <div class="detail-tile-value">${ci}</div>
          </div>
          <div class="detail-tile">
            <div class="detail-tile-label">🕑 Clock Out</div>
            <div class="detail-tile-value">${co}</div>
          </div>
          <div class="detail-tile">
            <div class="detail-tile-label">⚡ Active Time</div>
            <div class="detail-tile-value text-success">${at}</div>
          </div>
          <div class="detail-tile">
            <div class="detail-tile-label">💤 Idle Time</div>
            <div class="detail-tile-value text-warning">${it}</div>
          </div>
${isAdmin ? `
          <div class="detail-tile clickable"
               data-action="open-keystrokes"
               data-sid="${sessionId}"
               data-page="${pageId}"
               data-back="${detailSubId}">
            <div class="detail-tile-label">⌨️ Total Keystrokes</div>
            <div class="detail-tile-value">${totalKeys.toLocaleString()}</div>
            <div class="detail-tile-sub" style="color:var(--accent);margin-top:4px;">
              Click to view raw keystroke logs →
            </div>
          </div>
          <div class="detail-tile clickable"
               data-action="open-activity"
               data-sid="${sessionId}"
               data-page="${pageId}"
               data-back="${detailSubId}">
            <div class="detail-tile-label">🌐 Activity Tracking</div>
            <div class="detail-tile-value">View Logs</div>
            <div class="detail-tile-sub" style="color:var(--accent);margin-top:4px;">
              Click to view app &amp; website logs →
            </div>
          </div>
          ` : `
          `}
          <div class="detail-tile clickable"
               data-action="open-netspeed"
               data-sid="${sessionId}"
               data-page="${pageId}"
               data-back="${detailSubId}">
            <div class="detail-tile-label">📶 Network Speed History</div>
            <div class="detail-tile-value">View Logs</div>
            <div class="detail-tile-sub" style="color:var(--accent);margin-top:4px;">
              Click to view speed logs →
            </div>
          </div>
          <div class="detail-tile">
            <div class="detail-tile-label">🚀 Speed at Clock-In</div>
            <div class="detail-tile-value">${netSpeedStart}</div>
          </div>
          <div class="detail-tile">
            <div class="detail-tile-label">📋 Session Status</div>
            <div class="detail-tile-value">${session ? statusBadge(session.session_status) : '—'}</div>
          </div>
        </div>

        <!-- ── Location ── -->
        <div>
          <div class="section-title">📍 Location Information</div>
          <div class="detail-grid">
            <div class="detail-tile">
              <div class="detail-tile-label">City</div>
              <div class="detail-tile-value">${city}</div>
            </div>
            <div class="detail-tile">
              <div class="detail-tile-label">Country</div>
              <div class="detail-tile-value">${country}</div>
            </div>
            <div class="detail-tile">
              <div class="detail-tile-label">Location</div>
              <div class="detail-tile-value">${lo || '—'}</div>
            </div>
            <div class="detail-tile">
              <div class="detail-tile-label">IP Address</div>
              <div class="detail-tile-value" style="font-family:var(--font-mono);">${ip}</div>
            </div>
            <div class="detail-tile">
              <div class="detail-tile-label">GPS Coordinates</div>
              <div class="detail-tile-value" style="font-family:var(--font-mono);font-size:12px;">${cds}</div>
              ${(lat && lon) ? `<div class="detail-tile-sub" style="margin-top:4px;">
                <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank"
                   style="color:var(--accent);font-size:11px;">Open in Maps ↗</a>
              </div>` : ''}
            </div>
          </div>
        </div>

        <!-- ── Device Info (async) ── -->
        <div id="dev-sec-${sessionId}">
          <div class="section-title">💻 Device Information</div>
          ${spinHtml()}
        </div>

        <!-- ── Network Info (async) ── -->
        <div id="net-sec-${sessionId}">
          <div class="section-title">🌐 Network Information</div>
          ${spinHtml()}
        </div>

      </div>`;

    // Load device + network info asynchronously
    loadDeviceSec(sessionId);
    loadNetworkSec(sessionId);

  } catch (e) {
    console.error('openSessionDetail error:', e);
    container.innerHTML = `
      <div style="padding:20px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${backSubId}">
          ← Back
        </button>
        <p class="text-muted" style="margin-top:16px;">
          Error loading session: ${esc(e.message)}
        </p>
      </div>`;
  }
}

// ── Device info ───────────────────────────────────────────
async function loadDeviceSec(sessionId) {
  const sec = g(`dev-sec-${sessionId}`);
  if (!sec) return;
  try {
    const r = await api.getAdminDeviceInfo({ session_id: sessionId, limit: '1' });
    const d = (r && r.ok && Array.isArray(r.data) && r.data[0]) ? r.data[0] : null;
    if (!d) {
      sec.innerHTML = `<div class="section-title">💻 Device Information</div>
        <p class="text-muted" style="font-size:13px;padding:8px 0;">No device info recorded for this session.</p>`;
      return;
    }
    sec.innerHTML = `
      <div class="section-title">💻 Device Information</div>
      <div class="detail-grid">
        <div class="detail-tile">
          <div class="detail-tile-label">Device Name</div>
          <div class="detail-tile-value">${esc(d.device_name || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">Operating System</div>
          <div class="detail-tile-value">${esc(d.os || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">CPU</div>
          <div class="detail-tile-value" style="font-size:12px;">${esc(d.cpu || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">RAM</div>
          <div class="detail-tile-value">${esc(d.ram || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">Storage</div>
          <div class="detail-tile-value">
            ${d.storage_total ? `${d.storage_free} GB free / ${d.storage_total} GB total` : '—'}
          </div>
          ${d.storage_total ? `<div class="detail-tile-sub" style="margin-top:6px;">
            <div class="progress-bar">
              <div class="progress-fill ${cpuCls(Math.round(((d.storage_total - d.storage_free) / d.storage_total) * 100))}"
                   style="width:${Math.min(Math.round(((d.storage_total - d.storage_free) / d.storage_total) * 100), 100)}%"></div>
            </div>
            <span style="font-size:10px;color:var(--text-muted);margin-top:2px;display:block;">
              ${Math.round(((d.storage_total - d.storage_free) / d.storage_total) * 100)}% used
            </span>
          </div>` : ''}
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">Device ID</div>
          <div class="detail-tile-value" style="font-family:var(--font-mono);font-size:11px;word-break:break-all;">
            ${esc(d.device_id || '—')}
          </div>
        </div>
      </div>`;
  } catch {
    const sec2 = g(`dev-sec-${sessionId}`);
    if (sec2) sec2.innerHTML = `<div class="section-title">💻 Device Information</div>
      <p class="text-muted" style="font-size:13px;padding:8px 0;">Could not load device info.</p>`;
  }
}

// ── Network info ──────────────────────────────────────────
async function loadNetworkSec(sessionId) {
  const sec = g(`net-sec-${sessionId}`);
  if (!sec) return;
  try {
    const r = await api.getAdminNetworkInfo({ session_id: sessionId, limit: '1' });
    const n = (r && r.ok && Array.isArray(r.data) && r.data[0]) ? r.data[0] : null;
    if (!n) {
      sec.innerHTML = `<div class="section-title">🌐 Network Information</div>
        <p class="text-muted" style="font-size:13px;padding:8px 0;">No network info recorded for this session.</p>`;
      return;
    }
    sec.innerHTML = `
      <div class="section-title">🌐 Connected Network Information</div>
      <div class="detail-grid">
        <div class="detail-tile">
          <div class="detail-tile-label">IP Address</div>
          <div class="detail-tile-value" style="font-family:var(--font-mono);">${esc(n.ip_address || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">Connection Type</div>
          <div class="detail-tile-value">${esc(n.connection_type || '—')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">WiFi Network (SSID)</div>
          <div class="detail-tile-value">${esc(n.ssid || 'Not detected')}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-label">MAC Address</div>
          <div class="detail-tile-value" style="font-family:var(--font-mono);">${esc(n.mac_address || '—')}</div>
        </div>
      </div>`;
  } catch {
    const sec2 = g(`net-sec-${sessionId}`);
    if (sec2) sec2.innerHTML = `<div class="section-title">🌐 Network Information</div>
      <p class="text-muted" style="font-size:13px;padding:8px 0;">Could not load network info.</p>`;
  }
}

// ══════════════════════════════════════════════════════════
// KEYSTROKES PAGE
// ══════════════════════════════════════════════════════════
async function openKeystrokesPage(sessionId, pageId, backDetailSubId) {
  const ksSubId =
    pageId === 'my-sessions' ? 'my-session-keystrokes'
      : pageId === 'super-admins' ? 'super-admin-session-keystrokes'
        : pageId === 'hrs' ? 'hr-session-keystrokes'
          : pageId === 'managers' ? 'manager-session-keystrokes'
            : pageId === 'my-employees' ? 'my-emp-session-keystrokes'
              : 'emp-session-keystrokes';
  const container = g(ksSubId);
  if (!container) return;
  container.innerHTML = spinHtml();
  showSub(pageId, ksSubId);
  try {
    const kr = await api.getAdminKeystrokes({ session_id: sessionId, limit: '500' });
    const rows = (kr && kr.ok && Array.isArray(kr.data)) ? kr.data : [];
    const total = rows.reduce((a, k) => a + (k.keys_pressed_count || 0), 0);

    // Combined raw string — reverse rows to get chronological order
    const combinedRaw = [...rows].reverse().map(k => k.raw_keystrokes || '').join('');

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="back-btn"
                  data-action="back-to-sub"
                  data-target-page="${pageId}"
                  data-target-sub="${backDetailSubId}">
            ← Back to Session
          </button>
          <div>
            <div class="page-title">⌨️ Raw Keystroke Logs</div>
            <div class="page-subtitle">
              ${rows.length} entries · Total: <strong>${total.toLocaleString()}</strong> keystrokes recorded
            </div>
          </div>
        </div>

        <!-- Stats -->
        ${total > 0 ? `
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));">
          <div class="stat-card success">
            <div class="stat-label">Total Keystrokes</div>
            <div class="stat-value">${total.toLocaleString()}</div>
          </div>
          <div class="stat-card accent">
            <div class="stat-label">Log Entries</div>
            <div class="stat-value">${rows.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg per Entry</div>
            <div class="stat-value">${rows.length ? Math.round(total / rows.length) : 0}</div>
          </div>
          ${rows.length >= 2 ? `<div class="stat-card warning">
            <div class="stat-label">Peak Entry</div>
            <div class="stat-value">${Math.max(...rows.map(k => k.keys_pressed_count || 0)).toLocaleString()}</div>
          </div>` : ''}
        </div>` : ''}

        <!-- Combined Raw Keystrokes Section -->
        ${combinedRaw ? `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">📝 Combined Raw Keystrokes</div>
              <div class="card-subtitle">All keystrokes from this session in chronological order</div>
            </div>
          </div>
          <div style="
            background:var(--bg-raised);
            border:1px solid var(--border);
            border-radius:var(--radius-sm);
            padding:16px;
            font-family:var(--font-mono);
            font-size:13px;
            color:var(--text-primary);
            word-break:break-all;
            white-space:pre-wrap;
            max-height:200px;
            overflow-y:auto;
            line-height:2;
          ">${formatRawKeystrokes(combinedRaw)}</div>
        </div>` : ''}

        <!-- Per-entry Table -->
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Count</th>
                <th>Activity</th>
                <th>Raw Keystrokes</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
        ? (() => {
          const maxK = Math.max(...rows.map(k => k.keys_pressed_count || 0), 1);
          return rows.map((k, i) => {
            const pct = Math.round(((k.keys_pressed_count || 0) / maxK) * 100);
            const raw = k.raw_keystrokes || '';
            return `<tr>
                        <td class="td-muted">${i + 1}</td>
                        <td><strong>${(k.keys_pressed_count || 0).toLocaleString()}</strong> keys</td>
                        <td style="min-width:120px;">
                          <div class="progress-bar" style="width:100%;max-width:160px;">
                            <div class="progress-fill success" style="width:${pct}%;"></div>
                          </div>
                        </td>
                        <td style="max-width:400px;">
                          ${raw ? `
                            <div style="
                              background:var(--bg-raised);
                              border:1px solid var(--border);
                              border-radius:var(--radius-sm);
                              padding:8px 12px;
                              font-family:var(--font-mono);
                              font-size:12px;
                              color:var(--text-primary);
                              word-break:break-all;
                              white-space:pre-wrap;
                              max-height:80px;
                              overflow-y:auto;
                              line-height:1.8;
                            ">${formatRawKeystrokes(raw)}</div>
                          ` : '<span class="td-muted">—</span>'}
                        </td>
                        <td class="td-mono td-muted">${fmtDateTime(k.timestamp)}</td>
                      </tr>`;
          }).join('');
        })()
        : emptyRow(5, 'No keystroke logs for this session')}
            </tbody>
          </table>
        </div>

      </div>`;

  } catch (e) {
    container.innerHTML = `
      <div style="padding:20px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${backDetailSubId}">
          ← Back
        </button>
        <p class="text-muted" style="margin-top:12px;">Error: ${esc(e.message)}</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════════
// NETWORK SPEED PAGE
// ══════════════════════════════════════════════════════════
async function openNetSpeedPage(sessionId, pageId, backDetailSubId) {
  const nsSubId =
    pageId === 'my-sessions' ? 'my-session-netspeed'
      : pageId === 'super-admins' ? 'super-admin-session-netspeed'
        : pageId === 'hrs' ? 'hr-session-netspeed'
          : pageId === 'managers' ? 'manager-session-netspeed'
            : pageId === 'my-employees' ? 'my-emp-session-netspeed'
              : 'emp-session-netspeed';

  const container = g(nsSubId);
  if (!container) return;
  container.innerHTML = spinHtml();
  showSub(pageId, nsSubId);

  try {
    const [nsR, smR] = await Promise.all([
      api.getAdminNetworkSpeed({ session_id: sessionId, limit: '500' }),
      api.getAdminSystemMetrics({ session_id: sessionId, limit: '500' }),
    ]);

    const nsRows = (nsR && nsR.ok && Array.isArray(nsR.data)) ? nsR.data : [];
    const smRows = (smR && smR.ok && Array.isArray(smR.data)) ? smR.data : [];

    // Since both are saved at same timestamp, zip by index safely
    const len = Math.max(nsRows.length, smRows.length);
    const rows = Array.from({ length: len }, (_, i) => ({
      ns: nsRows[i] || null,
      sm: smRows[i] || null,
    }));

    const validNs = nsRows.filter(r => r.download_speed != null && r.download_speed !== -1);
    const offlineCount = nsRows.filter(r => r.download_speed === -1).length;
    const avgDown = validNs.length ? (validNs.reduce((a, r) => a + (r.download_speed || 0), 0) / validNs.length).toFixed(1) : '—';
    const avgUp = validNs.length ? (validNs.reduce((a, r) => a + (r.upload_speed || 0), 0) / validNs.length).toFixed(1) : '—';
    const avgPing = validNs.length ? Math.round(validNs.reduce((a, r) => a + (r.ping || 0), 0) / validNs.length) : '—';

    const validSm = smRows.filter(r => r.cpu_usage != null);
    const avgCpu = validSm.length ? (validSm.reduce((a, r) => a + (r.cpu_usage || 0), 0) / validSm.length).toFixed(1) : '—';
    const avgMem = validSm.length ? (validSm.reduce((a, r) => a + (r.memory_usage || 0), 0) / validSm.length).toFixed(1) : '—';

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="back-btn"
                  data-action="back-to-sub"
                  data-target-page="${pageId}"
                  data-target-sub="${backDetailSubId}">
            ← Back to Session
          </button>
          <div>
            <div class="page-title">📶 Network & System Metrics</div>
            <div class="page-subtitle">
              Captured every 1 hour · ${rows.length} snapshot${rows.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));">
          <div class="stat-card accent">
            <div class="stat-label">Avg Download</div>
            <div class="stat-value" style="font-size:20px;">${avgDown}</div>
            <div class="stat-sub">Mbps</div>
          </div>
          <div class="stat-card success">
            <div class="stat-label">Avg Upload</div>
            <div class="stat-value" style="font-size:20px;">${avgUp}</div>
            <div class="stat-sub">Mbps</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Ping</div>
            <div class="stat-value" style="font-size:20px;">${avgPing}</div>
            <div class="stat-sub">ms</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-label">Avg CPU</div>
            <div class="stat-value" style="font-size:20px;">${avgCpu}</div>
            <div class="stat-sub">%</div>
          </div>
      <div class="stat-card danger">
        <div class="stat-label">Avg Memory</div>
        <div class="stat-value" style="font-size:20px;">${avgMem}</div>
        <div class="stat-sub">%</div>
      </div>
      ${offlineCount > 0 ? `
      <div class="stat-card danger">
        <div class="stat-label">Offline Periods</div>
        <div class="stat-value" style="font-size:20px;">${offlineCount}</div>
        <div class="stat-sub">Network unavailable</div>
      </div>` : ''}
    </div>
        </div>

        <!-- Combined Table -->
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Download</th>
                <th>Upload</th>
                <th>Ping</th>
                <th>CPU Usage</th>
                <th>Memory Usage</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
        ? rows.map((row, i) => {
          const ns = row.ns;
          const sm = row.sm;
          const cpuPct = sm?.cpu_usage != null ? Math.min(sm.cpu_usage, 100) : 0;
          const memPct = sm?.memory_usage != null ? Math.min(sm.memory_usage, 100) : 0;
          return `
                      <tr>
                        <td class="td-muted">${i + 1}</td>
                        <td>
                        ${ns?.download_speed != null
              ? ns.download_speed === -1
                ? `<span class="text-danger">🔴 Offline</span>`
                : `<span class="text-success">↓ ${ns.download_speed} Mbps</span>`
              : '<span class="td-muted">—</span>'}
                        </td>
                        <td>
                        ${ns?.upload_speed != null
              ? ns.upload_speed === -1
                ? `<span class="text-danger">🔴 Offline</span>`
                : `<span class="text-accent">↑ ${ns.upload_speed} Mbps</span>`
              : '<span class="td-muted">—</span>'}
                        </td>
                        <td>
                      ${ns?.ping != null
              ? ns.ping === -1
                ? `<span class="text-danger">🔴 No Connection</span>`
                : `<span class="${ns.ping < 50 ? 'text-success' : ns.ping < 100 ? 'text-warning' : 'text-danger'}">${ns.ping}ms</span>`
              : '<span class="td-muted">—</span>'}
                        </td>
                        <td>
                          ${sm?.cpu_usage != null
              ? `<div style="display:flex;align-items:center;gap:6px;">
                                 <span class="${cpuCls(sm.cpu_usage) === 'danger' ? 'text-danger' : cpuCls(sm.cpu_usage) === 'warning' ? 'text-warning' : 'text-success'}" style="min-width:42px;">
                                   ${sm.cpu_usage.toFixed(1)}%
                                 </span>
                                 <div class="progress-bar" style="width:80px;">
                                   <div class="progress-fill ${cpuCls(sm.cpu_usage)}" style="width:${cpuPct}%;"></div>
                                 </div>
                               </div>`
              : '<span class="td-muted">—</span>'}
                        </td>
                        <td>
                          ${sm?.memory_usage != null
              ? `<div style="display:flex;align-items:center;gap:6px;">
                                 <span class="${cpuCls(sm.memory_usage) === 'danger' ? 'text-danger' : cpuCls(sm.memory_usage) === 'warning' ? 'text-warning' : 'text-success'}" style="min-width:42px;">
                                   ${sm.memory_usage.toFixed(1)}%
                                 </span>
                                 <div class="progress-bar" style="width:80px;">
                                   <div class="progress-fill ${cpuCls(sm.memory_usage)}" style="width:${memPct}%;"></div>
                                 </div>
                               </div>`
              : '<span class="td-muted">—</span>'}
                        </td>
                        <td class="td-mono td-muted">
                          ${fmtDateTime((ns || sm)?.timestamp)}
                        </td>
                      </tr>`;
        }).join('')
        : emptyRow(7, 'No snapshots for this session')}
            </tbody>
          </table>
        </div>

      </div>`;



  } catch (e) {
    container.innerHTML = `
      <div style="padding:20px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${backDetailSubId}">
          ← Back
        </button>
        <p class="text-muted" style="margin-top:12px;">Error: ${esc(e.message)}</p>
      </div>`;
  }
}
// ══════════════════════════════════════════════════════════
// ADMINS PAGE
// ══════════════════════════════════════════════════════════
async function loadAdmins() {
  const tbody = g('admins-body');
  tbody.innerHTML = loadingRow(6);
  try {
    const r = await api.listEmployees({ role: 'admin', active_only: 'false' });
    const list = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    if (!list.length) { tbody.innerHTML = emptyRow(6, 'No admins found'); return; }
    tbody.innerHTML = list.map(e => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="avatar" style="width:28px;height:28px;font-size:11px;">
              ${e.employee_name.charAt(0).toUpperCase()}
            </div>
            <strong>${esc(e.employee_name)}</strong>
          </div>
        </td>
        <td class="td-muted">${esc(e.email)}</td>
        <td>${esc(e.department || '—')}</td>
        <td class="td-muted">${e.date_of_joining ? fmtDate(e.date_of_joining) : '—'}</td>
        <td>
          ${e.status
        ? '<span class="badge badge-success">Active</span>'
        : '<span class="badge badge-danger">Inactive</span>'}
        </td>
        <td>
          <button class="btn btn-ghost btn-sm"
                  data-action="view-user"
                  data-emp-id="${esc(String(e.employee_id))}"
                  data-emp-name="${esc(e.employee_name)}"
                  data-page="admins">
            View
          </button>
        </td>
      </tr>`).join('');
  } catch (e) { tbody.innerHTML = emptyRow(6, 'Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════
// EMPLOYEES PAGE
// ══════════════════════════════════════════════════════════
async function loadEmployees() {
  const tbody = g('employees-body');
  tbody.innerHTML = loadingRow(tbodyId === 'employees-body' ? 7 : 6);
  try {
    const r = await api.listEmployees({ role: 'employee', active_only: 'false' });
    const list = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    if (!list.length) { tbody.innerHTML = emptyRow(6, 'No employees found'); return; }
    tbody.innerHTML = list.map(e => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="avatar" style="width:28px;height:28px;font-size:11px;">
              ${e.employee_name.charAt(0).toUpperCase()}
            </div>
            <strong>${esc(e.employee_name)}</strong>
          </div>
        </td>
        <td class="td-muted">${esc(e.email)}</td>
        <td>${esc(e.department || '—')}</td>
        <td class="td-muted">${e.date_of_joining ? fmtDate(e.date_of_joining) : '—'}</td>
        <td>
          ${e.status
        ? '<span class="badge badge-success">Active</span>'
        : '<span class="badge badge-danger">Inactive</span>'}
        </td>
        <td>
          <button class="btn btn-ghost btn-sm"
                  data-action="view-user"
                  data-emp-id="${esc(String(e.employee_id))}"
                  data-emp-name="${esc(e.employee_name)}"
                  data-page="employees">
            View
          </button>
        </td>
      </tr>`).join('');
  } catch (e) { tbody.innerHTML = emptyRow(6, 'Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════
// USER SESSIONS LIST
// ══════════════════════════════════════════════════════════
async function openUserSessions(empId, empName, pageId) {
  const sessSubId =
    pageId === 'super-admins' ? 'super-admin-sessions-list'
      : pageId === 'hrs' ? 'hr-sessions-list'
        : pageId === 'managers' ? 'manager-sessions-list'
          : pageId === 'my-employees' ? 'my-emp-sessions-list'
            : pageId === 'admins' ? 'admin-sessions-list'
              : 'emp-sessions-list';

  const listSubId =
    pageId === 'super-admins' ? 'super-admins-list'
      : pageId === 'hrs' ? 'hrs-list'
        : pageId === 'managers' ? 'managers-list'
          : pageId === 'my-employees' ? 'my-employees-list'
            : pageId === 'admins' ? 'admins-list'
              : 'employees-list';

  const container = g(sessSubId);
  if (!container) return;
  container.innerHTML = spinHtml();
  showSub(pageId, sessSubId);

  try {
    const empIdStr = String(empId).trim();

    let sessions = [];
    const r = await api.getAdminSessions({ employee_id: empIdStr, limit: '200' });
    console.log(`[openUserSessions] employee_id=${empIdStr}`, 'response:', r);

    if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
      sessions = r.data;
    } else {
      console.log('[openUserSessions] Trying fallback: fetch all + filter client-side');
      const r2 = await api.getAdminSessions({ limit: '200' });
      console.log('[openUserSessions] fallback response:', r2);
      if (r2 && r2.ok && Array.isArray(r2.data)) {
        sessions = r2.data.filter(s =>
          String(s.employee_id).toLowerCase().trim() === empIdStr.toLowerCase()
        );
        console.log(`[openUserSessions] after client-side filter: ${sessions.length} sessions`);
        if (sessions.length === 0) {
          container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${listSubId}">
          ← Back
        </button>
        <div>
          <div class="page-title">${esc(empName)}</div>
          <div class="page-subtitle">No sessions yet</div>
        </div>
      </div>

      <!-- Team Members still loads even with no sessions -->
      <div id="usr-team-members"></div>

      <div class="empty-state" style="margin-top:8px;">
        <span class="empty-icon">📭</span>
        <span class="empty-title">No sessions found for ${esc(empName)}</span>
        <span class="empty-sub">This employee has not clocked in yet</span>
      </div>
    </div>`;

          // Still load team members even if no sessions
          setTimeout(async () => {
            const teamContainer = document.getElementById('usr-team-members');
            if (!teamContainer) return;
            try {
              const [empRes, mgrRes, hrRes, saRes] = await Promise.all([
                api.listEmployees({ role: 'employee', active_only: 'false' }),
                api.listEmployees({ role: 'manager', active_only: 'false' }),
                api.listEmployees({ role: 'hr', active_only: 'false' }),
                api.listEmployees({ role: 'super_admin', active_only: 'false' }),
              ]);
              const allEmps = [
                ...((empRes?.ok && Array.isArray(empRes.data)) ? empRes.data : []),
                ...((mgrRes?.ok && Array.isArray(mgrRes.data)) ? mgrRes.data : []),
                ...((hrRes?.ok && Array.isArray(hrRes.data)) ? hrRes.data : []),
                ...((saRes?.ok && Array.isArray(saRes.data)) ? saRes.data : []),
              ];
              const targetEmp = allEmps.find(e => String(e.employee_id) === String(empId));
              if (!targetEmp || !['manager', 'hr'].includes(targetEmp.role)) {
                teamContainer.innerHTML = ''; return;
              }
              const teamMembers = allEmps.filter(e =>
                e.role === 'employee' && String(e.manager_id) === String(empId)
              );
              if (!teamMembers.length) {
                teamContainer.innerHTML = `
          <div class="card">
            <div class="card-header">
              <div class="card-title">👥 Team Members</div>
              <div class="card-subtitle">No employees assigned to this ${targetEmp.role}</div>
            </div>
          </div>`;
                return;
              }
              teamContainer.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">👥 Team Members</div>
              <div class="card-subtitle">${teamMembers.length} employee${teamMembers.length !== 1 ? 's' : ''} under ${esc(empName)}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
            ${teamMembers.map(m => `
              <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:border-color .15s;"
                   onmouseenter="this.style.borderColor='var(--accent)'"
                   onmouseleave="this.style.borderColor='var(--border)'">
                <div style="display:flex;align-items:center;gap:10px;overflow:hidden;">
                  <div class="avatar" style="width:34px;height:34px;font-size:13px;flex-shrink:0;">
                    ${m.employee_name.charAt(0).toUpperCase()}
                  </div>
                  <div style="overflow:hidden;">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                      ${esc(m.employee_name)}
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);">${esc(m.email)}</div>
                    <div style="margin-top:3px;">
                      ${m.status
                  ? '<span class="badge badge-success" style="font-size:10px;padding:2px 7px;">Active</span>'
                  : '<span class="badge badge-danger" style="font-size:10px;padding:2px 7px;">Inactive</span>'}
                    </div>
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" style="flex-shrink:0;"
                        data-action="view-user"
                        data-emp-id="${esc(String(m.employee_id))}"
                        data-emp-name="${esc(m.employee_name)}"
                        data-page="${pageId}">
                  View →
                </button>
              </div>
            `).join('')}
          </div>
        </div>`;
            } catch (err) { console.error('Team members load error:', err); }
          }, 100);

          return; // ← now returns AFTER setting up team members
        }
      }
    }

    // Build keystroke map
    const ksMap = {};
    try {
      const kr = await api.getAdminKeystrokes({ employee_id: empIdStr, limit: '500' });
      if (kr && kr.ok && Array.isArray(kr.data)) {
        kr.data.forEach(k => {
          ksMap[k.session_id] = (ksMap[k.session_id] || 0) + (k.keys_pressed_count || 0);
        });
      }
    } catch { /* optional */ }

    // ── Get unique years from sessions for year dropdown ──
    const uniqueYears = [...new Set(
      sessions
        .map(s => {
          const raw = s.date || (s.clock_in || '').slice(0, 10);
          if (!raw) return null;
          const y = parseInt(raw.slice(0, 4));
          return isNaN(y) ? null : y;
        })
        .filter(Boolean)
    )].sort((a, b) => b - a);

    // ── Render ─────────────────────────────────────────────
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="back-btn"
                  data-action="back-to-sub"
                  data-target-page="${pageId}"
                  data-target-sub="${listSubId}">
            ← Back
          </button>
          <div>
            <div class="page-title">${esc(empName)}</div>
            <div class="page-subtitle" id="usr-subtitle">All Sessions</div>
          </div>
        </div>

        <!-- Filters -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <select id="usr-filter-period" class="filter-select">
            <option value="all">All Time</option>
            <option value="year">By Year</option>
            <option value="month">By Month</option>
            <option value="day">By Day</option>
          </select>
          <select id="usr-filter-year" class="filter-select" style="display:none;">
            ${uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('')}
          </select>
          <input type="month" id="usr-filter-month" class="filter-input" style="display:none;" />
          <input type="date"  id="usr-filter-day"   class="filter-input" style="display:none;" />
        </div>


<!-- Team Members (only for manager/hr) -->
        <div id="usr-team-members"></div>

        <!-- Date Cards Grid -->
        <div id="usr-sessions-tbody" style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:40px;text-align:center;"><span class="spinner"></span></div>
        </div>

      </div>`;

    function applyFilter() {
      const periodEl = document.getElementById('usr-filter-period');
      const monthEl = document.getElementById('usr-filter-month');
      const dayEl = document.getElementById('usr-filter-day');
      const yearEl = document.getElementById('usr-filter-year');

      if (!periodEl || !monthEl || !dayEl || !yearEl) {
        console.error('[applyFilter] DOM elements not ready');
        return;
      }

      const period = periodEl.value || 'all';

      // Show/hide sub-filters
      yearEl.style.display = period === 'year' ? '' : 'none';
      monthEl.style.display = period === 'month' ? '' : 'none';
      dayEl.style.display = period === 'day' ? '' : 'none';

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const thisMonth = now.toISOString().slice(0, 7);
      const thisYear = String(now.getFullYear());

      if (period === 'month' && !monthEl.value) monthEl.value = thisMonth;
      if (period === 'day' && !dayEl.value) dayEl.value = todayStr;

      const filtered = sessions.filter(s => {
        const raw = s.date || (s.clock_in || '').slice(0, 10);
        if (!raw) return false;
        const dateStr = raw.slice(0, 10);
        if (period === 'day') return dateStr === (dayEl.value || todayStr);
        if (period === 'month') return dateStr.slice(0, 7) === (monthEl.value || thisMonth);
        if (period === 'year') return dateStr.slice(0, 4) === (yearEl.value || thisYear);
        return true;
      });

      // Update subtitle
      const subtitleMap = {
        all: 'All Sessions',
        year: `Year ${yearEl.value || thisYear}`,
        month: `Month: ${monthEl.value || thisMonth}`,
        day: `Date: ${dayEl.value || todayStr}`,
      };
      const subtitleEl = document.getElementById('usr-subtitle');
      if (subtitleEl) subtitleEl.textContent = `${subtitleMap[period] || 'All Sessions'} (${filtered.length})`;





      // ── Group sessions by date ──────────────────────────
      const grouped = {};
      filtered.forEach(s => {
        const dateKey = (s.date || (s.clock_in || '').slice(0, 10) || 'Unknown').slice(0, 10);
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(s);
      });

      // Sort dates descending
      const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

      const tbody = document.getElementById('usr-sessions-tbody');
      if (!tbody) return;

      if (!sortedDates.length) {
        tbody.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <span class="empty-title">No sessions found for this period</span>
            <span class="empty-sub">Try selecting a different filter</span>
          </div>`;
        return;
      }

      tbody.innerHTML = sortedDates.map(dateKey => {
        const daySessions = grouped[dateKey];

        // Day-level aggregates
        const dayActive = daySessions.reduce((a, s) => a + (s.total_active_time || 0), 0);
        const dayIdle = daySessions.reduce((a, s) => a + (s.total_idle_time || 0), 0);
        const dayTotal = dayActive + dayIdle;
        const dayKeys = daySessions.reduce((a, s) => a + (ksMap[s.session_id] || 0), 0);
        const firstClockin = daySessions[daySessions.length - 1]?.clock_in;
        const lastClockout = daySessions[0]?.clock_out;
        const hasActive = daySessions.some(s => s.session_status === 'active');
        const cardId = `day-sessions-${dateKey.replace(/-/g, '')}`;

        return `
  <div class="hover-border" style="
    background:var(--bg-surface);
    border:1px solid var(--border);
    border-radius:var(--radius-lg);
    overflow:hidden;
  ">
            <!-- Card Header -->
            <div style="
              background:var(--bg-raised);
              border-bottom:1px solid var(--border);
              padding:16px 20px;
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:12px;
              flex-wrap:wrap;
            ">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="
                  width:36px;height:36px;border-radius:var(--radius-sm);
                  background:var(--accent-dim);border:1px solid var(--accent);
                  display:flex;align-items:center;justify-content:center;
                  font-size:16px;
                ">📅</div>
                <div>
                  <div style="font-size:15px;font-weight:700;color:var(--text-primary);">
                    ${fmtDate(dateKey)}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                    ${daySessions.length} session${daySessions.length !== 1 ? 's' : ''} this day
                  </div>
                </div>
              </div>
              ${hasActive
            ? `<span class="badge badge-success">🟢 Active Now</span>`
            : `<span class="badge badge-muted">Completed</span>`}
            </div>

            <!-- Card Body — Info Grid -->
            <div style="padding:16px 20px;">
              <div style="
                display:grid;
                grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
                gap:12px;
                margin-bottom:16px;
              ">
                <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">🕐 Clock In</div>
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary);font-family:var(--font-mono);">
                    ${firstClockin ? fmtTime(firstClockin) : '—'}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">🕑 Clock Out</div>
                  <div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:${hasActive ? 'var(--success)' : 'var(--text-primary)'};">
                    ${hasActive ? 'Active' : (lastClockout ? fmtTime(lastClockout) : '—')}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⏱ Total Time</div>
                  <div style="font-size:13px;font-weight:700;color:var(--accent);">
                    ${sToHm(dayTotal)}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--success);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⚡ Active Time</div>
                  <div style="font-size:13px;font-weight:700;color:var(--success);">
                    ${sToHm(dayActive)}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-left:3px solid var(--warning);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">💤 Idle Time</div>
                  <div style="font-size:13px;font-weight:700;color:var(--warning);">
                    ${sToHm(dayIdle)}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">⌨️ Keystrokes</div>
                  <div style="font-size:13px;font-weight:700;color:var(--text-primary);">
                    ${dayKeys.toLocaleString()}
                  </div>
                </div>

                <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;">
                  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px;">📋 Sessions</div>
                  <div style="font-size:13px;font-weight:700;color:var(--text-primary);">
                    ${daySessions.length}
                  </div>
                </div>
              </div>

<!-- View Button -->
              <div style="display:flex;justify-content:flex-end;">
                <button
                  class="btn btn-ghost btn-sm"
                  data-action="toggle-day-sessions"
                  data-card-id="${cardId}"
                  style="display:flex;align-items:center;gap:6px;"
                >
                  📂 View Sessions
                </button>
              </div>

              <!-- Expandable Sessions Table -->
              <div id="${cardId}" class="hidden" style="margin-top:14px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:10px;">
                  All Sessions on ${fmtDate(dateKey)}
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Clock In</th>
                        <th>Clock Out</th>
                        <th>Active</th>
                        <th>Idle</th>
                        <th>Keystrokes</th>
                        <th>Status</th>
                        <th>View</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${daySessions.map((s, idx) => `
                        <tr>
                          <td class="td-muted">${idx + 1}</td>
                          <td class="td-mono">${fmtTime(s.clock_in)}</td>
                          <td class="td-mono">
                            ${s.clock_out
                ? fmtTime(s.clock_out)
                : '<span class="text-success">Active</span>'}
                          </td>
                          <td class="text-success">${sToHm(s.total_active_time)}</td>
                          <td class="text-warning">${sToHm(s.total_idle_time)}</td>
                          <td>${(ksMap[s.session_id] || 0).toLocaleString()}</td>
                          <td>${statusBadge(s.session_status)}</td>
                          <td>
                            <button class="btn btn-ghost btn-sm"
                                    data-action="view-user-session"
                                    data-sid="${esc(s.session_id)}"
                                    data-page="${pageId}"
                                    data-back="${sessSubId}">
                              View
                            </button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>`;
      }).join('');
    }


    // Wire up filter events after DOM is ready
    setTimeout(() => {
      const periodEl = document.getElementById('usr-filter-period');
      const monthEl = document.getElementById('usr-filter-month');
      const dayEl = document.getElementById('usr-filter-day');
      const yearEl = document.getElementById('usr-filter-year');

      if (!periodEl) {
        console.error('[openUserSessions] Filter elements not found in DOM');
        return;
      }

      periodEl.addEventListener('change', applyFilter);
      monthEl?.addEventListener('change', applyFilter);
      dayEl?.addEventListener('change', applyFilter);
      yearEl?.addEventListener('change', applyFilter);

      applyFilter();
    }, 50);

    // ── Load Team Members for HR/Manager ──────────────────
    setTimeout(async () => {
      const teamContainer = document.getElementById('usr-team-members');
      if (!teamContainer) return;

      // Fetch the target employee's role to decide if we show team
      try {
        // Fetch all roles separately to ensure we get everyone
        const [empRes, mgrRes, hrRes, saRes] = await Promise.all([
          api.listEmployees({ role: 'employee', active_only: 'false' }),
          api.listEmployees({ role: 'manager', active_only: 'false' }),
          api.listEmployees({ role: 'hr', active_only: 'false' }),
          api.listEmployees({ role: 'super_admin', active_only: 'false' }),
        ]);

        const allEmps = [
          ...((empRes?.ok && Array.isArray(empRes.data)) ? empRes.data : []),
          ...((mgrRes?.ok && Array.isArray(mgrRes.data)) ? mgrRes.data : []),
          ...((hrRes?.ok && Array.isArray(hrRes.data)) ? hrRes.data : []),
          ...((saRes?.ok && Array.isArray(saRes.data)) ? saRes.data : []),
        ];

        const targetEmp = allEmps.find(e => String(e.employee_id) === String(empId));

        if (!targetEmp || !['manager', 'hr'].includes(targetEmp.role)) {
          teamContainer.innerHTML = '';
          return;
        }

        // Filter client-side instead of relying on backend manager_id param
        const teamMembers = allEmps.filter(e =>
          e.role === 'employee' &&
          String(e.manager_id) === String(empId)
        );

        if (!teamMembers.length) {
          teamContainer.innerHTML = `
            <div class="card" style="margin-bottom:4px;">
              <div class="card-header">
                <div>
                  <div class="card-title">👥 Team Members</div>
                  <div class="card-subtitle">No employees assigned to this ${targetEmp.role}</div>
                </div>
              </div>
            </div>`;
          return;
        }

        teamContainer.innerHTML = `
          <div class="card" style="margin-bottom:4px;">
            <div class="card-header">
              <div>
                <div class="card-title">👥 Team Members</div>
                <div class="card-subtitle">${teamMembers.length} employee${teamMembers.length !== 1 ? 's' : ''} under ${esc(empName)}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
              ${teamMembers.map(m => `
                <div style="
                  background: var(--bg-raised);
                  border: 1px solid var(--border);
                  border-radius: var(--radius);
                  padding: 14px 16px;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 12px;
                  transition: border-color .15s;
                " onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
                  <div style="display:flex;align-items:center;gap:10px;overflow:hidden;">
                    <div class="avatar" style="width:34px;height:34px;font-size:13px;flex-shrink:0;">
                      ${m.employee_name.charAt(0).toUpperCase()}
                    </div>
                    <div style="overflow:hidden;">
                      <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${esc(m.employee_name)}
                      </div>
                      <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${esc(m.email)}
                      </div>
                      <div style="margin-top:3px;">
                        ${m.status
            ? '<span class="badge badge-success" style="font-size:10px;padding:2px 7px;">Active</span>'
            : '<span class="badge badge-danger"  style="font-size:10px;padding:2px 7px;">Inactive</span>'}
                      </div>
                    </div>
                  </div>
                  <button
                    class="btn btn-ghost btn-sm"
                    style="flex-shrink:0;"
                    data-action="view-user"
                    data-emp-id="${esc(String(m.employee_id))}"
                    data-emp-name="${esc(m.employee_name)}"
                    data-page="${pageId}">
                    View →
                  </button>
                </div>
              `).join('')}
            </div>
          </div>`;
      } catch (e) {
        console.error('Team members load error:', e);
      }
    }, 100);

  } catch (e) {
    console.error('openUserSessions error:', e);
    container.innerHTML = `
      <div style="padding:20px;">
        <button class="back-btn"
                data-action="back-to-sub"
                data-target-page="${pageId}"
                data-target-sub="${listSubId}">
          ← Back
        </button>
        <p class="text-muted" style="margin-top:12px;">Error loading sessions: ${esc(e.message)}</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════════
// ADMIN MODAL CONTROLS
// ══════════════════════════════════════════════════════════
function bindAdminButtons() {
  const role = currentEmployee?.role;

  const addSuperAdmin = g('btn-add-super-admin');
  if (addSuperAdmin) addSuperAdmin.addEventListener('click', () => openEmpModal('super_admin'));

  const addHR = g('btn-add-hr');
  if (addHR) addHR.addEventListener('click', () => openEmpModal('hr'));

  const addManager = g('btn-add-manager');
  if (addManager) addManager.addEventListener('click', () => openEmpModal('manager'));

  const addEmployee = g('btn-add-employee');
  if (addEmployee) addEmployee.addEventListener('click', () => openEmpModal('employee'));

  const addMyEmployee = g('btn-add-my-employee');
  if (addMyEmployee) addMyEmployee.addEventListener('click', () => openEmpModal('employee'));

  // Legacy buttons
  const addAdmin = g('btn-add-admin');
  if (addAdmin) addAdmin.addEventListener('click', () => openEmpModal('super_admin'));

  g('btn-save-employee').addEventListener('click', saveEmployee);
  g('btn-confirm-reset').addEventListener('click', confirmReset);
}

// Bind ALL modal close/cancel buttons via addEventListener.
// Electron CSP (script-src 'self') blocks inline onclick="" attributes,
// so we wire every close/cancel button here instead.
function bindModalButtons() {
  // ── Employee modal ──────────────────────────────────
  const empOverlay = g('modal-employee');
  if (empOverlay) {
    // X close button
    const empClose = empOverlay.querySelector('.modal-close');
    if (empClose) empClose.addEventListener('click', () => closeModal('modal-employee'));
    // Cancel button (first .btn-ghost inside the modal)
    const empCancel = empOverlay.querySelector('.btn-ghost');
    if (empCancel) empCancel.addEventListener('click', () => closeModal('modal-employee'));
    // Click backdrop to close
    empOverlay.addEventListener('click', e => {
      if (e.target === empOverlay) closeModal('modal-employee');
    });
  }

  // ── Reset-password modal ────────────────────────────
  const pwOverlay = g('modal-reset-pw');
  if (pwOverlay) {
    const pwClose = pwOverlay.querySelector('.modal-close');
    if (pwClose) pwClose.addEventListener('click', () => closeModal('modal-reset-pw'));
    const pwCancel = pwOverlay.querySelector('.btn-ghost');
    if (pwCancel) pwCancel.addEventListener('click', () => closeModal('modal-reset-pw'));
    pwOverlay.addEventListener('click', e => {
      if (e.target === pwOverlay) closeModal('modal-reset-pw');
    });
  }
  // ── Change My Password modal ────────────────────────────
  const changePwOverlay = g('modal-change-pw');
  if (changePwOverlay) {
    const cpClose = changePwOverlay.querySelector('.modal-close');
    if (cpClose) cpClose.addEventListener('click', () => closeModal('modal-change-pw'));
    const cpCancel = changePwOverlay.querySelector('.btn-ghost');
    if (cpCancel) cpCancel.addEventListener('click', () => closeModal('modal-change-pw'));
    changePwOverlay.addEventListener('click', e => {
      if (e.target === changePwOverlay) closeModal('modal-change-pw');
    });
    // add to ESC handler array too — handled already since we loop ['modal-employee','modal-reset-pw']
  }
  const btnConfirmChangePw = g('btn-confirm-change-pw');
  if (btnConfirmChangePw) btnConfirmChangePw.addEventListener('click', confirmChangePassword);

  // ── ESC key closes any open modal ──────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modal-employee', 'modal-reset-pw', 'modal-change-pw'].forEach(id => {

      const el = g(id);
      if (el && !el.classList.contains('hidden')) closeModal(id);
    });
  });
}

async function openEmpModal(defaultRole) {
  editingEmployeeId = null;
  g('modal-emp-title').textContent = `Add ${roleName(defaultRole)}`;
  g('emp-name').value = '';
  g('emp-email').value = '';
  g('emp-email').disabled = false;
  g('emp-password').value = '';
  g('emp-department').value = '';
  g('emp-role').value = defaultRole;
  g('emp-password-group').style.display = 'block';
  g('modal-emp-alert').classList.add('hidden');

  // Populate manager dropdown for employee role
  const managerGroup = g('emp-manager-group');
  if (managerGroup) {
    if (defaultRole === 'employee') {
      managerGroup.style.display = 'block';
      await populateManagerDropdown();
    } else {
      managerGroup.style.display = 'none';
    }
  }

  // Restrict role dropdown based on current user role
  const roleEl = g('emp-role');
  if (roleEl) {
    const allowed = {
      super_admin: ['super_admin', 'hr', 'manager', 'employee'],
      hr: ['hr', 'manager', 'employee'],
      manager: ['employee'],
    }[currentEmployee?.role] || [];
    Array.from(roleEl.options).forEach(opt => {
      opt.disabled = !allowed.includes(opt.value);
    });
    roleEl.value = defaultRole;
  }

  g('modal-employee').classList.remove('hidden');
}

async function populateManagerDropdown() {
  const sel = g('emp-manager-id');
  if (!sel) return;
  sel.innerHTML = '<option value="">— No Manager —</option>';
  try {
    // Fetch managers and HRs in parallel
    const [managerRes, hrRes] = await Promise.all([
      api.listEmployees({ role: 'manager', active_only: 'true' }),
      api.listEmployees({ role: 'hr', active_only: 'true' }),
    ]);

    const managers = (managerRes && managerRes.ok && Array.isArray(managerRes.data)) ? managerRes.data : [];
    const hrs = (hrRes && hrRes.ok && Array.isArray(hrRes.data)) ? hrRes.data : [];

    // Add managers first
    if (managers.length) {
      const managerGroup = document.createElement('optgroup');
      managerGroup.label = '── Managers ──';
      managers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.employee_id;
        opt.textContent = `${m.employee_name}${m.department ? ' (' + m.department + ')' : ''}`;
        managerGroup.appendChild(opt);
      });
      sel.appendChild(managerGroup);
    }

    // Add HRs second with (HR) label
    if (hrs.length) {
      const hrGroup = document.createElement('optgroup');
      hrGroup.label = '── HRs ──';
      hrs.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h.employee_id;
        opt.textContent = `${h.employee_name} (HR)`;
        hrGroup.appendChild(opt);
      });
      sel.appendChild(hrGroup);
    }

    // If current user is manager, pre-select and lock
    if (currentEmployee?.role === 'manager') {
      sel.value = currentEmployee.employee_id;
      sel.disabled = true;
    }
  } catch { /* ignore */ }
}

function roleName(r) {
  return { super_admin: 'Super Admin', hr: 'HR', manager: 'Manager', employee: 'Employee' }[r] || r;
}
function openEditEmployeeModal(id, name, email, dept, role) {
  editingEmployeeId = id;
  g('modal-emp-title').textContent = 'Edit ' + (role === 'admin' ? 'Admin' : 'Employee');
  g('emp-name').value = name;
  g('emp-email').value = email;
  g('emp-email').disabled = true;
  g('emp-department').value = dept;
  g('emp-role').value = role;
  g('emp-password-group').style.display = 'none';
  g('modal-emp-alert').classList.add('hidden');
  g('modal-employee').classList.remove('hidden');
}

async function saveEmployee() {
  const btn = g('btn-save-employee');
  const name = g('emp-name').value.trim();
  const email = g('emp-email').value.trim();
  const password = g('emp-password').value;
  const dept = g('emp-department').value.trim();
  const role = g('emp-role').value;
  const managerId = g('emp-manager-id') ? g('emp-manager-id').value : '';
  g('modal-emp-alert').classList.add('hidden');

  if (!name) { showModalAlert('modal-emp-alert', 'Name is required'); return; }
  if (!editingEmployeeId && !email) { showModalAlert('modal-emp-alert', 'Email is required'); return; }
    if (!editingEmployeeId && !password) { showModalAlert('modal-emp-alert', 'Password is required'); return; }
  if (!editingEmployeeId && password) {
    const pwErr = validateStrongPassword(password);
    if (pwErr) { showModalAlert('modal-emp-alert', pwErr); return; }
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const payload = { employee_name: name, department: dept, role };
    // Always include manager_id on edit (even if empty, to allow removing a manager)
    if (editingEmployeeId) {
      payload.manager_id = managerId || null;
    } else {
      if (managerId) payload.manager_id = managerId;
    }

    const r = editingEmployeeId
      ? await api.updateEmployee(editingEmployeeId, payload)
      : await api.createEmployee({ ...payload, email, password });

    if (r && r.ok) {
      closeModal('modal-employee');
      const pageMap = {
        super_admin: { key: 'super-admins', bodyId: 'super-admins-body' },
        hr: { key: 'hrs', bodyId: 'hrs-body' },
        manager: { key: 'managers', bodyId: 'managers-body' },
        employee: { key: 'employees', bodyId: 'employees-body' },
      };
      // If manager is adding, refresh their own "my-employees" page instead
      if (editingEmployeeId) {
        loadRolePage('employee', 'employees-body', 'employees');
      } else {
        const target = (isManager && role === 'employee')
          ? { key: 'my-employees', bodyId: 'my-employees-body' }
          : (pageMap[role] || { key: 'employees', bodyId: 'employees-body' });
        loadRolePage(role, target.bodyId, target.key);
      }
    } else {
      showModalAlert('modal-emp-alert', (r && r.data && r.data.detail) ? r.data.detail : 'Save failed');
    }
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
}


function openResetPasswordModal(id) {
  resetPwEmployeeId = id;
  g('new-password').value = '';
  g('modal-pw-alert').classList.add('hidden');
  g('modal-reset-pw').classList.remove('hidden');
}

async function confirmReset() {
  const btn = g('btn-confirm-reset');
  const pw = g('new-password').value;
  if (!pw) { showModalAlert('modal-pw-alert', 'Password is required'); return; }
  const pwErr = validateStrongPassword(pw);
  if (pwErr) { showModalAlert('modal-pw-alert', pwErr); return; }
  btn.disabled = true; btn.textContent = 'Resetting…';
  try {
    const r = await api.resetPassword(resetPwEmployeeId, pw);
    if (r && (r.ok || r.status === 204)) closeModal('modal-reset-pw');
    else showModalAlert('modal-pw-alert', 'Reset failed');
  } finally { btn.disabled = false; btn.textContent = 'Reset Password'; }
}
function openChangePasswordModal() {
  g('change-pw-current').value = '';
  g('change-pw-new').value = '';
  g('change-pw-confirm').value = '';
  g('modal-change-pw-alert').classList.add('hidden');
  g('modal-change-pw').classList.remove('hidden');
}

async function confirmChangePassword() {
  const btn = g('btn-confirm-change-pw');
  const current = g('change-pw-current').value;
  const newPw = g('change-pw-new').value;
  const confirm = g('change-pw-confirm').value;

  g('modal-change-pw-alert').classList.add('hidden');

  if (!current) { showModalAlert('modal-change-pw-alert', 'Current password is required'); return; }
    if (!newPw) { showModalAlert('modal-change-pw-alert', 'New password is required'); return; }
  const pwErr = validateStrongPassword(newPw);
  if (pwErr) { showModalAlert('modal-change-pw-alert', pwErr); return; }
  if (newPw !== confirm) { showModalAlert('modal-change-pw-alert', 'Passwords do not match'); return; }

  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const token = await api.getEmployee(); // just to confirm logged in
    const r = await api.changeMyPassword(current, newPw);
    if (r && (r.ok || r.status === 204)) {
      closeModal('modal-change-pw');
      // Brief success flash — reuse alert styling inline
      alert('Password updated successfully!');
    } else {
      const detail = r?.data?.detail || 'Failed to update password';
      showModalAlert('modal-change-pw-alert', detail);
    }
  } catch (e) {
    showModalAlert('modal-change-pw-alert', 'Error: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Update Password';
  }
}
async function refreshKeystrokesFromDB() {
  try {
    const session = await api.getActiveSession();
    if (!session) {
      const el = g('stat-keys');
      if (el) el.textContent = '0';
      return;
    }
    const kr = await api.getAdminKeystrokes({
      session_id: session.session_id,
      limit: '500'
    });
    if (kr && kr.ok && Array.isArray(kr.data)) {
      const total = kr.data.reduce((a, k) => a + (k.keys_pressed_count || 0), 0);
      const el = g('stat-keys');
      if (el) el.textContent = total.toLocaleString();
    }
  } catch { /* ignore */ }
}

function closeModal(id) { const el = g(id); if (el) el.classList.add('hidden'); }
function showModalAlert(id, msg) {
  const el = g(id);
  if (!el) return;
  el.textContent = '⚠ ' + msg;
  el.className = 'alert alert-error';
}
// Modal close/cancel bindings are in bindModalButtons()

// ══════════════════════════════════════════════════════════
// GLOBALS (for inline HTML onclick on modals)
// ══════════════════════════════════════════════════════════
window.switchPage = switchPage;
window.showSub = showSub;
window.closeModal = closeModal;
window.openEditEmployeeModal = openEditEmployeeModal;
window.openResetPasswordModal = openResetPasswordModal;

// ══════════════════════════════════════════════════════════
// FORMATTING
// ══════════════════════════════════════════════════════════
function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function sToHm(s) {
  if (!s) return '0m';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
// AFTER
// AFTER
function toUtc(v) {
  // If the string has no timezone indicator, append Z so JS treats it as UTC
  if (!v) return null;
  const s = String(v);
  return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
}
function fmtDate(v) {
  if (!v) return '—';
  try { return toUtc(v).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' }); }
  catch { return String(v); }
}
function fmtTime(v) {
  if (!v) return '—';
  try { return toUtc(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); }
  catch { return String(v); }
}
function fmtDateTime(v) {
  if (!v) return '—';
  try { return toUtc(v).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); }
  catch { return String(v); }
}
function pad(n) { return String(n).padStart(2, '0'); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function locStr(s) {
  const c = s.city || '', co = s.country || '';
  return (c && co) ? `${c}, ${co}` : (c || co || '');
}
function statusBadge(s) {
  const m = {
    active: '<span class="badge badge-success">Active</span>',
    completed: '<span class="badge badge-accent">Done</span>',
    stale: '<span class="badge badge-warning">Stale</span>',
  };
  return m[s] || `<span class="badge badge-muted">${esc(s || '—')}</span>`;
}
function cpuCls(p) { return !p ? '' : p > 80 ? 'danger' : p > 60 ? 'warning' : 'success'; }
function loadingRow(c) {
  return `<tr><td colspan="${c}"><div class="empty-state"><span class="spinner"></span></div></td></tr>`;
}
function emptyRow(c, m) {
  return `<tr><td colspan="${c}"><div class="empty-state"><span class="empty-icon">📭</span><span class="empty-title">${m}</span></div></td></tr>`;
}
function spinHtml() {
  return `<div style="padding:40px;text-align:center;"><span class="spinner"></span></div>`;
}

// ══════════════════════════════════════════════════════════
// KEYSTROKE TRACKER (renderer-side display + fallback)
// ══════════════════════════════════════════════════════════
// The main process now uses a system-wide global keyboard hook (uiohook-napi)
// that captures ALL keystrokes even when this window is minimized.
//
// This renderer code still runs for two purposes:
//   1. Updates the live display counter on the Overview page
//   2. Acts as a FALLBACK if uiohook-napi is not installed
(function () {
  let count = 0, display = 0;
  window.addEventListener('keydown', e => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
    count++; display++;
    const el = g('stat-keys');

  }, true);

  // Send to main process every 10s (used only as fallback when global hook is off)
  setInterval(async () => {
    if (!count) return;
    try {
      if (!await api.isClocked()) { count = 0; return; }
      const n = count; count = 0;
      await api.reportKeystrokes(n);
    } catch { /* ignore */ }
  }, 10_000);
})();

// ── Start ─────────────────────────────────────────────────
boot();