'use strict';
(async () => {

  const $ = id => document.getElementById(id);
  let isClockedIn = false;
  let currentUser = null;
  let detailPollInterval = null;
  let currentDetailEmployeeId = null;

  // ─── Screen switch
  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = $(name);
    if (el) el.classList.add('active');
  }

  // ─── Toast
  function toast(msg, type = '') {
    const wrap = $('toastWrap');
    const el = document.createElement('div');
    el.className = `toast t-${type}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ─── Connection check
  async function checkConn() {
    const dot   = $('connDot');
    const label = $('connLabel');
    try {
      const r = await fetch('http://localhost:8000/health');
      if (r.ok) {
        dot.classList.add('on'); dot.classList.remove('off');
        if (label) label.textContent = 'online';
        return true;
      }
    } catch {}
    dot.classList.add('off'); dot.classList.remove('on');
    if (label) label.textContent = 'offline';
    return false;
  }

  // ─── Clock display
  function startClock() {
    function tick() {
      const now = new Date();
      const te = $('timeDigits');
      const de = $('timeDate');
      if (te) te.textContent = now.toLocaleTimeString('en-US', { hour12: false });
      if (de) de.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: '2-digit' }).toUpperCase();
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── Permission modal
  function askPermission(icon, title, body) {
    return new Promise((resolve) => {
      $('permIcon').textContent  = icon;
      $('permTitle').textContent = title;
      $('permBody').textContent  = body;
      $('permModal').classList.remove('hidden');
      const ok     = $('permOk');
      const cancel = $('permCancel');
      const close = (val) => {
        $('permModal').classList.add('hidden');
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(val);
      };
      $('permOk').addEventListener('click',     () => close(true));
      $('permCancel').addEventListener('click', () => close(false));
    });
  }

  // ─── Get location
  async function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { fallbackLocation(resolve, reject); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        async () => fallbackLocation(resolve, reject),
        { timeout: 8000, enableHighAccuracy: false }
      );
    });
  }

  async function fallbackLocation(resolve, reject) {
    try {
      const r = await fetch('http://ip-api.com/json/?fields=lat,lon,status');
      const d = await r.json();
      if (d.status === 'success' && d.lat) {
        resolve({ lat: d.lat, lon: d.lon });
      } else {
        reject(new Error('Location unavailable.'));
      }
    } catch {
      reject(new Error('Cannot determine location.'));
    }
  }

  // ─── Format seconds to Xh Ym
  function fmtSeconds(s) {
    if (s === null || s === undefined) return '—';
    if (s === 0) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ─── Format ISO time to HH:MM
  function fmtTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }

  // ════════════════════════════════════════════════════
  // EMPLOYEE DASHBOARD
  // ════════════════════════════════════════════════════

  function renderUser(user) {
    const name = user.full_name || user.email || 'Employee';
    $('empAva').textContent  = name[0].toUpperCase();
    $('empName').textContent = name;
    $('empDept').textContent = (user.role || 'employee').toUpperCase();
  }

  function setClockUI(on) {
    isClockedIn = on;
    const strip = $('statusStrip');
    const state = $('ssState');
    const sub   = $('ssSub');
    const inBtn = $('clockInBtn');
    const outBtn= $('clockOutBtn');
    if (on) {
      strip.classList.add('clocked');
      state.textContent = 'CLOCKED IN';
      sub.textContent   = 'Monitoring active';
      inBtn.disabled = true;  inBtn.classList.add('disabled');
      outBtn.disabled= false; outBtn.classList.remove('disabled');
    } else {
      strip.classList.remove('clocked');
      state.textContent   = 'NOT CLOCKED IN';
      sub.textContent     = 'Ready to start your day';
      $('ssElapsed').textContent = '—';
      inBtn.disabled = false;  inBtn.classList.remove('disabled');
      outBtn.disabled= true;   outBtn.classList.add('disabled');
    }
    window.electronAPI.updateTrayStatus(on);
  }

  async function loadSysInfo() {
    try {
      const info = await window.electronAPI.getSystemInfo();
      const lbl = $('sysLabel');
      if (lbl) lbl.textContent = `${info.hostname} · ${info.platform}`;
    } catch {}
  }

  async function enterDash(user) {
    currentUser = user;
    renderUser(user);
    show('dashScreen');
    startClock();
    await loadSysInfo();
    checkConn();
    setInterval(checkConn, 30000);
    try {
      const status = await window.Api.clockStatus();
      if (status.is_clocked_in) {
        setClockUI(true);
        Monitor.start(status.attendance_id);
      }
    } catch(e) { Monitor.log(`Status check: ${e.message}`, 'warn'); }
  }

  // ─── CLOCK IN
  async function doClockIn() {
    const btn = $('clockInBtn');
    btn.disabled = true; btn.classList.add('disabled');
    const allowed = await askPermission('📍', 'Location Required',
      'Clock-in requires your location. Your location is only recorded at clock-in and clock-out.');
    if (!allowed) { btn.disabled = false; btn.classList.remove('disabled'); toast('Cancelled', 'warn'); return; }
    Monitor.log('Acquiring location...', 'info');
    let coords;
    try {
      coords = await getLocation();
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled'); return;
    }
    let speedData = null;
    try {
      Monitor.log('Testing speed at clock-in...', 'info');
      speedData = await window.electronAPI.runSpeedTest();
    } catch {}
    try {
      const deviceId = await window.electronAPI.getDeviceId();
      const rec = await window.Api.clockIn(coords.lat, coords.lon, deviceId, speedData);
      setClockUI(true);
      Monitor.start(rec.id);
      toast('Clocked in!', 'ok');
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled');
    }
  }

  // ─── CLOCK OUT
  async function doClockOut() {
    const btn = $('clockOutBtn');
    btn.disabled = true; btn.classList.add('disabled');
    const allowed = await askPermission('🏁', 'Confirm Clock Out',
      'Your location will be recorded. All monitoring will stop.');
    if (!allowed) { btn.disabled = false; btn.classList.remove('disabled'); return; }
    let coords;
    try {
      coords = await getLocation();
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled'); return;
    }
    try {
      await Monitor.stop();
      const rec = await window.Api.clockOut(coords.lat, coords.lon);
      setClockUI(false);
      const secs = rec.total_work_seconds || 0;
      toast(`Clocked out! Worked ${fmtSeconds(secs)}`, 'ok');
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled');
    }
  }

  // ─── LOGOUT (employee)
  async function doLogout() {
    if (isClockedIn) { toast('Please clock out before logging out', 'warn'); return; }
    await window.Api.logout();
    $('emailInput').value = ''; $('passwordInput').value = ''; $('loginErr').textContent = '';
    show('loginScreen');
    toast('Signed out');
  }
function setAdminClockUI(on) {
    isClockedIn = on;
    const inBtn  = $('adminClockInBtn');
    const outBtn = $('adminClockOutBtn');
    const strip  = $('adminClockStrip');
    if (!inBtn || !outBtn) return;
    if (on) {
      strip?.classList.add('clocked');
      const st = $('adminClockState'); if (st) st.textContent = 'CLOCKED IN';
      inBtn.disabled = true;  inBtn.classList.add('disabled');
      outBtn.disabled = false; outBtn.classList.remove('disabled');
    } else {
      strip?.classList.remove('clocked');
      const st = $('adminClockState'); if (st) st.textContent = 'NOT CLOCKED IN';
      inBtn.disabled = false;  inBtn.classList.remove('disabled');
      outBtn.disabled = true;  outBtn.classList.add('disabled');
    }
    window.electronAPI.updateTrayStatus(on);
  }

  async function doAdminClockIn() {
    const btn = $('adminClockInBtn');
    btn.disabled = true; btn.classList.add('disabled');
    const allowed = await askPermission('📍', 'Location Required',
      'Clock-in requires your location.');
    if (!allowed) { btn.disabled = false; btn.classList.remove('disabled'); return; }
    let coords;
    try { coords = await getLocation(); } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled'); return;
    }
    let speedData = null;
    try { speedData = await window.electronAPI.runSpeedTest(); } catch {}
    try {
      const deviceId = await window.electronAPI.getDeviceId();
      const rec = await window.Api.clockIn(coords.lat, coords.lon, deviceId, speedData);
      setAdminClockUI(true);
      Monitor.start(rec.id);
      toast('Clocked in!', 'ok');
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled');
    }
  }

  async function doAdminClockOut() {
    const btn = $('adminClockOutBtn');
    btn.disabled = true; btn.classList.add('disabled');
    const allowed = await askPermission('🏁', 'Confirm Clock Out', 'All monitoring will stop.');
    if (!allowed) { btn.disabled = false; btn.classList.remove('disabled'); return; }
    let coords;
    try { coords = await getLocation(); } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled'); return;
    }
    try {
      await Monitor.stop();
      const rec = await window.Api.clockOut(coords.lat, coords.lon);
      setAdminClockUI(false);
      toast(`Clocked out! Worked ${fmtSeconds(rec.total_work_seconds || 0)}`, 'ok');
    } catch(e) {
      toast(e.message, 'err'); btn.disabled = false; btn.classList.remove('disabled');
    }
  }
  // ════════════════════════════════════════════════════
  // ADMIN DASHBOARD
  // ════════════════════════════════════════════════════

async function enterAdmin(user) {
    currentUser = user;
    const name = user.full_name || user.email;
    $('adminAva').textContent  = name[0].toUpperCase();
    $('adminName').textContent = name;
    show('adminScreen');
    checkConn();
    setInterval(checkConn, 30000);
    await loadSysInfo();

    // Check if admin is already clocked in
    try {
      const status = await window.Api.clockStatus();
      if (status.is_clocked_in) {
        setAdminClockUI(true);
        Monitor.start(status.attendance_id);
      }
    } catch(e) {}

    await loadEmployees();
    setInterval(loadEmployees, 15000);
  }

  async function loadEmployees() {
    try {
      const data = await window.Api.listEmployees();
      const employees = (data.users || []).filter(u => String(u.id) !== String(currentUser?.id));

      renderEmployeeList(employees);
    } catch(e) {
      $('empList').innerHTML = `<div class="emp-list-empty">Failed to load: ${e.message}</div>`;
    }
  }

  async function renderEmployeeList(employees) {
    $('statTotal').textContent = employees.length;
    $('empListCount').textContent = `${employees.length} employees`;

    if (employees.length === 0) {
      $('empList').innerHTML = '<div class="emp-list-empty">No employees yet. Click ADD to create one.</div>';
      return;
    }

    // Fetch live status for all employees in parallel
    const liveStatuses = await Promise.allSettled(
      employees.map(e => window.Api.getEmployeeLive(e.id))
    );

    let online = 0, idle = 0, offline = 0;
    const html = employees.map((emp, i) => {
      const live = liveStatuses[i].status === 'fulfilled' ? liveStatuses[i].value : null;
      const isOnline = live?.is_clocked_in;
      const isIdle   = isOnline && live?.is_idle;

      if (isIdle) idle++;
      else if (isOnline) online++;
      else offline++;

      const statusClass = isIdle ? 'idle' : (isOnline ? 'online' : 'offline');
      const statusText  = isIdle ? 'idle' : (isOnline ? 'online' : 'offline');
      const initials    = (emp.full_name || emp.email)[0].toUpperCase();
      const dept        = emp.department || emp.role || '—';
      const clockInfo   = isOnline ? `Since ${fmtTime(live.clock_in_time)}` : 'Not clocked in';

      return `<div class="emp-card" onclick="window.showEmployeeDetail('${emp.id}','${emp.full_name || emp.email}','${dept}')">
        <div class="emp-card-ava">${initials}</div>
        <div class="emp-card-info">
          <div class="emp-card-name">${emp.full_name || emp.email}</div>
          <div class="emp-card-meta">${dept} · ${clockInfo}</div>
        </div>
<div class="emp-card-status">
          <div class="status-dot ${statusClass}"></div>
          <span class="status-txt">${statusText}</span>
        </div>
        <button class="delete-btn" onclick="event.stopPropagation();window.deleteEmployee('${emp.id}','${emp.full_name || emp.email}')" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
        <svg class="emp-card-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }).join('');

    $('empList').innerHTML = html;
    $('statOnline').textContent  = online;
    $('statIdle').textContent    = idle;
    $('statOffline').textContent = offline;
  }
window.showAdminSelf = async function() {
    if (!currentUser) return;
    const name = currentUser.full_name || currentUser.email;
    const dept = currentUser.department || 'ADMIN';
    currentDetailEmployeeId = currentUser.id;
    $('detailAva').textContent  = name[0].toUpperCase();
    $('detailName').textContent = name;
    $('detailDept').textContent = dept;
    show('empDetailScreen');
    await refreshDetailData(currentUser.id);
    if (detailPollInterval) clearInterval(detailPollInterval);
    detailPollInterval = setInterval(() => refreshDetailData(currentUser.id), 10000);
  };
  // ─── Show employee detail
window.deleteEmployee = async function(empId, name) {
    const confirmed = confirm(`Delete ${name}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await window.Api.deactivateEmployee(empId);
      toast(`${name} removed`, 'ok');
      await loadEmployees();
    } catch(e) {
      toast(e.message, 'err');
    }
  };

  window.showEmployeeDetail = async function(empId, name, dept) {
    currentDetailEmployeeId = empId;

    // Set header
    $('detailAva').textContent   = name[0].toUpperCase();
    $('detailName').textContent  = name;
    $('detailDept').textContent  = dept;

    show('empDetailScreen');

    // Load initial data
    await refreshDetailData(empId);

    // Poll live data every 10s
    if (detailPollInterval) clearInterval(detailPollInterval);
    detailPollInterval = setInterval(() => refreshDetailData(empId), 10000);
  };

  async function refreshDetailData(empId) {
    try {
      // Fetch live + today data in parallel
      const [live, today] = await Promise.all([
        window.Api.getEmployeeLive(empId),
        window.Api.getEmployeeToday(empId),
      ]);

      // ── Live status ──
      const dot    = $('detailDot');
      const status = $('detailStatus');
      if (live.is_clocked_in) {
        const isIdle = live.is_idle;
        dot.style.background = isIdle ? 'var(--acc)' : 'var(--grn)';
        dot.style.boxShadow = isIdle ? '0 0 6px var(--acc)' : '0 0 6px var(--grn)';
        status.textContent = isIdle ? 'idle' : 'online';
        $('dLiveStatus').textContent = isIdle ? '😴 IDLE' : '⚡ ACTIVE';
        $('dLiveStatus').style.color = isIdle ? 'var(--acc)' : 'var(--grn)';
      } else {
        dot.style.background = 'var(--t3)';
        dot.style.boxShadow = 'none';
        status.textContent = 'offline';
        $('dLiveStatus').textContent = '⭕ OFFLINE';
        $('dLiveStatus').style.color = 'var(--t2)';
      }

      $('dLiveWindow').textContent = live.active_window || live.active_app || '(window tracking paused)';
      $('dLiveNet').textContent = live.download_mbps
        ? `↓${live.download_mbps} ↑${live.upload_mbps} Mbps ping:${live.ping_ms}ms`
        : '—';

      // ── Attendance ──
      const att = today.attendance;
      $('dClockIn').textContent    = fmtTime(att.clock_in_time);
      $('dClockOut').textContent   = att.clock_out_time
        ? fmtTime(att.clock_out_time)
        : (att.status === 'clocked_in' || att.status === 'not_clocked_in' ? '(active)' : '—');
      if (att.status === 'clocked_in' && att.clock_in_time) {
        const elapsed = Math.floor((Date.now() - new Date(att.clock_in_time).getTime()) / 1000);
        $('dWorkTime').textContent = fmtSeconds(elapsed);
      } else {
        $('dWorkTime').textContent = fmtSeconds(att.total_work_seconds);
      }
      $('dLoginSpeed').textContent = att.clock_in_download_mbps
        ? `↓${att.clock_in_download_mbps} Mbps`
        : '—';

      // ── Activity stats ──
      const act = today.activity;
      $('dActiveTime').textContent  = fmtSeconds(act.total_active_seconds);
      $('dIdleTime').textContent    = fmtSeconds(act.total_idle_seconds);
      $('dKeystrokes').textContent  = (act.total_keystrokes || 0).toLocaleString();
      $('dClicks').textContent      = (act.total_mouse_clicks || 0).toLocaleString();

      // ── Top apps ──
      const appsEl = $('dTopApps');
      if (act.top_apps && act.top_apps.length > 0) {
        appsEl.innerHTML = act.top_apps.map(a =>
          `<div class="detail-list-item">
            <span class="dli-name">${a.app || 'Unknown'}</span>
            <span class="dli-meta">${a.count} logs</span>
          </div>`
        ).join('');
      } else {
        appsEl.innerHTML = '<div class="detail-empty">No data</div>';
      }

      // ── Websites ──
      const webEl = $('dWebsites');
      if (today.websites && today.websites.length > 0) {
        webEl.innerHTML = today.websites.map(w =>
          `<div class="detail-list-item">
            <span class="dli-name">${w.domain}</span>
            <span class="dli-meta">${w.visit_count}x · ${fmtSeconds(w.total_time_seconds)}</span>
          </div>`
        ).join('');
      } else {
        webEl.innerHTML = '<div class="detail-empty">No websites tracked</div>';
      }

      // ── Idle periods ──
      const idleEl = $('dIdlePeriods');
      if (today.idle_periods && today.idle_periods.length > 0) {
        idleEl.innerHTML = today.idle_periods.map(ip =>
          `<div class="detail-list-item">
            <span class="dli-name">${fmtTime(ip.start)} → ${ip.end ? fmtTime(ip.end) : 'ongoing'}</span>
            <span class="dli-meta">${fmtSeconds(ip.duration_seconds)}</span>
          </div>`
        ).join('');
      } else {
        idleEl.innerHTML = '<div class="detail-empty">No idle periods</div>';
      }

    } catch(e) {
      console.error('Detail refresh error:', e);
    }
  }

  // ─── Back button
  $('backBtn')?.addEventListener('click', () => {
    if (detailPollInterval) { clearInterval(detailPollInterval); detailPollInterval = null; }
    currentDetailEmployeeId = null;
    show('adminScreen');
  });

  // ─── Add employee modal
  $('addEmpBtn')?.addEventListener('click', () => {
    $('newEmpName').value = '';
    $('newEmpEmail').value = '';
    $('newEmpDept').value = '';
    $('newEmpPass').value = '';
    $('addEmpErr').textContent = '';
    $('addEmpModal').classList.remove('hidden');
  });

  $('addEmpCancel')?.addEventListener('click', () => {
    $('addEmpModal').classList.add('hidden');
  });

  $('addEmpConfirm')?.addEventListener('click', async () => {
    const name  = $('newEmpName').value.trim();
    const email = $('newEmpEmail').value.trim();
    const dept  = $('newEmpDept').value.trim();
    const pass  = $('newEmpPass').value;
    const err   = $('addEmpErr');

    if (!name || !email || !pass) { err.textContent = 'Name, email and password are required'; return; }
    if (pass.length < 8) { err.textContent = 'Password must be at least 8 characters'; return; }

    $('addEmpText').classList.add('hidden');
    $('addEmpLoader').classList.remove('hidden');
    $('addEmpConfirm').disabled = true;

    try {
      const role = $('newEmpRole').value;
      await window.Api.createEmployee({
        full_name:  name,
        email:      email,
        password:   pass,
        department: dept || undefined,
        role:       role,
      });
      $('addEmpModal').classList.add('hidden');
      toast(`${name} added successfully`, 'ok');
      await loadEmployees();
    } catch(e) {
      err.textContent = e.message;
    } finally {
      $('addEmpText').classList.remove('hidden');
      $('addEmpLoader').classList.add('hidden');
      $('addEmpConfirm').disabled = false;
    }
  });

  // ─── Admin logout
  $('adminLogoutBtn')?.addEventListener('click', async () => {
    await window.Api.logout();
    $('emailInput').value = ''; $('passwordInput').value = ''; $('loginErr').textContent = '';
    show('loginScreen');
    toast('Signed out');
  });

  // ════════════════════════════════════════════════════
  // LOGIN
  // ════════════════════════════════════════════════════

  async function doLogin() {
    const email = $('emailInput').value.trim();
    const pwd   = $('passwordInput').value;
    const err   = $('loginErr');
    const btn   = $('loginBtn');
    err.textContent = '';
    if (!email || !pwd) { err.textContent = 'Enter email and password'; return; }
    btn.disabled = true;
    $('signinText').classList.add('hidden');
    $('signinLoader').classList.remove('hidden');
    try {
      const user = await window.Api.login(email, pwd);
      if (user.role === 'admin') {
        await enterAdmin(user);
      } else {
        await enterDash(user);
      }
    } catch(e) {
      err.textContent = e.message === 'SESSION_EXPIRED' ? 'Session expired, please log in again.' : e.message;
    } finally {
      btn.disabled = false;
      $('signinText').classList.remove('hidden');
      $('signinLoader').classList.add('hidden');
    }
  }

  // ─── Employee event listeners
  $('loginBtn')?.addEventListener('click', doLogin);
  $('emailInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('passwordInput')?.focus(); });
  $('passwordInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('eyeBtn')?.addEventListener('click', () => {
    const inp = $('passwordInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('clockInBtn')?.addEventListener('click',  doClockIn);
  $('clockOutBtn')?.addEventListener('click', doClockOut);
  $('logoutBtn')?.addEventListener('click',   doLogout);
  $('adminClockInBtn')?.addEventListener('click', doAdminClockIn);
  $('adminClockOutBtn')?.addEventListener('click', doAdminClockOut);
  // Tray + system events
  window.electronAPI.onTrayClockOut(() => { if (isClockedIn) doClockOut(); });
  window.electronAPI.onSystemSuspend(async () => {
    if (isClockedIn) {
      try { await Monitor.stop(); await window.Api.crashClockOut('shutdown'); setClockUI(false); } catch {}
    }
  });
  window.electronAPI.onSystemResume(() => checkConn());

  // Setup monitor listeners
  Monitor.setupInputTracking();
  Monitor.setupActiveWindowListener();

  // ─── Init — restore session
  if (await window.Api.isLoggedIn()) {
    try {
      const user = await window.Api.getMe();
      if (user.role === 'admin') {
        await enterAdmin(user);
      } else {
        await enterDash(user);
      }
      return;
    } catch { await window.Api.clearTokens(); }
  }
  show('loginScreen');

})();