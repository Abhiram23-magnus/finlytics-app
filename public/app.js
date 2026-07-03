// ============================================================
// FINLYTICS — Main App Logic (Light Theme & Custom Categories)
// ============================================================

// ── State ──
let currentUser  = null;
let currentMonth = '';
let currentCurrencySymbol = '$';
let categoryChartInstance = null;
let trendChartInstance    = null;

// Chart Colors requested: Green, Blue, Purple, Amber, Cyan
const CHART_COLORS = [
  '#10B981', // Emerald (Green)
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#06B6D4', // Cyan
  '#EC4899', // Pink
  '#F43F5E', // Rose
  '#14B8A6'  // Teal
];

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const d = new Date();
  currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  
  document.getElementById('dash-date').innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    ${d.toLocaleString('default', { month: 'long', year: 'numeric' })}
  `;

  await checkAuth();
  
  // Setup navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const page = e.currentTarget.dataset.page;
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');
      if (page === 'transactions') loadTransactions();
      if (page === 'budgets') loadBudgets();
    });
  });

  // Setup modals
  document.getElementById('txn-form').addEventListener('submit', handleSaveTxn);
  document.getElementById('budget-form').addEventListener('submit', handleSaveBudget);
  document.getElementById('monthly-budget-form').addEventListener('submit', handleSaveMonthlyBudget);
  document.getElementById('create-cat-form').addEventListener('submit', handleCreateCategory);

  // Filter chips
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      loadTransactions();
    });
  });

  // Color Swatches
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      e.target.classList.add('selected');
      document.getElementById('cc-color-val').value = e.target.dataset.color;
      document.getElementById('cc-bg-val').value = e.target.dataset.bg;
    });
  });
});

// ── Auth ──
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    currentUser = await res.json();
    
    // Set currency symbol based on code
    const map = { USD:'$', EUR:'€', GBP:'£', INR:'₹', JPY:'¥', CAD:'C$', AUD:'A$' };
    currentCurrencySymbol = map[currentUser.currency] || currentUser.currency;

    // Update UI
    document.getElementById('sb-user-name').textContent = currentUser.name;
    document.getElementById('sb-user-initial').textContent = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('st-user-name').textContent = currentUser.name;
    document.getElementById('st-user-email').textContent = currentUser.email;
    document.getElementById('st-user-initial').textContent = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('dash-greeting').textContent = `Hi, ${currentUser.name.split(' ')[0]}`;
    
    // Currency Select
    const curSelect = document.getElementById('setting-currency');
    const currencies = [
      {code:'USD',sym:'$'}, {code:'EUR',sym:'€'}, {code:'GBP',sym:'£'}, {code:'INR',sym:'₹'}, 
      {code:'JPY',sym:'¥'}, {code:'CAD',sym:'C$'}, {code:'AUD',sym:'A$'}
    ];
    curSelect.innerHTML = currencies.map(c => `<option value="${c.code}" ${currentUser.currency===c.code?'selected':''}>${c.code} (${c.sym})</option>`).join('');

    // Theme setup
    const isDark = currentUser.theme === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('setting-theme').checked = isDark;

    loadDashboard();
  } catch (err) {
    window.location.href = '/login.html';
  }
}

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function updatePref(key, value) {
  await fetch('/api/auth/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value })
  });
  showToast('Preferences updated');
  if (key === 'currency') window.location.reload();
}

function updateTheme(isDark) {
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  updatePref('theme', theme);
  
  // Re-render charts for color updates
  if (document.querySelector('#page-dashboard').classList.contains('active')) {
    loadCharts();
  }
}

function toggleThemeGlobal(e) {
  if (e) e.preventDefault();
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const isDark = currentTheme === 'light'; // toggling to dark
  document.getElementById('setting-theme').checked = isDark;
  updateTheme(isDark);
}

// ── Formatters ──
function formatMoney(amount) {
  return currentCurrencySymbol + parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Toast ──
function showToast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${msg}`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Modals ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Categories API ──
let CACHED_CATEGORIES = [];
async function fetchCategories(type = '') {
  const res = await fetch(`/api/categories${type ? '?type='+type : ''}`);
  return await res.json();
}
async function refreshCategoriesCache() {
  CACHED_CATEGORIES = await fetchCategories();
}
function getCategoryInfo(name) {
  const c = CACHED_CATEGORIES.find(c => c.name === name);
  return c || { name, emoji: '🏷', color: '#64748B', bg: 'rgba(100,116,139,0.1)' };
}

// ── Dashboard ──
async function loadDashboard() {
  await refreshCategoriesCache();
  
  // Check if monthly budget is set
  const mbRes = await fetch(`/api/budgets/monthly?month=${currentMonth}`);
  const mbData = await mbRes.json();
  const monthlyBudget = mbData.budget ? mbData.budget.amount : 0;

  const res = await fetch('/api/analytics/summary');
  const data = await res.json();
  
  document.getElementById('val-balance').textContent  = formatMoney(data.balance);
  document.getElementById('val-income').textContent   = formatMoney(data.monthlyIncome);
  document.getElementById('val-expenses').textContent = formatMoney(data.monthlyExpenses);
  document.getElementById('val-savings').textContent  = data.savingsRate + '%';

  if (!monthlyBudget && data.monthlyExpenses === 0 && data.monthlyIncome === 0) {
    // Brand new month/account, prompt to set overarching budget
    openMonthlyBudgetModal();
  } else {
    // Show top tracker
    document.getElementById('bov-card').style.display = 'block';
    const spent = data.monthlyExpenses;
    const limit = monthlyBudget || 0; // If 0, maybe they didn't set one yet but have expenses
    document.getElementById('bov-spent').textContent = formatMoney(spent);
    document.getElementById('bov-limit').textContent = limit > 0 ? formatMoney(limit) : 'Not set';
    
    let pct = limit > 0 ? (spent / limit) * 100 : 0;
    if (pct > 100) pct = 100;
    const fill = document.getElementById('bov-fill');
    fill.style.width = pct + '%';
    
    // Status color
    fill.className = 'bov-bar-fill'; // reset
    if (pct >= 90) {
      fill.classList.add('danger'); // Red
    } else if (pct >= 75) {
      fill.classList.add('amber'); // Amber
    }
    
    document.getElementById('bov-pct').textContent = `${Math.round(pct)}% used`;
    if (limit > 0) {
      const rem = limit - spent;
      document.getElementById('bov-rem').textContent = rem >= 0 ? `${formatMoney(rem)} left` : `${formatMoney(Math.abs(rem))} over`;
      document.getElementById('bov-rem').style.color = rem >= 0 ? 'var(--text-muted)' : 'var(--red)';
    } else {
      document.getElementById('bov-rem').textContent = 'Set limit to track progress';
    }
  }

  loadRecentTxns();
  loadCharts();
}

// ── Overarching Budget Modal ──
function openMonthlyBudgetModal() {
  document.getElementById('mb-sym').textContent = currentCurrencySymbol;
  document.getElementById('mb-amount').value = '';
  openModal('monthly-budget-modal-overlay');
}
async function handleSaveMonthlyBudget(e) {
  e.preventDefault();
  const amt = document.getElementById('mb-amount').value;
  if (!amt) return;
  await fetch('/api/budgets/monthly', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: currentMonth, amount: amt })
  });
  closeModal('monthly-budget-modal-overlay');
  showToast('Monthly target saved');
  loadDashboard();
}

// ── Custom Category Modal ──
function openCreateCategoryModal() {
  // Can be called from anywhere. Default to expense
  setCcType('expense');
  document.getElementById('cc-name').value = '';
  document.getElementById('cc-emoji').value = '🏷';
  openModal('create-cat-modal-overlay');
}
function setCcType(type) {
  document.getElementById('cc-type').value = type;
  document.getElementById('cc-type-expense').classList.toggle('active', type === 'expense');
  document.getElementById('cc-type-income').classList.toggle('active', type === 'income');
}
async function handleCreateCategory(e) {
  e.preventDefault();
  const type  = document.getElementById('cc-type').value;
  const name  = document.getElementById('cc-name').value;
  const emoji = document.getElementById('cc-emoji').value;
  const color = document.getElementById('cc-color-val').value;
  const bg    = document.getElementById('cc-bg-val').value;

  const res = await fetch('/api/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name, emoji, color, bg })
  });

  if (res.ok) {
    closeModal('create-cat-modal-overlay');
    showToast('Category created!');
    await refreshCategoriesCache();
    // If the add txn modal is open, re-render its grid
    if (document.getElementById('txn-modal-overlay').classList.contains('open')) {
      renderCategoryGrid(document.getElementById('txn-type').value);
    }
  }
}

// ── Charts ──
async function loadCharts() {
  const [catRes, trendRes] = await Promise.all([
    fetch('/api/analytics/categories'),
    fetch('/api/analytics/trends')
  ]);
  const catData = await catRes.json();
  const trendData = await trendRes.json();

  // Donut
  const ctxCat = document.getElementById('categoryChart').getContext('2d');
  if (categoryChartInstance) categoryChartInstance.destroy();
  
  const total = catData.reduce((s,c)=>s+c.total, 0);
  document.getElementById('donut-center-val').textContent = formatMoney(total);

  const labels = catData.map(c => c.category);
  const data   = catData.map(c => c.total);
  // Re-use chart colors based on index
  const bgColors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  categoryChartInstance = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      cutout: '75%', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (ctx) => ` ${currentCurrencySymbol}${ctx.raw}` }
      }}
    }
  });

  // Render Legend manually
  const leg = document.getElementById('donut-legend');
  if (catData.length === 0) {
    leg.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:13px; margin-top:20px;">No expense data yet</div>`;
  } else {
    leg.innerHTML = catData.map((c, i) => {
      const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
      return `
        <div class="legend-item">
          <div class="legend-dot" style="background:${bgColors[i]}"></div>
          <span class="legend-name">${c.category}</span>
          <span class="legend-amount">${formatMoney(c.total)}</span>
          <span class="legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  // Trend
  const ctxTrend = document.getElementById('trendChart').getContext('2d');
  if (trendChartInstance) trendChartInstance.destroy();
  
  const mLabels = trendData.map(t => t.month);
  const incData = trendData.map(t => t.income);
  const expData = trendData.map(t => t.expenses);

    trendChartInstance = new Chart(ctxTrend, {
    type: 'line',
    data: {
      labels: mLabels,
      datasets: [
        { label: 'Income', data: incData, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 0, pointHitRadius: 20 },
        { label: 'Expenses', data: expData, borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.0)', borderWidth: 3, tension: 0.4, fill: false, pointRadius: 0, pointHitRadius: 20 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          grid: { display: false }, 
          ticks: { font: { family: 'Inter', size: 12 }, color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#64748B' } 
        },
        y: { 
          grid: { color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#2A2A2A' : '#E2E8F0' }, 
          border: { display: false }, 
          ticks: { font: { family: 'Inter', size: 12 }, color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#64748B', callback: (val) => currentCurrencySymbol+val } 
        }
      }
    }
  });
}

// ── Transaction Management ──
async function loadRecentTxns() {
  const res = await fetch('/api/transactions');
  const txns = await res.json();
  const list = document.getElementById('recent-txn-list');
  
  if (!txns.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📝</div>
        <h3 class="empty-title">No transactions yet</h3>
        <p class="empty-desc">Record your first income or expense to see it here.</p>
      </div>`;
    return;
  }

  list.innerHTML = txns.slice(0, 5).map(txn => renderTxnRow(txn)).join('');
}

async function loadTransactions() {
  const type   = document.querySelector('.filter-chips .chip.active').dataset.filterType;
  const search = document.getElementById('txn-search').value;
  
  let url = '/api/transactions?';
  if (type !== 'all') url += `type=${type}&`;
  if (search) url += `search=${encodeURIComponent(search)}`;

  const res = await fetch(url);
  const txns = await res.json();
  const list = document.getElementById('all-txn-list');
  
  // Group by date
  const grouped = {};
  txns.forEach(t => {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  });

  if (!txns.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-emoji">🔍</div><h3 class="empty-title">No results found</h3></div>`;
    return;
  }

  let html = '';
  for (const [date, items] of Object.entries(grouped)) {
    html += `<div class="txn-group-header">${formatDate(date)}</div>`;
    html += `<div class="txn-group-list">`;
    html += items.map(txn => renderTxnRow(txn)).join('');
    html += `</div>`;
  }
  list.innerHTML = html;
}

function renderTxnRow(txn) {
  const isExp = txn.type === 'expense';
  const cInfo = getCategoryInfo(txn.category);
  
  return `
    <div class="txn-row">
      <div class="txn-icon" style="background:${cInfo.bg}; color:${cInfo.color}">${cInfo.emoji}</div>
      <div class="txn-info">
        <div class="txn-merchant">${txn.merchant}</div>
        <div class="txn-meta">
          <span class="txn-category-tag" style="background:var(--surface-2); color:var(--text-secondary)">${txn.category}</span>
          <span class="txn-date">${formatDate(txn.date)}</span>
        </div>
      </div>
      <div class="txn-right">
        <div class="txn-amount ${txn.type}">${isExp?'-':'+'}${formatMoney(txn.amount)}</div>
      </div>
      <div class="txn-actions">
        <button class="txn-action-btn delete" onclick="deleteTxn(${txn.id})" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `;
}

// ── Transaction Modal ──
async function openTxnModal() {
  await refreshCategoriesCache();
  document.getElementById('txn-sym').textContent = currentCurrencySymbol;
  document.getElementById('txn-form').reset();
  document.getElementById('txn-date').valueAsDate = new Date();
  setTxnType('expense'); // will render grid
  openModal('txn-modal-overlay');
}

function setTxnType(type) {
  document.getElementById('txn-type').value = type;
  document.getElementById('type-expense').classList.toggle('active', type === 'expense');
  document.getElementById('type-income').classList.toggle('active', type === 'income');
  renderCategoryGrid(type);
}

function renderCategoryGrid(type) {
  const grid = document.getElementById('txn-cat-grid');
  const cats = CACHED_CATEGORIES.filter(c => c.type === type);
  
  let html = cats.map(c => `
    <div class="cat-btn" data-cat="${c.name}" onclick="selectTxnCat(this, '${c.name}')">
      <span class="cat-emoji">${c.emoji}</span>
      <span>${c.name}</span>
    </div>
  `).join('');
  
  // Add "New Category" button at the end
  html += `
    <div class="cat-btn add-cat-btn" onclick="openCreateCategoryModal()">
      <span class="cat-emoji" style="font-size:20px;">+</span>
      <span>New</span>
    </div>
  `;
  grid.innerHTML = html;
  document.getElementById('txn-category').value = '';
}

function selectTxnCat(el, name) {
  document.querySelectorAll('#txn-cat-grid .cat-btn').forEach(btn => btn.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('txn-category').value = name;
}

async function handleSaveTxn(e) {
  e.preventDefault();
  const cat = document.getElementById('txn-category').value;
  if (!cat) { alert('Please select a category.'); return; }

  const payload = {
    type: document.getElementById('txn-type').value,
    amount: document.getElementById('txn-amount').value,
    category: cat,
    merchant: document.getElementById('txn-merchant').value,
    date: document.getElementById('txn-date').value,
    notes: document.getElementById('txn-notes').value
  };

  await fetch('/api/transactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  closeModal('txn-modal-overlay');
  showToast('Transaction saved');
  
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-dashboard') loadDashboard();
  if (activePage === 'page-transactions') loadTransactions();
}

async function deleteTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  showToast('Transaction deleted');
  
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-dashboard') loadDashboard();
  if (activePage === 'page-transactions') loadTransactions();
}

// ── Budget Management ──
async function loadBudgets() {
  await refreshCategoriesCache();
  
  const mbRes = await fetch(`/api/budgets/monthly?month=${currentMonth}`);
  const mbData = await mbRes.json();
  const monthlyBudget = mbData.budget ? mbData.budget.amount : 0;

  const res = await fetch('/api/budgets');
  const budgets = await res.json();
  const list = document.getElementById('budget-list');

  // Compute Summary
  const totalLimit = budgets.reduce((s,b)=>s+b.limit_amount, 0);
  const totalSpent = budgets.reduce((s,b)=>s+b.spent, 0);
  const remain = totalLimit - totalSpent;
  const safeRem = remain < 0 ? 0 : remain;

  document.getElementById('budget-summary').innerHTML = `
    <div class="budget-summary-card">
      <span class="bsc-label">Global Target (This Month)</span>
      <span class="bsc-value" style="color:var(--primary)">${monthlyBudget > 0 ? formatMoney(monthlyBudget) : 'Not Set'}</span>
      <span style="font-size:12px; color:var(--text-muted); cursor:pointer" onclick="openMonthlyBudgetModal()">Click to edit target</span>
    </div>
    <div class="budget-summary-card">
      <span class="bsc-label">Sum of Category Limits</span>
      <span class="bsc-value">${formatMoney(totalLimit)}</span>
    </div>
    <div class="budget-summary-card">
      <span class="bsc-label">Remaining in Categories</span>
      <span class="bsc-value" style="color:${remain < 0 ? 'var(--red)' : 'var(--text-primary)'}">${formatMoney(safeRem)}</span>
    </div>
  `;

  if (!budgets.length) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-emoji">🎯</div>
        <h3 class="empty-title">No budgets set</h3>
        <p class="empty-desc">Create category limits to keep your spending in check.</p>
      </div>`;
    return;
  }

  list.innerHTML = budgets.map(b => {
    let pct = (b.spent / b.limit_amount) * 100;
    if (pct > 100) pct = 100;
    
    let color = b.color;
    if (pct >= 90) color = 'var(--red)';
    else if (pct >= 75) color = 'var(--amber)';

    const rem = b.limit_amount - b.spent;

    return `
      <div class="budget-card">
        <div class="budget-card-header">
          <div class="budget-cat-icon" style="background:${b.color}20; color:${b.color}">${b.emoji}</div>
          <div class="budget-cat-info">
            <div class="budget-cat-name">${b.category}</div>
            <div class="budget-cat-period">Monthly limit</div>
          </div>
          <div class="budget-amounts">
            <div class="budget-spent">${formatMoney(b.spent)}</div>
            <div class="budget-limit">of ${formatMoney(b.limit_amount)}</div>
          </div>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width:${pct}%; background:${color}"></div>
        </div>
        <div class="budget-footer">
          <span class="budget-pct" style="color:${color}">${Math.round(pct)}%</span>
          <span class="budget-remaining">${rem >= 0 ? formatMoney(rem)+' left' : formatMoney(Math.abs(rem))+' over'}</span>
          <button class="small-btn btn-outline" style="padding:4px 8px; font-size:12px; margin-left:auto" onclick="deleteBudget(${b.id})">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

async function openBudgetModal() {
  await refreshCategoriesCache();
  document.getElementById('budget-sym').textContent = currentCurrencySymbol;
  document.getElementById('budget-form').reset();
  
  const sel = document.getElementById('budget-category');
  const expCats = CACHED_CATEGORIES.filter(c => c.type === 'expense');
  sel.innerHTML = expCats.map(c => `<option value="${c.name}">${c.emoji} ${c.name}</option>`).join('');

  openModal('budget-modal-overlay');
}

async function handleSaveBudget(e) {
  e.preventDefault();
  const catName = document.getElementById('budget-category').value;
  const cInfo = getCategoryInfo(catName);

  const payload = {
    category: catName,
    limit_amount: document.getElementById('budget-limit').value,
    emoji: cInfo.emoji,
    color: cInfo.color
  };

  await fetch('/api/budgets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  closeModal('budget-modal-overlay');
  showToast('Budget saved');
  loadBudgets();
}

async function deleteBudget(id) {
  if (!confirm('Remove this category budget?')) return;
  await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
  showToast('Budget removed');
  loadBudgets();
}

// ── Utils ──
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => { clearTimeout(timeout); func(...args); };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
