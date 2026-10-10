// ============================================================
// FINLYTICS — Sign-in / registration / password recovery page
// ============================================================
'use strict';

(() => {
  const $ = id => document.getElementById(id);
  let clientConfig = { demoEnabled: false, passwordResetEnabled: false };
  let resetToken = null;

  // Currency dropdown
  $('reg-currency').replaceChildren(...CURRENCIES.map(c => h('option', { value: c.code }, `${c.flag} ${c.name} (${c.symbol})`)));

  const TITLES = { login: 'Welcome back', register: 'Create account', forgot: 'Reset password', reset: 'Choose a new password' };
  const SUBTITLES = {
    login:    ['No account? ', 'register', 'Create one free →'],
    register: ['Have an account? ', 'login', 'Sign in →'],
    forgot:   ['Remembered it? ', 'login', 'Sign in →'],
    reset:    ['Changed your mind? ', 'login', 'Sign in →'],
  };

  function switchTab(tab) {
    ['login', 'register', 'forgot'].forEach(t => $('tab-' + t).classList.toggle('active', t === tab));
    ['login', 'register', 'forgot', 'reset'].forEach(t => { $(t + '-form').style.display = t === tab ? 'flex' : 'none'; });
    $('auth-tabs').style.display = tab === 'reset' ? 'none' : '';
    clearMessages();
    $('form-title').textContent = TITLES[tab];
    const [lead, target, label] = SUBTITLES[tab];
    $('form-subtitle').replaceChildren(lead, h('a', { href: '#', dataset: { tab: target } }, label));
  }

  function showError(msg) {
    const el = $('auth-error');
    el.textContent = msg; el.classList.add('visible');
    $('auth-success').classList.remove('visible');
  }
  function showSuccess(msg) {
    const el = $('auth-success');
    el.textContent = msg; el.classList.add('visible');
    $('auth-error').classList.remove('visible');
  }
  function clearMessages() {
    $('auth-error').classList.remove('visible');
    $('auth-success').classList.remove('visible');
  }

  // Tab links and buttons (data-tab), including the subtitle link
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-tab]');
    if (!el) return;
    e.preventDefault();
    switchTab(el.dataset.tab);
  });

  $('login-theme-btn').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  $('demo-btn').addEventListener('click', () => {
    switchTab('login');
    $('login-email').value = 'demo@finlytics.app';
    $('login-password').value = 'demo1234';
  });

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault(); clearMessages();
    await withBusy($('login-btn'), 'Please wait…', async () => {
      try {
        await Api.post('/api/auth/login', { email: $('login-email').value.trim(), password: $('login-password').value });
        window.location.href = '/';
      } catch (err) { showError(err.message); }
    });
  });

  $('register-form').addEventListener('submit', async e => {
    e.preventDefault(); clearMessages();
    await withBusy($('reg-btn'), 'Please wait…', async () => {
      try {
        await Api.post('/api/auth/register', {
          name: $('reg-name').value.trim(),
          email: $('reg-email').value.trim(),
          password: $('reg-password').value,
          currency: $('reg-currency').value,
        });
        window.location.href = '/';
      } catch (err) { showError(err.message); }
    });
  });

  $('forgot-form').addEventListener('submit', async e => {
    e.preventDefault(); clearMessages();
    if (!clientConfig.passwordResetEnabled) {
      showError('Password recovery is not available yet. Please contact support.');
      return;
    }
    await withBusy($('forgot-btn'), 'Sending…', async () => {
      try {
        const data = await Api.post('/api/auth/forgot-password', { email: $('forgot-email').value.trim() });
        showSuccess(data.message || 'If an account exists for that email, a reset link has been sent.');
        $('forgot-form').reset();
      } catch (err) { showError(err.message); }
    });
  });

  $('reset-form').addEventListener('submit', async e => {
    e.preventDefault(); clearMessages();
    const pw = $('reset-new-pw').value;
    if (pw !== $('reset-confirm-pw').value) { showError('The passwords do not match.'); return; }
    await withBusy($('reset-btn'), 'Saving…', async () => {
      try {
        const data = await Api.post('/api/auth/reset-password', { token: resetToken, newPassword: pw });
        resetToken = null;
        switchTab('login');
        showSuccess(data.message || 'Password updated. Please sign in.');
      } catch (err) { showError(err.message); }
    });
  });

  function applyConfig() {
    $('demo-section').hidden = !clientConfig.demoEnabled;
    if (!clientConfig.passwordResetEnabled) {
      $('forgot-info-text').textContent = 'Password recovery by email is not configured for this site yet. Please contact support to regain access.';
      $('forgot-email').disabled = true;
      $('forgot-btn').disabled = true;
    }
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('reset');
    if (token || params.has('expired')) {
      // Remove the token from the address bar and history right away.
      window.history.replaceState(null, '', window.location.pathname);
    }

    try {
      clientConfig = await Api.get('/api/auth/config');
    } catch {
      clientConfig = { demoEnabled: false, passwordResetEnabled: false };
    }
    applyConfig();

    if (token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        showError('This reset link is invalid or has expired. Request a new one.');
      } else {
        resetToken = token;
        switchTab('reset');
      }
    } else if (params.has('expired')) {
      showError('Your session has expired. Please sign in again.');
    }
  }

  init();
})();
