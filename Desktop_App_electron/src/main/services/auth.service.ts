import { apiService } from './api.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Employee {
  employee_id: string;
  employee_name: string;
  email: string;
  department: string | null;
  role: 'super_admin' | 'hr' | 'manager' | 'employee' | 'admin';
  status: boolean;
  date_of_joining: string | null;
  created_at: string | null;
}

export interface LoginResult {
  access_token: string;
  token_type: string;
  employee: Employee;
}

// ── Persist token to disk so it survives app restarts ────
const TOKEN_FILE = path.join(os.homedir(), '.employee_monitor_session.json');

function saveSession(token: string, employee: Employee): void {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, employee, savedAt: Date.now() }), 'utf8');
  } catch { /* ignore */ }
}

function loadSession(): { token: string; employee: Employee } | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw  = fs.readFileSync(TOKEN_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.token || !data.employee) return null;
    // Treat saved session as valid for up to 7.5 hours (token expires in 8h)
    const age = Date.now() - (data.savedAt || 0);
    if (age > 30 * 24 * 60 * 60 * 1000) { clearSession(); return null; } // 30 days
    return { token: data.token, employee: data.employee };
  } catch { return null; }
}

function clearSession(): void {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

// ── In-memory store ───────────────────────────────────────
let _token:    string   | null = null;
let _employee: Employee | null = null;

// Auto-restore persisted session on module load
(function restore() {
  const saved = loadSession();
  if (saved) { _token = saved.token; _employee = saved.employee; }
})();

export const authService = {
  async login(email: string, password: string): Promise<{ success: boolean; error?: string; data?: LoginResult }> {
    try {
      const res = await apiService.post<LoginResult>('/auth/login', { email, password });
      if (res.ok && res.data?.access_token) {
        _token    = res.data.access_token;
        _employee = res.data.employee;
        saveSession(_token, _employee);
        return { success: true, data: res.data };
      }
      const msg = (res.data as { detail?: string })?.detail || 'Invalid email or password';
      return { success: false, error: msg };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      return { success: false, error: `Cannot connect to server: ${message}` };
    }
  },

  logout() {
    _token    = null;
    _employee = null;
    clearSession();
  },

  getToken():    string   | null { return _token; },
  getEmployee(): Employee | null { return _employee; },
  isLoggedIn():  boolean         { return !!_token && !!_employee; },

  /** Called when a 401 is detected — clears token and forces re-login */
  handleExpiredToken() {
    _token    = null;
    _employee = null;
    clearSession();
  },

async getProfile(): Promise<Employee | null> {
  if (!_token) return null;
  const res = await apiService.get<Employee>('/auth/me', _token);
  if (res.ok) {
    _employee = res.data;
    // Refresh savedAt so 30-day window resets on active use
    saveSession(_token, res.data);
    return res.data;
  }
  if (res.status === 401) this.handleExpiredToken();
  return null;
},
};