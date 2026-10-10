// ============================================================
// FINLYTICS — Dashboard app logic
// ============================================================
// All user-controlled values are rendered with textContent / DOM APIs
// (see h() in common.js). Colors are validated before reaching CSS.
'use strict';

// ── State ──
let currentUser   = null;
let currentMonth  = localMonthString();
let categoryChartInstance = null;
let trendChartInstance    = null;
let categoriesCache       = [];
let editingTxnId          = null; // null → creating a new transaction

const CHART_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#EC4899', '#F43F5E', '#14B8A6'];

const $ = id => document.getElementById(id);
const money = amount => formatMoney(amount, currentUser && currentUser.currency);
const symbol = () => currencyInfo(currentUser && currentUser.currency).symbol;

// Any 401 means the session expired or was revoked: go back to sign-in.
Api.onUnauthorized = () => { window.location.href = '/login.html?expired=1'; };

/** Runs a loader and turns failures into a toast instead of a broken page. */
async function safely(task, message) {
  try {
    return await task();
  } catch (err) {
    if (err && err.status === 401) return undefined; // redirecting
    showToast((err && err.message) || message || 'Something went wrong.', 'error');
    return undefined;
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  $('dash-date').replaceChildren(icon('icon-calendar'), ' ' + new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }));
  bindEvents();
  await checkAuth();
});

function bindEvents() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); showPage(item.dataset.page); });
  });

  // Delegated handlers for buttons declared in the HTML with data-action
  document.addEventListener('click', e => {
    const overlay = e.target.closest('[data-backdrop-close]');
    if (overlay && e.target === overlay) { closeModal(overlay.id); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'toggle-theme':          toggleThemeGlobal(); break;
      case 'open-monthly-budget':   openMonthlyBudgetModal(); break;
      case 'view-all-transactions': showPage('transactions'); break;
      case 'open-budget-modal':     openBudgetModal(); break;
      case 'logout':                handleLogout(el); break;
      case 'open-create-category':  openCreateCategoryModal(); break;
      case 'open-txn-modal':        openTxnModal(); break;
      case 'close-modal':           closeModal(el.dataset.modal); break;
      case 'set-txn-type':          setTxnType(el.dataset.type); break;
      case 'set-cc-type':           setCcType(el.dataset.type); break;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  });

  $('txn-form').addEventListener('submit', handleSaveTxn);
  $('budget-form').addEventListener('submit', handleSaveBudget);
  $('monthly-budget-form').addEventListener('submit', handleSaveMonthlyBudget);
  $('create-cat-form').addEventListener('submit', handleCreateCategory);
  $('txn-search').addEventListener('input', debounce(loadTransactions, 300));
  $('setting-currency').addEventListener('change', e => updatePref('currency', e.target.value));
  $('setting-theme').addEventListener('change', e => updateTheme(e.target.checked));

  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadTransactions();
    });
  });

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      $('cc-color-val').value = safeColor(sw.dataset.color);
    });
  });
}

function showPage(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('page-' + page).classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'transactions') loadTransactions();
  if (page === 'budgets') loadBudgets();
  if (page === 'settings') loadSettings();
}

// ── Auth ──
async function checkAuth() {
  try {
    currentUser = await Api.get('/api/auth/me');
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message, 'error');
      setTimeout(() => { window.location.href = '/login.html'; }, 1500);
    }
    return;
  }
  renderUser();
  loadDashboard();
}

function renderUser() {
  const name = currentUser.name || '';
  const initial = name.charAt(0).toUpperCase() || '?';
  $('sb-user-name').textContent = name;
  $('sb-user-initial').textContent = initial;
  $('st-user-name').textContent = name;
  $('st-user-email').textContent = currentUser.email;
  $('st-user-initial').textContent = initial;
  $('st-total-txns').textContent = String(currentUser.transactionCount ?? 0);
  $('dash-greeting').textContent = `Hi, ${name.split(' ')[0]}`;

  $('setting-currency').replaceChildren(...CURRENCIES.map(c =>
    h('option', { value: c.code, selected: currentUser.currency === c.code }, `${c.code} (${c.symbol})`)));

  const isDark = currentUser.theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  $('setting-theme').checked = isDark;
}

async function handleLogout(button) {
  await withBusy(button, 'Signing out…', async () => {
    try {
      await Api.post('/api/auth/logout');
      window.location.href = '/login.html';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function updatePref(key, value) {
  try {
    const { user } = await Api.patch('/api/auth/preferences', { [key]: value });
    currentUser = { ...currentUser, ...user };
    showToast('Preferences updated');
    if (key === 'currency') { renderUser(); refreshActivePage(); }
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    renderUser(); // revert controls to the saved state
    return false;
  }
}

async function updateTheme(isDark) {
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  $('setting-theme').checked = isDark;
  if (await updatePref('theme', theme) && $('page-dashboard').classList.contains('active')) loadCharts();
}

function toggleThemeGlobal() {
  updateTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
}

function refreshActivePage() {
  const active = document.querySelector('.page.active');
  if (!active) return;
  showPage(active.id.replace('page-', ''));
}

// ── Modals ──
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { if ($(id)) $(id).classList.remove('open'); }

// ── Categories ──
async function refreshCategoriesCache() {
  const cats = await Api.get('/api/categories');
  categoriesCache = Array.isArray(cats) ? cats : [];
}

function getCategoryInfo(name, type) {
  return categoriesCache.find(c => c.name === name && (!type || c.type === type))
    || categoriesCache.find(c => c.name === name)
    || { name, emoji: '🏷', color: FALLBACK_COLOR };
}

// ── Dashboard ──
async function loadDashboard() {
  await safely(async () => {
    await refreshCategoriesCache();
    const [mb, data] = await Promise.all([
      Api.get(`/api/budgets/monthly?month=${currentMonth}`),
      Api.get(`/api/analytics/summary?month=${currentMonth}`),
    ]);
    const monthlyBudget = mb.budget ? Number(mb.budget.amount) : 0;

    $('val-balance').textContent  = money(data.balance);
    $('val-income').textContent   = money(data.monthlyIncome);
    $('val-expenses').textContent = money(data.monthlyExpenses);
    $('val-savings').textContent  = data.savingsRate === null || data.savingsRate === undefined ? '—' : data.savingsRate + '%';

    renderBudgetOverview(monthlyBudget, Number(data.monthlyExpenses) || 0, data);
  }, 'Could not load your dashboard.');

  loadRecentTxns();
  loadCharts();
}

function renderBudgetOverview(limit, spent, data) {
  if (!limit && data.monthlyExpenses === 0 && data.monthlyIncome === 0) {
    // Brand-new month or account: prompt for an overall budget
    $('bov-card').style.display = 'none';
    openMonthlyBudgetModal();
    return;
  }
  $('bov-card').style.display = 'block';
  $('bov-spent').textContent = money(spent);
  $('bov-limit').textContent = limit > 0 ? money(limit) : 'Not set';

  const rawPct = limit > 0 ? (spent / limit) * 100 : 0;
  const pct = Math.min(rawPct, 100);
  const fill = $('bov-fill');
  fill.style.width = pct + '%';
  fill.className = 'bov-bar-fill';
  if (rawPct >= 90) fill.classList.add('danger');
  else if (rawPct >= 75) fill.classList.add('amber');

  $('bov-pct').textContent = `${Math.round(rawPct)}% used`;
  const rem = $('bov-rem');
  if (limit > 0) {
    const left = limit - spent;
    rem.textContent = left >= 0 ? `${money(left)} left` : `${money(Math.abs(left))} over`;
    rem.style.color = left >= 0 ? 'var(--text-muted)' : 'var(--red)';
  } else {
    rem.textContent = 'Set limit to track progress';
    rem.style.color = 'var(--text-muted)';
  }
}

// ── Overall monthly budget ──
async function openMonthlyBudgetModal() {
  $('mb-sym').textContent = symbol();
  // Prefill with the saved target before opening, so it never overwrites typing.
  const res = await safely(() => Api.get(`/api/budgets/monthly?month=${currentMonth}`));
  $('mb-amount').value = res && res.budget ? res.budget.amount : '';
  openModal('monthly-budget-modal-overlay');
}

async function handleSaveMonthlyBudget(e) {
  e.preventDefault();
  const amount = $('mb-amount').value;
  if (!amount) return;
  await withBusy($('mb-save-btn'), 'Saving…', async () => {
    try {
      await Api.post('/api/budgets/monthly', { month: currentMonth, amount });
      closeModal('monthly-budget-modal-overlay');
      showToast('Monthly target saved');
      refreshActivePage();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Custom categories ──
function openCreateCategoryModal() {
  setCcType('expense');
  $('cc-name').value = '';
  $('cc-emoji').value = '🏷';
  openModal('create-cat-modal-overlay');
}

function setCcType(type) {
  $('cc-type').value = type;
  $('cc-type-expense').classList.toggle('active', type === 'expense');
  $('cc-type-income').classList.toggle('active', type === 'income');
}

async function handleCreateCategory(e) {
  e.preventDefault();
  const payload = {
    type:  $('cc-type').value,
    name:  $('cc-name').value.trim(),
    emoji: $('cc-emoji').value.trim(),
    color: safeColor($('cc-color-val').value),
  };
  await withBusy($('cc-save-btn'), 'Creating…', async () => {
    try {
      await Api.post('/api/categories', payload);
      closeModal('create-cat-modal-overlay');
      showToast('Category created!');
      await refreshCategoriesCache();
      if ($('txn-modal-overlay').classList.contains('open')) renderCategoryGrid($('txn-type').value);
      if ($('page-settings').classList.contains('active')) renderCategoryManager();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Charts ──
async function loadCharts() {
  await safely(async () => {
    const [catData, trendData] = await Promise.all([
      Api.get(`/api/analytics/categories?month=${currentMonth}`),
      Api.get(`/api/analytics/trends?month=${currentMonth}`),
    ]);
    const cats   = Array.isArray(catData) ? catData : [];
    const trends = Array.isArray(trendData) ? trendData : [];
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // Donut
    if (categoryChartInstance) categoryChartInstance.destroy();
    const total = cats.reduce((s, c) => s + Number(c.total || 0), 0);
    $('donut-center-val').textContent = money(total);
    const bgColors = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    if (typeof Chart === 'function') {
      categoryChartInstance = new Chart($('categoryChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: cats.map(c => c.category), datasets: [{ data: cats.map(c => c.total), backgroundColor: bgColors, borderWidth: 0, hoverOffset: 4 }] },
        options: {
          cutout: '75%', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${money(ctx.raw)}` } } },
        },
      });
    }

    const legend = $('donut-legend');
    if (!cats.length) {
      legend.replaceChildren(h('div', { class: 'legend-empty', text: 'No expense data yet' }));
    } else {
      legend.replaceChildren(...cats.map((c, i) => h('div', { class: 'legend-item' },
        h('div', { class: 'legend-dot', style: { background: bgColors[i] } }),
        h('span', { class: 'legend-name', text: c.category }),
        h('span', { class: 'legend-amount', text: money(c.total) }),
        h('span', { class: 'legend-pct', text: `${total > 0 ? Math.round((c.total / total) * 100) : 0}%` }),
      )));
    }

    // Cash-flow trend
    if (trendChartInstance) trendChartInstance.destroy();
    if (typeof Chart === 'function') {
      const tick = isDark ? '#94A3B8' : '#64748B';
      trendChartInstance = new Chart($('trendChart').getContext('2d'), {
        type: 'line',
        data: {
          labels: trends.map(t => t.month),
          datasets: [
            { label: 'Income', data: trends.map(t => t.income), borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 20 },
            { label: 'Expenses', data: trends.map(t => t.expenses), borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.0)', borderWidth: 3, tension: 0.4, fill: false, pointRadius: 0, pointHitRadius: 20 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${money(ctx.raw)}` } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 }, color: tick } },
            y: { grid: { color: isDark ? '#2A2A2A' : '#E2E8F0' }, border: { display: false },
                 ticks: { font: { family: 'Inter', size: 12 }, color: tick, callback: val => symbol() + val } },
          },
        },
      });
    }
  }, 'Could not load charts.');
}

// ── Transactions ──
function emptyState(emoji, title, desc) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-emoji', text: emoji }),
    h('h3', { class: 'empty-title', text: title }),
    desc ? h('p', { class: 'empty-desc', text: desc }) : null);
}

function errorState(onRetry) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-emoji', text: '⚠️' }),
    h('h3', { class: 'empty-title', text: 'Could not load data' }),
    h('button', { class: 'btn-outline', type: 'button', onclick: onRetry }, 'Try again'));
}

async function loadRecentTxns() {
  const list = $('recent-txn-list');
  try {
    const txns = await Api.get('/api/transactions?limit=5');
    list.replaceChildren(...(txns.length
      ? txns.map(renderTxnRow)
      : [emptyState('📝', 'No transactions yet', 'Record your first income or expense to see it here.')]));
  } catch (err) {
    if (err.status !== 401) list.replaceChildren(errorState(loadRecentTxns));
  }
}

let txnRequestSeq = 0;
async function loadTransactions() {
  const list   = $('all-txn-list');
  const active = document.querySelector('.filter-chips .chip.active');
  const type   = active ? active.dataset.filterType : 'all';
  const search = $('txn-search').value.trim();

  const params = new URLSearchParams();
  if (type !== 'all') params.set('type', type);
  if (search) params.set('search', search);
  const seq = ++txnRequestSeq;

  try {
    const txns = await Api.get('/api/transactions?' + params.toString());
    if (seq !== txnRequestSeq) return; // a newer search already rendered
    if (!txns.length) {
      list.replaceChildren(emptyState('🔍', search || type !== 'all' ? 'No results found' : 'No transactions yet'));
      return;
    }
    const grouped = new Map();
    for (const t of txns) {
      if (!grouped.has(t.date)) grouped.set(t.date, []);
      grouped.get(t.date).push(t);
    }
    const nodes = [];
    for (const [date, items] of grouped) {
      nodes.push(h('div', { class: 'txn-group-header', text: formatDate(date) }));
      nodes.push(h('div', { class: 'txn-group-list' }, items.map(renderTxnRow)));
    }
    list.replaceChildren(...nodes);
  } catch (err) {
    if (seq === txnRequestSeq && err.status !== 401) list.replaceChildren(errorState(loadTransactions));
  }
}

function renderTxnRow(txn) {
  const isExp = txn.type === 'expense';
  const cInfo = getCategoryInfo(txn.category, txn.type);
  const color = safeColor(cInfo.color);

  return h('div', { class: 'txn-row' },
    h('div', { class: 'txn-icon', style: { background: tint(color), color }, text: cInfo.emoji || '🏷' }),
    h('div', { class: 'txn-info' },
      h('div', { class: 'txn-merchant', text: txn.merchant }),
      h('div', { class: 'txn-meta' },
        h('span', { class: 'txn-category-tag', style: { background: 'var(--surface-2)', color: 'var(--text-secondary)' }, text: txn.category }),
        h('span', { class: 'txn-date', text: formatDate(txn.date) }))),
    h('div', { class: 'txn-right' },
      h('div', { class: `txn-amount ${isExp ? 'expense' : 'income'}`, text: `${isExp ? '-' : '+'}${money(txn.amount)}` })),
    h('div', { class: 'txn-actions' },
      h('button', { class: 'txn-action-btn edit', type: 'button', title: 'Edit', 'aria-label': `Edit ${txn.merchant}`, onclick: () => openTxnModal(txn) }, icon('icon-edit')),
      h('button', { class: 'txn-action-btn delete', type: 'button', title: 'Delete', 'aria-label': `Delete ${txn.merchant}`, onclick: e => deleteTxn(txn.id, e.currentTarget) }, icon('icon-trash'))),
  );
}

// ── Transaction modal (create & edit) ──
async function openTxnModal(txn) {
  editingTxnId = txn && txn.id ? txn.id : null;
  const ok = await safely(refreshCategoriesCache, 'Could not load categories.');
  if (ok === undefined && !categoriesCache.length) return;

  $('txn-modal-title').textContent = editingTxnId ? 'Edit Transaction' : 'New Transaction';
  $('txn-save-btn').textContent = editingTxnId ? 'Save Changes' : 'Save Transaction';
  $('txn-sym').textContent = symbol();
  $('txn-form').reset();
  setTxnType(editingTxnId ? txn.type : 'expense');
  if (editingTxnId) {
    $('txn-amount').value   = txn.amount;
    $('txn-merchant').value = txn.merchant;
    $('txn-date').value     = txn.date;
    $('txn-notes').value    = txn.notes || '';
    const btn = [...document.querySelectorAll('#txn-cat-grid .cat-btn[data-cat]')].find(b => b.dataset.cat === txn.category);
    if (btn) selectTxnCat(btn, txn.category);
  } else {
    $('txn-date').value = localDateString();
  }
  openModal('txn-modal-overlay');
}

function setTxnType(type) {
  $('txn-type').value = type;
  $('type-expense').classList.toggle('active', type === 'expense');
  $('type-income').classList.toggle('active', type === 'income');
  renderCategoryGrid(type);
}

function renderCategoryGrid(type) {
  const cats = categoriesCache.filter(c => c.type === type);
  const buttons = cats.map(c => {
    const btn = h('button', { class: 'cat-btn', type: 'button', dataset: { cat: c.name } },
      h('span', { class: 'cat-emoji', text: c.emoji }),
      h('span', { text: c.name }));
    btn.addEventListener('click', () => selectTxnCat(btn, c.name));
    return btn;
  });
  buttons.push(h('button', { class: 'cat-btn add-cat-btn', type: 'button', onclick: openCreateCategoryModal },
    h('span', { class: 'cat-emoji cat-emoji-add', text: '+' }),
    h('span', { text: 'New' })));
  $('txn-cat-grid').replaceChildren(...buttons);
  $('txn-category').value = '';
}

function selectTxnCat(el, name) {
  document.querySelectorAll('#txn-cat-grid .cat-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  $('txn-category').value = name;
}

async function handleSaveTxn(e) {
  e.preventDefault();
  const category = $('txn-category').value;
  if (!category) { showToast('Please select a category.', 'error'); return; }

  const payload = {
    type: $('txn-type').value,
    amount: $('txn-amount').value,
    category,
    merchant: $('txn-merchant').value.trim(),
    date: $('txn-date').value,
    notes: $('txn-notes').value.trim(),
  };

  await withBusy($('txn-save-btn'), 'Saving…', async () => {
    try {
      if (editingTxnId) await Api.put(`/api/transactions/${encodeURIComponent(editingTxnId)}`, payload);
      else await Api.post('/api/transactions', payload);
      closeModal('txn-modal-overlay');
      showToast(editingTxnId ? 'Transaction updated' : 'Transaction saved');
      editingTxnId = null;
      refreshActivePage();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteTxn(id, button) {
  if (!confirm('Delete this transaction?')) return;
  await withBusy(button, null, async () => {
    try {
      await Api.del(`/api/transactions/${encodeURIComponent(id)}`);
      showToast('Transaction deleted');
      refreshActivePage();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Budgets ──
async function loadBudgets() {
  const list = $('budget-list');
  try {
    await refreshCategoriesCache();
    const [mb, budgets] = await Promise.all([
      Api.get(`/api/budgets/monthly?month=${currentMonth}`),
      Api.get(`/api/budgets?month=${currentMonth}`),
    ]);
    const monthlyBudget = mb.budget ? Number(mb.budget.amount) : 0;
    const totalLimit = budgets.reduce((s, b) => s + Number(b.limit_amount), 0);
    const totalSpent = budgets.reduce((s, b) => s + Number(b.spent), 0);
    const remain = totalLimit - totalSpent;

    $('budget-summary').replaceChildren(
      h('div', { class: 'budget-summary-card' },
        h('span', { class: 'bsc-label', text: 'Global Target (This Month)' }),
        h('span', { class: 'bsc-value', style: { color: 'var(--primary)' }, text: monthlyBudget > 0 ? money(monthlyBudget) : 'Not Set' }),
        h('button', { class: 'link-btn', type: 'button', onclick: openMonthlyBudgetModal }, 'Click to edit target')),
      h('div', { class: 'budget-summary-card' },
        h('span', { class: 'bsc-label', text: 'Sum of Category Limits' }),
        h('span', { class: 'bsc-value', text: money(totalLimit) })),
      h('div', { class: 'budget-summary-card' },
        h('span', { class: 'bsc-label', text: remain < 0 ? 'Over Category Limits' : 'Remaining in Categories' }),
        h('span', { class: 'bsc-value', style: { color: remain < 0 ? 'var(--red)' : 'var(--text-primary)' }, text: money(Math.abs(remain)) })),
    );

    if (!budgets.length) {
      list.replaceChildren(h('div', { class: 'empty-state budget-empty' },
        h('div', { class: 'empty-emoji', text: '🎯' }),
        h('h3', { class: 'empty-title', text: 'No budgets set' }),
        h('p', { class: 'empty-desc', text: 'Create category limits to keep your spending in check.' })));
      return;
    }
    list.replaceChildren(...budgets.map(renderBudgetCard));
  } catch (err) {
    if (err.status !== 401) list.replaceChildren(errorState(loadBudgets));
  }
}

function renderBudgetCard(b) {
  const limit = Number(b.limit_amount);
  const spent = Number(b.spent);
  const rawPct = limit > 0 ? (spent / limit) * 100 : 0;
  const pct = Math.min(rawPct, 100);
  const base = safeColor(b.color);
  const color = rawPct >= 90 ? 'var(--red)' : rawPct >= 75 ? 'var(--amber)' : base;
  const rem = limit - spent;

  return h('div', { class: 'budget-card' },
    h('div', { class: 'budget-card-header' },
      h('div', { class: 'budget-cat-icon', style: { background: tint(base), color: base }, text: b.emoji }),
      h('div', { class: 'budget-cat-info' },
        h('div', { class: 'budget-cat-name', text: b.category }),
        h('div', { class: 'budget-cat-period', text: 'Monthly limit' })),
      h('div', { class: 'budget-amounts' },
        h('div', { class: 'budget-spent', text: money(spent) }),
        h('div', { class: 'budget-limit', text: `of ${money(limit)}` }))),
    h('div', { class: 'progress-bar-container' },
      h('div', { class: 'progress-bar-fill', style: { width: pct + '%', background: color } })),
    h('div', { class: 'budget-footer' },
      h('span', { class: 'budget-pct', style: { color }, text: `${Math.round(rawPct)}%` }),
      h('span', { class: 'budget-remaining', text: rem >= 0 ? `${money(rem)} left` : `${money(Math.abs(rem))} over` }),
      h('button', { class: 'small-btn btn-outline budget-remove-btn', type: 'button', onclick: e => deleteBudget(b.id, e.currentTarget) }, 'Remove')),
  );
}

async function openBudgetModal() {
  const ok = await safely(refreshCategoriesCache, 'Could not load categories.');
  if (ok === undefined && !categoriesCache.length) return;
  $('budget-sym').textContent = symbol();
  $('budget-form').reset();
  const expCats = categoriesCache.filter(c => c.type === 'expense');
  $('budget-category').replaceChildren(...expCats.map(c => h('option', { value: c.name }, `${c.emoji} ${c.name}`)));
  openModal('budget-modal-overlay');
}

async function handleSaveBudget(e) {
  e.preventDefault();
  const payload = { category: $('budget-category').value, limit_amount: $('budget-limit').value };
  if (!payload.category) { showToast('Create an expense category first.', 'error'); return; }
  await withBusy($('budget-save-btn'), 'Saving…', async () => {
    try {
      await Api.post('/api/budgets', payload);
      closeModal('budget-modal-overlay');
      showToast('Budget saved');
      loadBudgets();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteBudget(id, button) {
  if (!confirm('Remove this category budget?')) return;
  await withBusy(button, null, async () => {
    try {
      await Api.del(`/api/budgets/${encodeURIComponent(id)}`);
      showToast('Budget removed');
      loadBudgets();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Settings ──
async function loadSettings() {
  await safely(async () => {
    currentUser = await Api.get('/api/auth/me');
    renderUser();
    await refreshCategoriesCache();
    renderCategoryManager();
  }, 'Could not load settings.');
}

function renderCategoryManager() {
  const list = $('category-manage-list');
  if (!list) return;
  if (!categoriesCache.length) { list.replaceChildren(h('p', { class: 'settings-row-desc', text: 'No categories yet.' })); return; }
  list.replaceChildren(...categoriesCache.map(c => {
    const color = safeColor(c.color);
    return h('div', { class: 'category-manage-item' },
      h('span', { class: 'category-manage-emoji', style: { background: tint(color), color }, text: c.emoji }),
      h('span', { class: 'category-manage-name', text: c.name }),
      h('span', { class: 'category-manage-type', text: c.type === 'income' ? 'Income' : 'Expense' }),
      h('button', { class: 'txn-action-btn delete', type: 'button', title: 'Delete category', 'aria-label': `Delete category ${c.name}`,
                    onclick: e => deleteCategory(c, e.currentTarget) }, icon('icon-trash')));
  }));
}

async function deleteCategory(cat, button) {
  if (!confirm(`Delete the "${cat.name}" category? Existing transactions keep their label.`)) return;
  await withBusy(button, null, async () => {
    try {
      await Api.del(`/api/categories/${encodeURIComponent(cat.id)}`);
      showToast('Category deleted');
      await refreshCategoriesCache();
      renderCategoryManager();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
