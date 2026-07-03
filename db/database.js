// ============================================================
// FINLYTICS — Database Layer  (lowdb v1 — pure JS)
// ============================================================
'use strict';

const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

// If running on Vercel (or any read-only serverless), use /tmp
const IS_VERCEL = process.env.VERCEL === '1';
let DB_PATH = path.join(__dirname, 'finlytics.json');

if (IS_VERCEL) {
  DB_PATH = path.join(os.tmpdir(), 'finlytics.json');
  // Copy the bundled JSON to /tmp if it doesn't exist yet
  const bundledPath = path.join(__dirname, 'finlytics.json');
  if (!fs.existsSync(DB_PATH) && fs.existsSync(bundledPath)) {
    fs.copyFileSync(bundledPath, DB_PATH);
  }
}

const adapter = new FileSync(DB_PATH);
const db      = low(adapter);

// ── Auto-increment helper ─────────────────────────────────────
function nextId(collection) {
  const items = db.get(collection).value();
  if (!items.length) return 1;
  return Math.max(...items.map(i => i.id)) + 1;
}

// ── Init ──────────────────────────────────────────────────────
function initDb() {
  db.defaults({ users: [], categories: [], transactions: [], budgets: [], monthly_budgets: [] }).write();

  // Migrate: ensure monthly_budgets collection exists for older DB files
  if (!db.has('monthly_budgets').value()) {
    db.set('monthly_budgets', []).write();
  }
  
  // Migrate: ensure categories collection exists
  if (!db.has('categories').value()) {
    db.set('categories', []).write();
  }

  const existing = db.get('users').find({ email: 'demo@finlytics.app' }).value();
  if (!existing) {
    seedDemoData();
    console.log('  ✅  Demo data seeded (demo@finlytics.app / demo1234)');
  }

  console.log('  ✅  Database ready at', DB_PATH);
}

// ── Seed ─────────────────────────────────────────────────────
function seedDemoData() {
  const hash   = bcrypt.hashSync('demo1234', 10);
  const userId = nextId('users');

  db.get('users').push({
    id: userId, name: 'Alex Johnson', email: 'demo@finlytics.app',
    password_hash: hash, currency: 'USD', theme: 'dark',
    created_at: new Date().toISOString()
  }).write();

  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prev  = (m) => {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  const txns = [
    // Current month
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',        amount:6200.00, date:`${year}-${month}-01`, notes:'Monthly salary',  recurring:true },
    { type:'expense', merchant:'Whole Foods Market',  category:'Food',          amount:87.40,   date:`${year}-${month}-03`, notes:'',                recurring:false },
    { type:'expense', merchant:'Netflix',             category:'Entertainment', amount:15.99,   date:`${year}-${month}-01`, notes:'',                recurring:true },
    { type:'expense', merchant:'Uber',                category:'Transport',     amount:22.50,   date:`${year}-${month}-02`, notes:'Airport ride',    recurring:false },
    { type:'expense', merchant:'Apple Store',         category:'Shopping',      amount:299.00,  date:`${year}-${month}-03`, notes:'AirPods',         recurring:false },
    { type:'expense', merchant:'PG&E Electric',       category:'Bills',         amount:134.00,  date:`${year}-${month}-02`, notes:'',                recurring:true },
    { type:'expense', merchant:'Starbucks',           category:'Food',          amount:6.75,    date:`${year}-${month}-02`, notes:'Morning coffee',  recurring:false },
    { type:'expense', merchant:'Planet Fitness',      category:'Health',        amount:25.00,   date:`${year}-${month}-02`, notes:'',                recurring:true },
    // Previous months
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',  amount:5800, date:`${prev(1)}-01`, notes:'', recurring:true },
    { type:'expense', merchant:'Rent',                category:'Bills',   amount:1800, date:`${prev(1)}-05`, notes:'', recurring:true },
    { type:'expense', merchant:'Grocery Store',       category:'Food',    amount:320,  date:`${prev(1)}-10`, notes:'', recurring:false },
    { type:'expense', merchant:'Gas Station',         category:'Transport',amount:60,  date:`${prev(1)}-15`, notes:'', recurring:false },
    { type:'expense', merchant:'Amazon',              category:'Shopping',amount:220,  date:`${prev(1)}-20`, notes:'', recurring:false },
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',  amount:6200, date:`${prev(2)}-01`, notes:'', recurring:true },
    { type:'expense', merchant:'Rent',                category:'Bills',   amount:1800, date:`${prev(2)}-05`, notes:'', recurring:true },
    { type:'expense', merchant:'Grocery Store',       category:'Food',    amount:380,  date:`${prev(2)}-10`, notes:'', recurring:false },
    { type:'expense', merchant:'Airline Tickets',     category:'Travel',  amount:890,  date:`${prev(2)}-18`, notes:'', recurring:false },
    { type:'expense', merchant:'Electronics',         category:'Shopping',amount:340,  date:`${prev(2)}-22`, notes:'', recurring:false },
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',  amount:5800, date:`${prev(3)}-01`, notes:'', recurring:true },
    { type:'expense', merchant:'Rent',                category:'Bills',   amount:1800, date:`${prev(3)}-05`, notes:'', recurring:true },
    { type:'expense', merchant:'Food',                category:'Food',    amount:290,  date:`${prev(3)}-10`, notes:'', recurring:false },
    { type:'expense', merchant:'Transport',           category:'Transport',amount:110, date:`${prev(3)}-14`, notes:'', recurring:false },
    { type:'income',  merchant:'Freelance Project',   category:'Freelance',amount:600, date:`${prev(3)}-20`, notes:'', recurring:false },
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',  amount:6200, date:`${prev(4)}-01`, notes:'', recurring:true },
    { type:'expense', merchant:'Rent',                category:'Bills',   amount:1800, date:`${prev(4)}-05`, notes:'', recurring:true },
    { type:'expense', merchant:'Food',                category:'Food',    amount:410,  date:`${prev(4)}-10`, notes:'', recurring:false },
    { type:'expense', merchant:'Vacation',            category:'Travel',  amount:1200, date:`${prev(4)}-20`, notes:'Spring break', recurring:false },
    { type:'income',  merchant:'Acme Corp — Salary',  category:'Salary',  amount:5900, date:`${prev(5)}-01`, notes:'', recurring:true },
    { type:'expense', merchant:'Rent',                category:'Bills',   amount:1800, date:`${prev(5)}-05`, notes:'', recurring:true },
    { type:'expense', merchant:'Food',                category:'Food',    amount:350,  date:`${prev(5)}-10`, notes:'', recurring:false },
    { type:'expense', merchant:'Shopping',            category:'Shopping',amount:480,  date:`${prev(5)}-25`, notes:'', recurring:false },
  ];

  let id = nextId('transactions');
  txns.forEach(t => {
    db.get('transactions').push({ id: id++, user_id: userId, created_at: new Date().toISOString(), ...t }).write();
  });

  const budgetSeeds = [
    { category:'Food',          limit_amount:600,  emoji:'🍔', color:'#F59E0B' },
    { category:'Transport',     limit_amount:200,  emoji:'🚗', color:'#6366F1' },
    { category:'Shopping',      limit_amount:400,  emoji:'🛍',  color:'#EC4899' },
    { category:'Bills',         limit_amount:350,  emoji:'⚡',  color:'#EF4444' },
    { category:'Entertainment', limit_amount:100,  emoji:'🎬', color:'#8B5CF6' },
    { category:'Health',        limit_amount:150,  emoji:'❤️',  color:'#22C55E' },
    { category:'Travel',        limit_amount:1500, emoji:'✈️',  color:'#0EA5E9' },
    { category:'Education',     limit_amount:200,  emoji:'📚', color:'#14B8A6' },
  ];
  let budgetId = nextId('budgets');
  budgetSeeds.forEach(b => {
    db.get('budgets').push({ id: budgetId++, user_id: userId, ...b }).write();
  });

  // Seed custom categories
  const categorySeeds = [
    { type:'expense', name:'Food',          emoji:'🍔', color:'#10B981', bg:'rgba(16, 185, 129, 0.12)' },
    { type:'expense', name:'Transport',     emoji:'🚗', color:'#3B82F6', bg:'rgba(59, 130, 246, 0.12)' },
    { type:'expense', name:'Shopping',      emoji:'🛍',  color:'#8B5CF6', bg:'rgba(139, 92, 246, 0.12)' },
    { type:'expense', name:'Bills',         emoji:'⚡',  color:'#EF4444', bg:'rgba(239, 68, 68, 0.12)' },
    { type:'expense', name:'Entertainment', emoji:'🎬', color:'#F59E0B', bg:'rgba(245, 158, 11, 0.12)' },
    { type:'expense', name:'Health',        emoji:'❤️',  color:'#14B8A6', bg:'rgba(20, 184, 166, 0.12)' },
    { type:'expense', name:'Travel',        emoji:'✈️',  color:'#06B6D4', bg:'rgba(6, 182, 212, 0.12)' },
    { type:'expense', name:'Education',     emoji:'📚', color:'#6366F1', bg:'rgba(99, 102, 241, 0.12)' },
    { type:'income',  name:'Salary',        emoji:'💼', color:'#10B981', bg:'rgba(16, 185, 129, 0.12)' },
    { type:'income',  name:'Freelance',     emoji:'💻', color:'#3B82F6', bg:'rgba(59, 130, 246, 0.12)' },
    { type:'income',  name:'Investment',    emoji:'📈', color:'#8B5CF6', bg:'rgba(139, 92, 246, 0.12)' },
    { type:'income',  name:'Other',         emoji:'💰', color:'#F59E0B', bg:'rgba(245, 158, 11, 0.12)' }
  ];
  let catId = nextId('categories');
  categorySeeds.forEach(c => {
    db.get('categories').push({ id: catId++, user_id: userId, ...c }).write();
  });

  // Seed current month budget
  const monthKey = `${year}-${month}`;
  db.get('monthly_budgets').push({
    id: nextId('monthly_budgets'), user_id: userId,
    month: monthKey, amount: 5000
  }).write();
}

// ════════════════════════════════════════════════════════════
// DATA ACCESS FUNCTIONS
// ════════════════════════════════════════════════════════════

// ── Users ─────────────────────────────────────────────────────
const Users = {
  findByEmail: (email) =>
    db.get('users').find(u => u.email === email.toLowerCase().trim()).value(),

  findById: (id) =>
    db.get('users').find({ id }).value(),

  create: ({ name, email, password, currency = 'USD' }) => {
    const hash = bcrypt.hashSync(password, 10);
    const user = {
      id: nextId('users'), name: name.trim(),
      email: email.toLowerCase().trim(),
      password_hash: hash, currency, theme: 'dark',
      created_at: new Date().toISOString()
    };
    db.get('users').push(user).write();
    return user;
  },

  verifyPassword: (user, password) =>
    bcrypt.compareSync(password, user.password_hash),

  updatePassword: (id, newPassword) => {
    const hash = bcrypt.hashSync(newPassword, 10);
    db.get('users').find({ id }).assign({ password_hash: hash }).write();
  },

  updatePrefs: (id, { currency, theme }) => {
    const updates = {};
    if (currency) updates.currency = currency;
    if (theme)    updates.theme    = theme;
    db.get('users').find({ id }).assign(updates).write();
  }
};

// ── Transactions ──────────────────────────────────────────────
const Transactions = {
  list: (userId, { type, category, search } = {}) => {
    let items = db.get('transactions').filter({ user_id: userId }).value();
    if (type && ['income','expense'].includes(type)) items = items.filter(t => t.type === type);
    if (category && category !== 'all')              items = items.filter(t => t.category === category);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(t => t.merchant.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    }
    return items.sort((a,b) => b.date !== a.date ? b.date.localeCompare(a.date) : b.id - a.id);
  },

  findById:  (id, userId) => db.get('transactions').find({ id, user_id: userId }).value(),

  create: ({ user_id, type, merchant, category, amount, date, notes='', recurring=false }) => {
    const txn = {
      id: nextId('transactions'), user_id, type, merchant: merchant.trim(),
      category, amount: parseFloat(amount), date, notes: notes.trim(),
      recurring: Boolean(recurring), created_at: new Date().toISOString()
    };
    db.get('transactions').push(txn).write();
    return txn;
  },

  update: (id, userId, fields) => {
    db.get('transactions').find({ id, user_id: userId }).assign(fields).write();
    return db.get('transactions').find({ id }).value();
  },

  delete: (id, userId) => {
    db.get('transactions').remove({ id, user_id: userId }).write();
  }
};

// ── Category Budgets ──────────────────────────────────────────
const Budgets = {
  list: (userId) => {
    const budgets = db.get('budgets').filter({ user_id: userId }).sortBy('category').value();
    const now     = new Date();
    const month   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return budgets.map(b => {
      const spent = db.get('transactions')
        .filter(t => t.user_id===userId && t.type==='expense' && t.category===b.category && t.date.startsWith(month))
        .reduce((s,t) => s+t.amount, 0);
      return { ...b, spent: Math.round(spent*100)/100 };
    });
  },

  upsert: ({ user_id, category, limit_amount, emoji, color }) => {
    const existing = db.get('budgets').find({ user_id, category }).value();
    if (existing) {
      db.get('budgets').find({ user_id, category }).assign({ limit_amount, emoji, color }).write();
      return db.get('budgets').find({ user_id, category }).value();
    }
    const budget = { id: nextId('budgets'), user_id, category, limit_amount, emoji, color };
    db.get('budgets').push(budget).write();
    return budget;
  },

  findById: (id, userId) => db.get('budgets').find({ id, user_id: userId }).value(),
  delete:   (id, userId) => { db.get('budgets').remove({ id, user_id: userId }).write(); }
};

// ── Monthly Budgets ───────────────────────────────────────────
const MonthlyBudgets = {
  get: (userId, month) =>
    db.get('monthly_budgets').find({ user_id: userId, month }).value() || null,

  upsert: (userId, month, amount) => {
    const existing = db.get('monthly_budgets').find({ user_id: userId, month }).value();
    if (existing) {
      db.get('monthly_budgets').find({ user_id: userId, month }).assign({ amount }).write();
      return db.get('monthly_budgets').find({ user_id: userId, month }).value();
    }
    const rec = { id: nextId('monthly_budgets'), user_id: userId, month, amount };
    db.get('monthly_budgets').push(rec).write();
    return rec;
  }
};

// ── User Categories ───────────────────────────────────────────
const Categories = {
  list: (userId, type) => {
    let cats = db.get('categories').filter({ user_id: userId }).value();
    if (type) cats = cats.filter(c => c.type === type);
    return cats;
  },

  create: ({ user_id, type, name, emoji, color, bg }) => {
    const cat = { id: nextId('categories'), user_id, type, name: name.trim(), emoji, color, bg };
    db.get('categories').push(cat).write();
    return cat;
  },

  delete: (id, userId) => {
    db.get('categories').remove({ id, user_id: userId }).write();
  }
};

// ── Analytics ─────────────────────────────────────────────────
const Analytics = {
  summary: (userId) => {
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const all   = db.get('transactions').filter({ user_id: userId }).value();
    const mTxns = all.filter(t => t.date.startsWith(month));

    const totalIncome     = all.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount,0);
    const totalExpenses   = all.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const monthlyIncome   = mTxns.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount,0);
    const monthlyExpenses = mTxns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);

    const balance     = Math.round((totalIncome-totalExpenses)*100)/100;
    const savingsRate = monthlyIncome>0 ? Math.round(((monthlyIncome-monthlyExpenses)/monthlyIncome)*100) : 0;

    return { balance, monthlyIncome: Math.round(monthlyIncome*100)/100, monthlyExpenses: Math.round(monthlyExpenses*100)/100, savingsRate };
  },

  trends: (userId) => {
    const now  = new Date();
    const all  = db.get('transactions').filter({ user_id: userId }).value();
    return Array.from({length:6},(_,i)=>{
      const d      = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
      const month  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const mTxns  = all.filter(t=>t.date.startsWith(month));
      const income   = mTxns.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount,0);
      const expenses = mTxns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
      return { month: d.toLocaleString('default',{month:'short'}), income: Math.round(income*100)/100, expenses: Math.round(expenses*100)/100 };
    });
  },

  categories: (userId) => {
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const map   = {};
    db.get('transactions').filter(t=>t.user_id===userId&&t.type==='expense'&&t.date.startsWith(month)).value()
      .forEach(t => { map[t.category]=(map[t.category]||0)+t.amount; });
    return Object.entries(map)
      .map(([category,total])=>({category,total:Math.round(total*100)/100}))
      .sort((a,b)=>b.total-a.total);
  },

  heatmap: (userId) => {
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const map   = {};
    db.get('transactions').filter(t=>t.user_id===userId&&t.type==='expense'&&t.date.startsWith(month)).value()
      .forEach(t => { map[t.date]=(map[t.date]||0)+t.amount; });
    return Object.entries(map)
      .map(([date,total])=>({date,total:Math.round(total*100)/100}))
      .sort((a,b)=>a.date.localeCompare(b.date));
  }
};

module.exports = { initDb, Users, Transactions, Budgets, MonthlyBudgets, Analytics, Categories };
