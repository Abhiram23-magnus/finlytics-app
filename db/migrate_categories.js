const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'finlytics.json'));
const db = low(adapter);

if (!db.has('categories').value()) {
  db.set('categories', []).write();
}

function nextId(collection) {
  const items = db.get(collection).value();
  if (!items.length) return 1;
  return Math.max(...items.map(i => i.id)) + 1;
}

const users = db.get('users').value();
users.forEach(user => {
  const existingCats = db.get('categories').filter({ user_id: user.id }).value();
  if (existingCats.length === 0) {
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
      db.get('categories').push({ id: catId++, user_id: user.id, ...c }).write();
    });
    console.log(`Seeded categories for user ${user.id}`);
  }
});
console.log('Done');
