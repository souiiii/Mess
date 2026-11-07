export const migrations = [{ version: 1, sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('STUDENT','STAFF','MANAGER','ADMIN')),
  roll_number TEXT UNIQUE, hostel TEXT, room TEXT,
  dietary_preference TEXT NOT NULL DEFAULT 'VEG' CHECK(dietary_preference IN ('VEG','NON_VEG','VEGAN')),
  allergies TEXT NOT NULL DEFAULT '[]', joined_on TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK(role != 'STUDENT' OR roll_number IS NOT NULL)
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), booking_horizon_days INTEGER NOT NULL DEFAULT 14,
  minimum_leave_days INTEGER NOT NULL DEFAULT 2, feedback_window_days INTEGER NOT NULL DEFAULT 7,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX audit_date ON audit_logs(created_at);
CREATE TABLE meal_services (
  id TEXT PRIMARY KEY, service_date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('BREAKFAST','LUNCH','SNACKS','DINNER')),
  title TEXT NOT NULL, menu TEXT NOT NULL, allergens TEXT NOT NULL DEFAULT '[]',
  dietary_type TEXT NOT NULL CHECK(dietary_type IN ('VEG','NON_VEG','VEGAN','MIXED')),
  price_paise INTEGER NOT NULL CHECK(price_paise >= 0), capacity INTEGER NOT NULL CHECK(capacity > 0),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, cutoff_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','CANCELLED')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(service_date, meal_type), CHECK(cutoff_at < starts_at), CHECK(starts_at < ends_at)
) STRICT;
CREATE INDEX meals_date ON meal_services(service_date, status);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), meal_id TEXT NOT NULL REFERENCES meal_services(id),
  status TEXT NOT NULL CHECK(status IN ('CONFIRMED','CANCELLED','ATTENDED')),
  price_paise INTEGER NOT NULL CHECK(price_paise >= 0), created_at TEXT NOT NULL,
  cancelled_at TEXT, cancellation_reason TEXT, attended_at TEXT, attended_by TEXT REFERENCES users(id),
  UNIQUE(user_id, meal_id)
) STRICT;
CREATE INDEX bookings_meal ON bookings(meal_id, status);
CREATE INDEX bookings_user ON bookings(user_id, status);
CREATE TABLE meal_passes (
  token_hash TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), expires_at TEXT NOT NULL,
  used_at TEXT
) STRICT;
CREATE INDEX passes_booking ON meal_passes(booking_id);
CREATE TABLE extras (
  id TEXT PRIMARY KEY, meal_id TEXT NOT NULL REFERENCES meal_services(id), name TEXT NOT NULL,
  price_paise INTEGER NOT NULL CHECK(price_paise > 0), capacity INTEGER NOT NULL CHECK(capacity > 0),
  allergens TEXT NOT NULL DEFAULT '[]', UNIQUE(meal_id, name)
) STRICT;
CREATE TABLE extra_orders (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), extra_id TEXT NOT NULL REFERENCES extras(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise > 0),
  status TEXT NOT NULL CHECK(status IN ('CONFIRMED','CANCELLED','FULFILLED')), created_at TEXT NOT NULL,
  UNIQUE(booking_id, extra_id)
) STRICT;
CREATE INDEX extra_order_capacity ON extra_orders(extra_id, status);
CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  reviewed_by TEXT REFERENCES users(id), review_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL,
  CHECK(starts_on <= ends_on)
) STRICT;
CREATE INDEX leaves_user_dates ON leave_requests(user_id, starts_on, ends_on, status);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  taste INTEGER NOT NULL CHECK(taste BETWEEN 1 AND 5), hygiene INTEGER NOT NULL CHECK(hygiene BETWEEN 1 AND 5),
  portion INTEGER NOT NULL CHECK(portion BETWEEN 1 AND 5), comment TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE complaints (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK(category IN ('FOOD','HYGIENE','SERVICE','BILLING','OTHER')),
  subject TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  assigned_to TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX complaints_status ON complaints(status, created_at);
CREATE TABLE complaint_replies (
  id TEXT PRIMARY KEY, complaint_id TEXT NOT NULL REFERENCES complaints(id), author_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE invoices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), month TEXT NOT NULL,
  total_paise INTEGER NOT NULL CHECK(total_paise >= 0), issued_by TEXT NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL, due_on TEXT NOT NULL, UNIQUE(user_id, month)
) STRICT;
CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('MEAL','EXTRA')), source_id TEXT NOT NULL,
  description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0), UNIQUE(source_type, source_id)
) STRICT;
CREATE TABLE payments (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  method TEXT NOT NULL CHECK(method IN ('CASH','BANK_TRANSFER','UPI')),
  reference TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
  recorded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL CHECK(unit IN ('GRAM','MILLILITRE','PIECE')),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), low_stock_threshold INTEGER NOT NULL CHECK(low_stock_threshold >= 0),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory_items(id),
  kind TEXT NOT NULL CHECK(kind IN ('RECEIVE','CONSUME','WASTE','ADJUST')),
  quantity INTEGER NOT NULL CHECK(quantity != 0), total_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK(total_cost_paise >= 0),
  supplier_id TEXT REFERENCES suppliers(id), reference TEXT, reason TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  CHECK((kind = 'RECEIVE' AND quantity > 0) OR (kind IN ('CONSUME','WASTE') AND quantity < 0) OR kind = 'ADJUST')
) STRICT;
CREATE INDEX stock_item ON stock_movements(item_id, created_at);
CREATE UNIQUE INDEX receipt_once_per_item ON stock_movements(item_id, supplier_id, reference) WHERE kind = 'RECEIVE';
CREATE TABLE service_waste (
  meal_id TEXT PRIMARY KEY REFERENCES meal_services(id), prepared_portions INTEGER NOT NULL CHECK(prepared_portions >= 0),
  leftover_portions INTEGER NOT NULL CHECK(leftover_portions >= 0 AND leftover_portions <= prepared_portions),
  waste_grams INTEGER NOT NULL CHECK(waste_grams >= 0), note TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id), recorded_at TEXT NOT NULL
) STRICT;
CREATE TABLE announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('NORMAL','IMPORTANT')), expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER immutable_invoice_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT, 'Invoices are immutable'); END;
CREATE TRIGGER immutable_invoice_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'Invoices are immutable'); END;
CREATE TRIGGER immutable_line_update BEFORE UPDATE ON invoice_lines BEGIN SELECT RAISE(ABORT, 'Invoice lines are immutable'); END;
CREATE TRIGGER immutable_line_delete BEFORE DELETE ON invoice_lines BEGIN SELECT RAISE(ABORT, 'Invoice lines are immutable'); END;
CREATE TRIGGER immutable_payment_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;
CREATE TRIGGER immutable_payment_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit logs are immutable'); END;
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit logs are immutable'); END;
CREATE TRIGGER immutable_stock_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Stock movements are immutable'); END;
CREATE TRIGGER immutable_stock_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Stock movements are immutable'); END;
` }];
