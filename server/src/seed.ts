import type { Context, Role } from './types.js';
import { all, audit, id, one, run, transaction } from './db.js';
import { hashPassword } from './auth.js';
import { addDays, iso, today } from './lib.js';
import { bookMeal } from './services/bookings.js';
import { issueInvoice } from './services/billing.js';

export const demoPassword = 'MessDemo2026!';
export async function seedDemo(ctx: Context) {
  if (ctx.config.production || process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
  if (one(ctx.db, 'SELECT id FROM users LIMIT 1')) throw new Error('Demo seed requires an empty database; your existing data has been preserved');
  const hash = await hashPassword(demoPassword);
  return transaction(ctx.db, () => {
    const accounts: { name: string; email: string; role: Role; roll: string | null }[] = [
      { name: 'Mess Administrator', email: 'admin@demo.iiit-bh.ac.in', role: 'ADMIN', roll: null },
      { name: 'Ananya Das', email: 'manager@demo.iiit-bh.ac.in', role: 'MANAGER', roll: null },
      { name: 'Prakash Sahoo', email: 'staff@demo.iiit-bh.ac.in', role: 'STAFF', roll: null },
      { name: 'Aarav Mishra', email: 'student@demo.iiit-bh.ac.in', role: 'STUDENT', roll: 'B123001' },
      { name: 'Priya Mohanty', email: 'priya@demo.iiit-bh.ac.in', role: 'STUDENT', roll: 'B123002' }
    ];
    const users = accounts.map(account => {
      const userId = id();
      run(ctx.db, 'INSERT INTO users (id,name,email,password_hash,role,roll_number,hostel,room,joined_on,must_change_password,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)', userId, account.name, account.email, hash, account.role, account.roll, account.roll ? 'Hostel A' : null, account.roll ? '204' : null, addDays(today(ctx), -90), iso(ctx));
      return { ...account, id: userId };
    });
    const adminId = users[0]!.id;
    const menu = [
      { type: 'BREAKFAST', title: 'A bright start', items: ['Idli', 'Sambar', 'Coconut chutney', 'Tea'], start: '07:30', end: '09:00', price: 3500, allergens: ['Milk'] },
      { type: 'LUNCH', title: 'The Odia thali', items: ['Steamed rice', 'Dalma', 'Aloo bhaja', 'Seasonal salad', 'Curd'], start: '12:00', end: '14:00', price: 6000, allergens: ['Milk'] },
      { type: 'SNACKS', title: 'An evening pause', items: ['Samosa', 'Green chutney', 'Tea'], start: '16:30', end: '17:30', price: 2000, allergens: ['Wheat', 'Milk'] },
      { type: 'DINNER', title: 'End the day well', items: ['Roti', 'Jeera rice', 'Dal tadka', 'Paneer curry'], start: '19:30', end: '21:00', price: 6500, allergens: ['Wheat', 'Milk'] }
    ];
    for (let day = 0; day < 8; day++) {
      const date = addDays(today(ctx), day);
      for (const template of menu) {
        const starts = new Date(`${date}T${template.start}:00+05:30`).toISOString();
        const ends = new Date(`${date}T${template.end}:00+05:30`).toISOString();
        const cutoff = new Date(Date.parse(starts) - 3 * 3600000).toISOString();
        if (cutoff <= iso(ctx)) continue;
        const mealId = id();
        run(ctx.db, "INSERT INTO meal_services VALUES (?,?,?,?,?,?,'VEG',?,?,?,?,?,'PUBLISHED',?,?)", mealId, date, template.type, template.title, JSON.stringify(template.items), JSON.stringify(template.allergens), template.price, 400, starts, ends, cutoff, adminId, iso(ctx));
        if (template.type === 'LUNCH') run(ctx.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', id(), mealId, 'Extra curd', 1500, 80, '["Milk"]');
        if (day === 1) for (const student of users.filter(user => user.role === 'STUDENT')) bookMeal(ctx, student.id, mealId);
      }
    }
    const previousMonth = new Date(`${today(ctx).slice(0, 7)}-01T00:00:00Z`);
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
    const billingMonth = previousMonth.toISOString().slice(0, 7);
    const historicalDate = `${billingMonth}-15`;
    const historicalMealId = id();
    const historicalStart = `${historicalDate}T06:30:00.000Z`;
    run(ctx.db, "INSERT INTO meal_services VALUES (?,?,?,?,?,?,'VEG',?,?,?,?,?,'PUBLISHED',?,?)", historicalMealId, historicalDate, 'LUNCH', 'Demo historical lunch', '["Rice","Dalma","Curd"]', '["Milk"]', 6000, 400, historicalStart, `${historicalDate}T08:30:00.000Z`, `${historicalDate}T03:30:00.000Z`, adminId, historicalStart);
    for (const student of users.filter(user => user.role === 'STUDENT')) {
      run(ctx.db, "INSERT INTO bookings (id,user_id,meal_id,status,price_paise,created_at,attended_at,attended_by) VALUES (?,?,?,'ATTENDED',6000,?,?,?)", id(), student.id, historicalMealId, `${historicalDate}T02:00:00.000Z`, historicalStart, users[2]!.id);
      issueInvoice(ctx, student.id, billingMonth, addDays(today(ctx), 7), adminId);
    }
    const supplierId = id();
    run(ctx.db, 'INSERT INTO suppliers VALUES (?,?,?,?)', supplierId, 'Campus Provisions', 'Demo supplier; replace before real use', iso(ctx));
    for (const item of [{ name: 'Rice', unit: 'GRAM', stock: 150000, threshold: 25000, cost: 720000 }, { name: 'Toor dal', unit: 'GRAM', stock: 8000, threshold: 10000, cost: 120000 }, { name: 'Cooking oil', unit: 'MILLILITRE', stock: 20000, threshold: 5000, cost: 300000 }]) {
      const itemId = id();
      run(ctx.db, 'INSERT INTO inventory_items VALUES (?,?,?,?,?,?)', itemId, item.name, item.unit, item.stock, item.threshold, iso(ctx));
      run(ctx.db, "INSERT INTO stock_movements VALUES (?,?,'RECEIVE',?,?,?,?,?,?,?,?)", id(), itemId, item.stock, item.cost, supplierId, `DEMO-${item.name}`, 'Opening demo stock', adminId, iso(ctx), id());
    }
    run(ctx.db, "INSERT INTO announcements VALUES (?,?,?,'IMPORTANT',?,?,?)", id(), 'Welcome to your mess', 'Book meals before the cutoff to help the kitchen prepare the right amount. The displayed rates and policies are demonstration data.', new Date(ctx.now().valueOf() + 7 * 86400000).toISOString(), adminId, iso(ctx));
    audit(ctx.db, adminId, 'DEMO_SEEDED', 'SYSTEM', 'demo', { users: users.length, meals: all(ctx.db, 'SELECT id FROM meal_services').length }, iso(ctx));
    return accounts.map(({ email, role }) => ({ email, role }));
  });
}
