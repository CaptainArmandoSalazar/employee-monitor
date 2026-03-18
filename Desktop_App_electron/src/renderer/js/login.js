/* global electronAPI */
'use strict';

const api = window.electronAPI;

const emailInput    = document.getElementById('email');
const passwordInput = document.getElementById('password');
const btnLogin      = document.getElementById('btn-login');
const btnMinimize   = document.getElementById('btn-minimize');
const btnClose      = document.getElementById('btn-close');
const alertBox      = document.getElementById('login-alert');
const alertMsg      = document.getElementById('login-alert-msg');
const btnText       = document.getElementById('login-btn-text');
const spinner       = document.getElementById('login-spinner');

// ── Window controls ───────────────────────────────────────
btnMinimize.addEventListener('click', () => api.minimize());
btnClose.addEventListener('click', () => api.closeWindow());

// ── Alert helpers ─────────────────────────────────────────
function showError(msg) {
  alertMsg.textContent = msg;
  alertBox.className = 'alert alert-error';
}
function hideAlert() {
  alertBox.className = 'alert alert-error hidden';
}

// ── Loading state ─────────────────────────────────────────
function setLoading(loading) {
  btnLogin.disabled = loading;
  btnText.textContent = loading ? 'Signing in…' : 'Sign In';
  spinner.classList.toggle('hidden', !loading);
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
}

// ── Login ─────────────────────────────────────────────────
async function doLogin() {
  hideAlert();

  const email    = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email) {
    emailInput.focus();
    showError('Please enter your email address.');
    return;
  }
  if (!password) {
    passwordInput.focus();
    showError('Please enter your password.');
    return;
  }

  setLoading(true);
  try {
    const result = await api.login(email, password);
    if (result.success) {
      await api.showDashboard();
    } else {
      showError(result.error || 'Login failed. Please try again.');
      passwordInput.value = '';
      passwordInput.focus();
    }
  } catch (err) {
    showError('Could not connect to the server. Please check your connection.');
  } finally {
    setLoading(false);
  }
}

btnLogin.addEventListener('click', doLogin);

// Enter key on either field
[emailInput, passwordInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});
