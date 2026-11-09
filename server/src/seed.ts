import { randomBytes } from 'node:crypto';
import type { Context, Role } from './types.js';
import { all, audit, id, one, run, transaction } from './db.js';
import { hashPassword, passwordSchema } from './auth.js';
import { addDays, iso, today } from './lib.js';
import { bookMeal } from './services/bookings.js';
import { issueInvoice } from './services/billing.js';

export function generateDemoPassword() {
  return `Mess-${randomBytes(9).toString('base64url')}9aA`;
}
export async function seedDemo(ctx: Context, options: { password?: string; allowProduction?: boolean; domain?: string } = {}) {
  const inProd = ctx.config.production || process.env.NODE_ENV === 'production';
  if (inProd && !options.allowProduction) throw new Error('Demo seeding is disabled in production');
  if (one(ctx.db, 'SELECT id FROM users LIMIT 1')) throw new Error('Demo seed requires an empty database; your existing data has been preserved');
  const rawPassword = options.password ?? process.env.DEMO_PASSWORD ?? generateDemoPassword();
  const password = passwordSchema.parse(rawPassword);
  const domain = options.domain ?? (inProd ? 'iiit-bh.ac.in' : 'demo.iiit-bh.ac.in');
  const hash = await hashPassword(password);
  const seeded = transaction(ctx.db, () => {
    const accounts: { name: string; email: string; role: Role; roll: string | null }[] = [
      { name: 'Mess Administrator', email: `admin@${domain}`, role: 'ADMIN', roll: null },
      { name: 'Ananya Das', email: `manager@${domain}`, role: 'MANAGER', roll: null },
      { name: 'Prakash Sahoo', email: `staff@${domain}`, role: 'STAFF', roll: null },
      { name: 'Aarav Mishra', email: `student@${domain}`, role: 'STUDENT', roll: 'B123001' },
      { name: 'Priya Mohanty', email: `priya@${domain}`, role: 'STUDENT', roll: 'B123002' }
    ];
    const users = accounts.map(account => {
      const userId = id();
      run(ctx.db, 'INSERT INTO users (id,name,email,password_hash,role,roll_number,hostel,room,joined_on,must_change_password,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)', userId, account.name, account.email, hash, account.role, account.roll, account.roll ? 'Hostel A' : null, account.roll ? '204' : null, addDays(today(ctx), -90), iso(ctx));
      return { ...account, id: userId };
    });
    const adminId = users[0]!.id;
    const managerId = users[1]!.id;
    const staffId = users[2]!.id;
    const student1Id = users[3]!.id;
    const student2Id = users[4]!.id;
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
      const bId = id();
      run(ctx.db, "INSERT INTO bookings (id,user_id,meal_id,status,price_paise,created_at,attended_at,attended_by) VALUES (?,?,?,'ATTENDED',6000,?,?,?)", bId, student.id, historicalMealId, `${historicalDate}T02:00:00.000Z`, historicalStart, staffId);
      if (student.id === student1Id) {
        run(ctx.db, 'INSERT INTO feedback VALUES (?,?,5,5,4,?,?)', id(), bId, 'Freshly steamed rice and flavorful dalma!', historicalStart);
      }
      issueInvoice(ctx, student.id, billingMonth, addDays(today(ctx), 7), adminId);
    }
    const leaveId = id();
    run(ctx.db, "INSERT INTO leave_requests (id,user_id,starts_on,ends_on,reason,status,created_at) VALUES (?,?,?,?,?,'PENDING',?)", leaveId, student2Id, addDays(today(ctx), 3), addDays(today(ctx), 5), 'Attending inter-IIIT robotics symposium in Hyderabad', iso(ctx));
    const complaintId = id();
    run(ctx.db, "INSERT INTO complaints VALUES (?,?,'SERVICE',?,?,'IN_PROGRESS',?,?,?)", complaintId, student1Id, 'Evening snacks counter queue', 'Could we open a second serving line during peak 4:30 PM snack hours?', managerId, iso(ctx), iso(ctx));
    run(ctx.db, 'INSERT INTO complaint_replies VALUES (?,?,?,?,?)', id(), complaintId, managerId, 'Thanks for flagging this, Aarav. We are arranging an additional tea and snack counter starting tomorrow.', iso(ctx));
    const supplierId = id();
    run(ctx.db, 'INSERT INTO suppliers VALUES (?,?,?,?)', supplierId, 'Campus Provisions', 'Gothapatna Institutional Supply · +91 674 265 3300', iso(ctx));
    for (const item of [{ name: 'Rice', unit: 'GRAM', stock: 150000, threshold: 25000, cost: 720000 }, { name: 'Toor dal', unit: 'GRAM', stock: 8000, threshold: 10000, cost: 120000 }, { name: 'Cooking oil', unit: 'MILLILITRE', stock: 20000, threshold: 5000, cost: 300000 }]) {
      const itemId = id();
      run(ctx.db, 'INSERT INTO inventory_items VALUES (?,?,?,?,?,?)', itemId, item.name, item.unit, item.stock, item.threshold, iso(ctx));
      run(ctx.db, "INSERT INTO stock_movements VALUES (?,?,'RECEIVE',?,?,?,?,?,?,?,?)", id(), itemId, item.stock, item.cost, supplierId, `DEMO-${item.name}`, 'Opening demo stock', adminId, iso(ctx), id());
    }
    run(ctx.db, "INSERT INTO announcements VALUES (?,?,?,'IMPORTANT',?,?,?)", id(), 'Welcome to your mess', 'Book meals before the cutoff to help the kitchen prepare the right amount. The displayed rates and policies are demonstration data.', new Date(ctx.now().valueOf() + 7 * 86400000).toISOString(), adminId, iso(ctx));
    audit(ctx.db, adminId, 'DEMO_SEEDED', 'SYSTEM', 'demo', { users: users.length, meals: all(ctx.db, 'SELECT id FROM meal_services').length }, iso(ctx));
    return accounts.map(({ email, role }) => ({ email, role }));
  });
  Object.defineProperty(seeded, 'password', { value: password, enumerable: false });
  return seeded as { email: string; role: Role }[] & { password?: string };
}
