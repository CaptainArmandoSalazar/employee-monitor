/**
 * Thin wrapper used in renderer pages to call through the preload bridge.
 * All real HTTP calls happen in the main process via IPC.
 */
'use strict';

const electronAPI = window.electronAPI;

window.API = {
  // ── Auth ────────────────────────────────────────────
  login:      (email, pw)   => electronAPI.login(email, pw),
  logout:     ()            => electronAPI.logout(),
  getEmployee:()            => electronAPI.getEmployee(),

  // ── Session ─────────────────────────────────────────
  clockIn:          ()      => electronAPI.clockIn(),
  clockOut:         ()      => electronAPI.clockOut(),
  getActiveSession: ()      => electronAPI.getActiveSession(),
  getMySessions:    (n)     => electronAPI.getMySessions(n),
  isClocked:        ()      => electronAPI.isClocked(),

  // ── Tracking ────────────────────────────────────────
  getTrackingStats: ()      => electronAPI.getTrackingStats(),

  // ── Admin ────────────────────────────────────────────
  listEmployees:       (p)  => electronAPI.listEmployees(p),
  createEmployee:      (d)  => electronAPI.createEmployee(d),
  updateEmployee:      (id, d) => electronAPI.updateEmployee(id, d),
  deactivateEmployee:  (id) => electronAPI.deactivateEmployee(id),
  reactivateEmployee:  (id) => electronAPI.reactivateEmployee(id),
  resetPassword:       (id, pw) => electronAPI.resetPassword(id, pw),
  getAdminSessions:    (p)  => electronAPI.getAdminSessions(p),
  getAdminActivity:    (p)  => electronAPI.getAdminActivity(p),
  getAdminWebsite:     (p)  => electronAPI.getAdminWebsite(p),
  getAdminKeystrokes:  (p)  => electronAPI.getAdminKeystrokes(p),
  getAdminSystemMetrics:(p) => electronAPI.getAdminSystemMetrics(p),
  getAdminSummary:     (p)  => electronAPI.getAdminSummary(p),
  getEmployeeSummary:  (id, p) => electronAPI.getEmployeeSummary(id, p),
  changeMyPassword: (current, newPw) => electronAPI.changeMyPassword(current, newPw),


  // ── Navigation ───────────────────────────────────────
  showDashboard: ()         => electronAPI.showDashboard(),
  showLogin:     ()         => electronAPI.showLogin(),
  minimize:      ()         => electronAPI.minimize(),
  closeWindow:   ()         => electronAPI.closeWindow(),

  // ── System ───────────────────────────────────────────
  getDeviceInfo:  ()        => electronAPI.getDeviceInfo(),
  getNetworkInfo: ()        => electronAPI.getNetworkInfo(),
};
