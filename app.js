/* ============================================================
   FINLYTICS — Application Logic
   ============================================================ */

'use strict';

// ── Data ─────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'Food',          emoji: '🍔', color: '#F59E0B', bg: '#FEF3C7' },
  { id: 'Transport',     emoji: '🚗', color: '#6366F1', bg: '#EEF2FF' },
  { id: 'Shopping',      emoji: '🛍',  color: '#EC4899', bg: '#FCE7F3' },
  { id: 'Bills',         emoji: '⚡',  color: '#EF4444', bg: '#FEE2E2' },
  { id: 'Entertainment', emoji: '🎬', color: '#8B5CF6', bg: '#EDE9FE' },
  { id: 'Health',        emoji: '❤️',  color: '#10B981', bg: '#D1FAE5' },
  { id: 'Travel',        emoji: '✈️',  color: '#0EA5E9', bg: '#E0F2FE' },
  { id: 'Education',     emoji: '📚', color: '#14B8A6', bg: '#CCFBF1' },
];

const INCOME_CATEGORIES = [
  { id: 'Salary',     emoji: '💼', color: '#10B981', bg: '#D1FAE5' },
  { id: 'Freelance',  emoji: '💻', color: '#6366F1', bg: '#EEF2FF' },
  { id: 'Investment', emoji: '📈', color: '#0EA5E9', bg: '#E0F2FE' },
  { id: 'Other',      emoji: '💰', color: '#F59E0B', bg: '#FEF3C7' },
];

// Seeded transaction data
let transactions = [
  { id:1,  type:'expense', merchant:'Whole Foods Market',  category:'Food',          amount:87.40,  date:'2026-07-03', notes:'' },
  { id:2,  type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',        amount:6200.00,date:'2026-07-01', notes:'Monthly salary' },
  { id:3,  type:'expense', merchant:'Netflix',              category:'Entertainment', amount:15.99,  date:'2026-07-01', notes:'' },
  { id:4,  type:'expense', merchant:'Uber',                 category:'Transport',     amount:22.50,  date:'2026-07-02', notes:'Airport ride' },
  { id:5,  type:'expense', merchant:'Apple Store',          category:'Shopping',     amount:299.00, date:'2026-06-30', notes:'AirPods' },
  { id:6,  type:'expense', merchant:'PG&E Electric',        category:'Bills',         amount:134.00, date:'2026-06-28', notes:'' },
  { id:7,  type:'expense', merchant:'Starbucks',            category:'Food',          amount:6.75,   date:'2026-06-28', notes:'Morning coffee' },
  { id:8,  type:'expense', merchant:'Planet Fitness',       category:'Health',        amount:25.00,  date:'2026-06-27', notes:'' },
  { id:9,  type:'expense', merchant:'Delta Airlines',       category:'Travel',        amount:480.00, date:'2026-06-25', notes:'NYC trip' },
  { id:10, type:'expense', merchant:'Coursera',             category:'Education',     amount:49.00,  date:'2026-06-24', notes:'' },
  { id:11, type:'expense', merchant:'Chipotle',             category:'Food',          amount:12.30,  date:'2026-06-23', notes:'' },
  { id:12, type:'income',  merchant:'Freelance Project',    category:'Freelance',     amount:850.00, date:'2026-06-22', notes:'Web design gig' },
  { id:13, type:'expense', merchant:'Amazon',               category:'Shopping',     amount:67.00,  date:'2026-06-21', notes:'' },
  { id:14, type:'expense', merchant:'Spotify',              category:'Entertainment', amount:9.99,   date:'2026-06-20', notes:'' },
  { id:15, type:'expense', merchant:'Target',               category:'Shopping',     amount:113.40, date:'2026-06-18', notes:'' },
  { id:16, type:'expense', merchant:'Shell Gas Station',    category:'Transport',     amount:55.00,  date:'2026-06-17', notes:'' },
  { id:17, type:'expense', merchant:'CVS Pharmacy',         category:'Health',        amount:34.50,  date:'2026-06-15', notes:'' },
  { id:18, type:'expense', merchant:'Verizon Wireless',     category:'Bills',         amount:89.00,  date:'2026-06-14', notes:'' },
  { id:19, type:'expense', merchant:'McDonald\'s',          category:'Food',          amount:8.50,   date:'2026-06-12', notes:'' },
  { id:20, type:'income',  merchant:'Dividend — AAPL',      category:'Investment',    amount:142.50, date:'2026-06-10', notes:'' },
];

let budgets = [
  { category:'Food',          limit:600,  emoji:'🍔', color:'#F59E0B' },
  { category:'Transport',     limit:200,  emoji:'🚗', color:'#6366F1' },
  { category:'Shopping',      limit:400,  emoji:'🛍',  color:'#EC4899' },
  { category:'Bills',         limit:350,  emoji:'⚡',  color:'#EF4444' },
  { category:'Entertainment', limit:100,  emoji:'🎬', color:'#8B5CF6' },
  { category:'Health',        limit:150,  emoji:'❤️',  color:'#10B981' },
  { category:'Travel',        limit:1500, emoji:'✈️',  color:'#0EA5E9' },
  { category:'Education',     limit:200,  emoji:'📚', color:'#14B8A6' },
];

// ── State ─────────────────────────────────────────────────────
let currentPage      = 'dashboard';
let currentType      = 'expense';
let selectedCategory = null;
let activeFilter     = 'all';
let nextId           = 21;
let donutChart, trendChart, analyticsBarChart, savingsChart;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setCurrentDate();
  buildCategoryGrid();
  renderRecentTransactions();
  renderDonutChart();
  renderTrendChart();
  renderTransactionsPage();
  renderBudgets();
  renderAnalytics();
  syncThemeToggle();
  prefillDate();

  // Sync dark-mode toggle in settings
  document.getElementById('dark-mode-toggle').addEventListener('change', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    if (isDark !== document.getElementById('dark-mode-toggle').checked) toggleTheme();
  });
});

// ── Date helper ───────────────────────────────────────────────
function setCurrentDate() {
  const now = new Date();
  const opts = { weekday:'short', month:'long', day:'numeric', year:'numeric' };
  document.getElementById('current-date').textContent =
    now.toLocaleDateString('en-US', opts);
}

function prefillDate() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('txn-date').value = today;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function groupLabel(dateStr) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const d     = new Date(dateStr + 'T00:00:00');
  const diffMs = today - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return 'This Week';
  if (diffDays < 14) return 'Last Week';
  const month = d.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  return month;
}

function fmtAmount(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── Navigation ────────────────────────────────────────────────
function navigate(page, el) {
  if (event) event.preventDefault();

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  // Sidebar active
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sidebarLink = document.getElementById('nav-' + page);
  if (sidebarLink) sidebarLink.classList.add('active');

  // Bottom nav active
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const bnavLink = document.getElementById('bnav-' + page);
  if (bnavLink) bnavLink.classList.add('active');

  currentPage = page;

  // Lazy-init charts when analytics page first loads
  if (page === 'analytics') {
    setTimeout(() => {
      if (!analyticsBarChart) renderAnalyticsBarChart();
      if (!savingsChart)      renderSavingsChart();
    }, 50);
  }
}

// ── Theme ─────────────────────────────────────────────────────
function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme === 'dark';
  root.dataset.theme = isDark ? 'light' : 'dark';
  syncThemeToggle();
  rebuildCharts();
}

function syncThemeToggle() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) toggle.checked = isDark;
}

function rebuildCharts() {
  setTimeout(() => {
    if (donutChart)       { donutChart.destroy();       donutChart = null;       renderDonutChart(); }
    if (trendChart)       { trendChart.destroy();       trendChart = null;       renderTrendChart(); }
    if (analyticsBarChart){ analyticsBarChart.destroy(); analyticsBarChart = null; renderAnalyticsBarChart(); }
    if (savingsChart)     { savingsChart.destroy();     savingsChart = null;     renderSavingsChart(); }
  }, 100);
}

function isDark() { return document.documentElement.dataset.theme === 'dark'; }

// ── Category Grid (Modal) ─────────────────────────────────────
function buildCategoryGrid() {
  const grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  const cats = currentType === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (selectedCategory === cat.id ? ' selected' : '');
    btn.setAttribute('aria-pressed', selectedCategory === cat.id);
    btn.innerHTML = `<span class="cat-emoji">${cat.emoji}</span><span>${cat.id}</span>`;
    btn.onclick = () => selectCategory(cat.id, btn);
    grid.appendChild(btn);
  });
  selectedCategory = null;
}

function selectCategory(id, btn) {
  selectedCategory = id;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.remove('selected');
    b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-pressed', 'true');
}

function setType(type) {
  currentType = type;
  document.getElementById('type-expense').classList.toggle('active', type === 'expense');
  document.getElementById('type-income').classList.toggle('active',  type === 'income');
  buildCategoryGrid();
}

// ── Modal ─────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-modal-overlay').classList.add('open');
  document.getElementById('txn-amount').focus();
  document.body.style.overflow = 'hidden';
}

function closeAddModal(e) {
  if (e && e.target !== document.getElementById('add-modal-overlay')) return;
  document.getElementById('add-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  resetModal();
}

function resetModal() {
  document.getElementById('txn-amount').value = '';
  document.getElementById('txn-notes').value  = '';
  document.getElementById('txn-merchant').value = '';
  document.getElementById('txn-recurring').checked = false;
  setType('expense');
  prefillDate();
}

function saveTransaction() {
  const amount   = parseFloat(document.getElementById('txn-amount').value);
  const merchant = document.getElementById('txn-merchant').value.trim() || 'Unknown';
  const date     = document.getElementById('txn-date').value;
  const notes    = document.getElementById('txn-notes').value.trim();

  if (!amount || amount <= 0) { showToast('⚠️ Please enter a valid amount'); return; }
  if (!selectedCategory)       { showToast('⚠️ Please select a category');   return; }
  if (!date)                   { showToast('⚠️ Please select a date');        return; }

  const txn = { id: nextId++, type: currentType, merchant, category: selectedCategory, amount, date, notes };
  transactions.unshift(txn);

  closeAddModal();
  resetModal();

  renderRecentTransactions();
  renderTransactionsPage();
  updateDonutChart();
  renderBudgets();

  showToast('✅ Transaction saved!');
}

// ── Recent Transactions ───────────────────────────────────────
function renderRecentTransactions() {
  const list = document.getElementById('recent-transactions');
  const recent = transactions.slice(0, 5);
  list.innerHTML = '';

  if (!recent.length) {
    list.innerHTML = emptyStateHTML('🧾', 'No transactions yet', 'Tap + to add your first one.');
    return;
  }

  recent.forEach(t => { list.appendChild(buildTxnRow(t, false)); });
}

function getCatInfo(catId) {
  return [...CATEGORIES, ...INCOME_CATEGORIES].find(c => c.id === catId)
      || { emoji:'💳', color:'#64748B', bg:'#F1F5F9' };
}

function buildTxnRow(t, showActions = true) {
  const cat   = getCatInfo(t.category);
  const isExp = t.type === 'expense';
  const row   = document.createElement('div');
  row.className = 'txn-row';
  row.dataset.id = t.id;
  row.innerHTML = `
    <div class="txn-icon" style="background:${cat.bg};">${cat.emoji}</div>
    <div class="txn-info">
      <div class="txn-merchant">${escHtml(t.merchant)}</div>
      <div class="txn-meta">
        <span class="txn-category-tag" style="background:${cat.bg};color:${cat.color};">${t.category}</span>
        <span class="txn-date">${fmtDate(t.date)}</span>
      </div>
    </div>
    <div class="txn-right">
      <div class="txn-amount ${isExp ? 'expense' : 'income'}">${isExp ? '-' : '+'}${fmtAmount(t.amount)}</div>
    </div>
    ${showActions ? `<div class="txn-actions">
      <button class="txn-action-btn delete" onclick="deleteTransaction(${t.id})" aria-label="Delete transaction">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>` : ''}
  `;
  return row;
}

function deleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  renderRecentTransactions();
  renderTransactionsPage();
  updateDonutChart();
  renderBudgets();
  showToast('🗑 Transaction deleted');
}

// ── Transactions Page ─────────────────────────────────────────
function renderTransactionsPage() {
  const total = transactions.length;
  document.getElementById('txn-count-label').textContent = `${total} transaction${total !== 1 ? 's' : ''}`;
  filterTransactions();
}

function filterTransactions() {
  const query  = (document.getElementById('txn-search')?.value || '').toLowerCase();
  let filtered = transactions.filter(t => {
    const matchFilter =
      activeFilter === 'all'    ? true :
      activeFilter === 'income' ? t.type === 'income' :
      t.category === activeFilter;
    const matchSearch = !query ||
      t.merchant.toLowerCase().includes(query) ||
      t.category.toLowerCase().includes(query);
    return matchFilter && matchSearch;
  });

  renderGroupedTransactions(filtered);
}

function setFilter(val, btn) {
  activeFilter = val;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  filterTransactions();
}

function renderGroupedTransactions(txns) {
  const container = document.getElementById('transactions-grouped');
  container.innerHTML = '';

  if (!txns.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:16px;';
    empty.innerHTML = emptyStateHTML('🔍', 'No results found', 'Try a different search or filter.');
    container.appendChild(empty);
    return;
  }

  // Group by label
  const groups = {};
  txns.forEach(t => {
    const label = groupLabel(t.date);
    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
  });

  for (const [label, items] of Object.entries(groups)) {
    const headerEl = document.createElement('div');
    headerEl.className = 'txn-group-header';
    headerEl.textContent = label;
    container.appendChild(headerEl);

    const listEl = document.createElement('div');
    listEl.className = 'txn-group-list';
    items.forEach(t => listEl.appendChild(buildTxnRow(t, true)));
    container.appendChild(listEl);
  }
}

// ── Budgets ───────────────────────────────────────────────────
function renderBudgets() {
  const grid = document.getElementById('budget-grid');
  grid.innerHTML = '';

  if (!budgets.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;background:var(--surface);border:1px solid var(--border);border-radius:16px;">
      ${emptyStateHTML('💰', 'No budgets yet', 'Set spending limits for each category.')}</div>`;
    return;
  }

  budgets.forEach((b, idx) => {
    const spent = transactions
      .filter(t => t.type === 'expense' && t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const pct = Math.min((spent / b.limit) * 100, 100);
    const fillColor = pct < 60 ? '#10B981' : pct < 85 ? '#F59E0B' : '#EF4444';
    const pctLabel  = pct < 60 ? 'var(--green)' : pct < 85 ? 'var(--amber)' : 'var(--red)';
    const remaining = Math.max(b.limit - spent, 0);

    const card = document.createElement('div');
    card.className = 'budget-card';
    card.innerHTML = `
      <div class="budget-card-header">
        <div class="budget-cat-icon" style="background:${b.color}1a;">${b.emoji}</div>
        <div class="budget-cat-info">
          <div class="budget-cat-name">${b.category}</div>
          <div class="budget-cat-period">Monthly budget</div>
        </div>
        <div class="budget-amounts">
          <div class="budget-spent">${fmtAmount(spent)}</div>
          <div class="budget-limit">of ${fmtAmount(b.limit)}</div>
        </div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width:${pct.toFixed(1)}%;background:${fillColor};"></div>
      </div>
      <div class="budget-footer">
        <span class="budget-pct" style="color:${pctLabel};">${pct.toFixed(0)}% used</span>
        <span class="budget-remaining">${fmtAmount(remaining)} remaining</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openAddBudgetModal() {
  document.getElementById('add-budget-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAddBudgetModal(e) {
  if (e && e.target !== document.getElementById('add-budget-overlay')) return;
  document.getElementById('add-budget-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function saveBudget() {
  const cat   = document.getElementById('budget-category').value;
  const limit = parseFloat(document.getElementById('budget-limit').value);
  if (!limit || limit <= 0) { showToast('⚠️ Enter a valid limit'); return; }

  const existing = budgets.findIndex(b => b.category === cat);
  const catInfo  = [...CATEGORIES, ...INCOME_CATEGORIES].find(c => c.id === cat) || { emoji:'💳', color:'#6366F1' };
  if (existing >= 0) {
    budgets[existing].limit = limit;
  } else {
    budgets.push({ category: cat, limit, emoji: catInfo.emoji, color: catInfo.color });
  }
  closeAddBudgetModal();
  renderBudgets();
  showToast('✅ Budget saved!');
}

// ── Charts ────────────────────────────────────────────────────
function chartDefaults() {
  return {
    color:       isDark() ? '#94A3B8' : '#64748B',
    gridColor:   isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    tickColor:   isDark() ? '#475569' : '#94A3B8',
  };
}

// Donut Chart
function renderDonutChart() {
  const ctx  = document.getElementById('donutChart');
  if (!ctx) return;

  const catTotals = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  });

  const labels  = Object.keys(catTotals);
  const values  = Object.values(catTotals);
  const colors  = labels.map(l => CATEGORIES.find(c => c.id === l)?.color || '#64748B');
  const total   = values.reduce((a, b) => a + b, 0);

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 3,
      borderColor: isDark() ? '#0F172A' : '#FFFFFF', hoverOffset: 8 }] },
    options: {
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.label}: ${fmtAmount(ctx.parsed)} (${((ctx.parsed/total)*100).toFixed(1)}%)` }
      }},
      animation: { animateRotate: true, duration: 700, easing: 'easeInOutQuart' },
    }
  });

  // Legend
  const legend = document.getElementById('donut-legend');
  if (!legend) return;
  legend.innerHTML = '';
  labels.forEach((label, i) => {
    const pct  = ((values[i] / total) * 100).toFixed(0);
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${colors[i]};"></span>
      <span class="legend-name">${label}</span>
      <span class="legend-amount">${fmtAmount(values[i])}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legend.appendChild(item);
  });
}

function updateDonutChart() {
  if (donutChart) { donutChart.destroy(); donutChart = null; }
  renderDonutChart();
}

// Trend Chart
function renderTrendChart() {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;
  const cd  = chartDefaults();

  const months  = ['Jan','Feb','Mar','Apr','May','Jun'];
  const income  = [5800, 6200, 5800, 6200, 5900, 6200];
  const expense = [3200, 3800, 2900, 4100, 3500, 3842];

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Income',
          data: income,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: '#10B981',
          pointBorderColor: isDark() ? '#0F172A' : '#FFF',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        },
        {
          label: 'Expenses',
          data: expense,
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          tension: 0.4,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: '#EF4444',
          pointBorderColor: isDark() ? '#0F172A' : '#FFF',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark() ? '#1E293B' : '#0F172A',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          padding: 12,
          cornerRadius: 10,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtAmount(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: { color: cd.gridColor }, ticks: { color: cd.tickColor, font: { size:11, family:'Inter' } } },
        y: { grid: { color: cd.gridColor }, ticks: {
          color: cd.tickColor,
          font: { size:11, family:'Inter' },
          callback: v => '$' + (v/1000).toFixed(1) + 'k'
        }}
      }
    }
  });
}

// Analytics Bar Chart
function renderAnalyticsBarChart() {
  const ctx = document.getElementById('analyticsBarChart');
  if (!ctx) return;
  const cd  = chartDefaults();

  const months  = ['Jan','Feb','Mar','Apr','May','Jun'];
  const income  = [5800, 6200, 5800, 6200, 5900, 6200];
  const expense = [3200, 3800, 2900, 4100, 3500, 3842];

  analyticsBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label:'Income',  data:income,  backgroundColor:'rgba(16,185,129,0.85)',  borderRadius:6, borderSkipped:false },
        { label:'Expenses',data:expense, backgroundColor:'rgba(239,68,68,0.8)',    borderRadius:6, borderSkipped:false },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:false },
        tooltip: {
          backgroundColor: isDark() ? '#1E293B' : '#0F172A',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          padding: 12,
          cornerRadius: 10,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtAmount(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid:{ display:false }, ticks:{ color:cd.tickColor, font:{size:11,family:'Inter'} } },
        y: { grid:{ color:cd.gridColor }, ticks:{
          color:cd.tickColor, font:{size:11,family:'Inter'},
          callback: v => '$' + (v/1000).toFixed(1) + 'k'
        }}
      }
    }
  });
}

function renderSavingsChart() {
  const ctx = document.getElementById('savingsRateChart');
  if (!ctx) return;
  const cd  = chartDefaults();

  const months = ['Jan','Feb','Mar','Apr','May','Jun'];
  const rates  = [45, 39, 50, 34, 41, 38];

  savingsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Savings Rate',
        data: rates,
        borderColor: '#6366F1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 5,
        pointBackgroundColor: '#6366F1',
        pointBorderColor: isDark() ? '#0F172A' : '#FFF',
        pointBorderWidth: 2,
        borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: {
          backgroundColor: isDark() ? '#1E293B' : '#0F172A',
          titleColor: '#F8FAFC',
          bodyColor: '#94A3B8',
          padding:12, cornerRadius:10,
          callbacks: { label: ctx => ` Savings: ${ctx.parsed.y}%` }
        }
      },
      scales: {
        x: { grid:{ color:cd.gridColor }, ticks:{ color:cd.tickColor, font:{size:11,family:'Inter'} } },
        y: { grid:{ color:cd.gridColor }, ticks:{
          color:cd.tickColor, font:{size:11,family:'Inter'},
          callback: v => v + '%'
        }, min:0, max:70 }
      }
    }
  });
}

// ── Analytics Page ────────────────────────────────────────────
function renderAnalytics() {
  renderTopCategories();
  renderHeatmap();
}

function renderTopCategories() {
  const list = document.getElementById('top-categories-list');
  if (!list) return;
  list.innerHTML = '';

  const catTotals = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  });

  const sorted  = Object.entries(catTotals).sort((a,b) => b[1] - a[1]);
  const maxAmt  = sorted[0]?.[1] || 1;

  sorted.slice(0, 7).forEach(([cat, amt], i) => {
    const catInfo = CATEGORIES.find(c => c.id === cat) || { emoji:'💳', color:'#6366F1', bg:'#EEF2FF' };
    const pct     = (amt / maxAmt) * 100;
    const row     = document.createElement('div');
    row.className = 'top-cat-row';
    row.innerHTML = `
      <div class="top-cat-icon" style="background:${catInfo.bg};">${catInfo.emoji}</div>
      <div class="top-cat-info">
        <div class="top-cat-name">${cat}</div>
        <div class="top-cat-bar-bg">
          <div class="top-cat-bar-fill" style="width:${pct.toFixed(1)}%;background:${catInfo.color};"></div>
        </div>
      </div>
      <div class="top-cat-amount">${fmtAmount(amt)}</div>
    `;
    list.appendChild(row);
  });
}

function renderHeatmap() {
  const cal = document.getElementById('heatmap-calendar');
  if (!cal) return;
  cal.innerHTML = '';

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  days.forEach(d => {
    const el = document.createElement('div');
    el.className = 'heatmap-day-label';
    el.textContent = d;
    cal.appendChild(el);
  });

  // June 2026: starts on Monday (index 1)
  const daysInJune = 30;
  const startDay   = 1; // Monday

  // Build spend map
  const spendMap = {};
  transactions.filter(t => t.type === 'expense' && t.date.startsWith('2026-06')).forEach(t => {
    const day = parseInt(t.date.split('-')[2]);
    spendMap[day] = (spendMap[day] || 0) + t.amount;
  });
  const maxSpend = Math.max(...Object.values(spendMap), 1);

  // Empty padding cells
  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'heatmap-cell empty';
    cal.appendChild(empty);
  }

  for (let d = 1; d <= daysInJune; d++) {
    const cell    = document.createElement('div');
    const spend   = spendMap[d] || 0;
    const pct     = spend / maxSpend;
    const opacity = spend ? (0.2 + pct * 0.8) : 0;
    cell.className = 'heatmap-cell';
    cell.textContent = d;
    cell.style.background = spend
      ? `rgba(99,102,241,${opacity.toFixed(2)})`
      : 'var(--surface-2)';
    cell.style.color = pct > 0.5 ? '#FFF' : 'var(--text-muted)';
    if (spend) {
      cell.title = `June ${d}: ${fmtAmount(spend)}`;
    }
    cal.appendChild(cell);
  }
}

// ── Export ────────────────────────────────────────────────────
function exportData() {
  const header = 'Date,Type,Merchant,Category,Amount,Notes\n';
  const rows   = transactions.map(t =>
    `${t.date},${t.type},"${t.merchant}",${t.category},${t.amount.toFixed(2)},"${t.notes}"`
  ).join('\n');
  const blob   = new Blob([header + rows], { type:'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = 'finlytics-export.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Export downloaded!');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── Utilities ─────────────────────────────────────────────────
function emptyStateHTML(emoji, title, desc) {
  return `<div class="empty-state">
    <div class="empty-emoji">${emoji}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
    <button class="btn-primary" style="margin-top:8px" onclick="openAddModal()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add Transaction
    </button>
  </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
