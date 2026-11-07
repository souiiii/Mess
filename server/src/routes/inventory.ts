import { z } from 'zod';
import type { Api } from '../api.js';
import { management, operations } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, ensure, find, iso, money, pageSchema, pagination, text, uuidSchema } from '../lib.js';

export function inventoryRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'get', path: '/suppliers', tag: 'Inventory', summary: 'List supplier contacts', roles: management, query: pageSchema }, ({ query }) => {
    const { page, limit, offset } = pagination(query);
    return { items: all(ctx.db, 'SELECT * FROM suppliers ORDER BY name LIMIT ? OFFSET ?', limit, offset), total: one(ctx.db, 'SELECT count(*) AS n FROM suppliers')!.n, page, limit };
  });
  api.route({ method: 'post', path: '/suppliers', tag: 'Inventory', summary: 'Add a supplier', roles: management, status: 201, body: z.object({ name: text(100), contact: text(300) }).strict() }, ({ req, body }) => transaction(ctx.db, () => {
    const supplierId = id();
    run(ctx.db, 'INSERT INTO suppliers VALUES (?,?,?,?)', supplierId, body.name, body.contact, iso(ctx));
    audit(ctx.db, actor(req).id, 'SUPPLIER_CREATED', 'SUPPLIER', supplierId, {}, iso(ctx));
    return find(ctx, 'suppliers', supplierId);
  }));
  api.route({ method: 'post', path: '/inventory', tag: 'Inventory', summary: 'Create a stock item in grams, millilitres or pieces', roles: management, status: 201,
    body: z.object({ name: text(100), unit: z.enum(['GRAM','MILLILITRE','PIECE']), lowStockThreshold: z.number().int().min(0).max(100000000) }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    const itemId = id();
    run(ctx.db, 'INSERT INTO inventory_items VALUES (?,?,?,0,?,?)', itemId, body.name, body.unit, body.lowStockThreshold, iso(ctx));
    audit(ctx.db, actor(req).id, 'INVENTORY_ITEM_CREATED', 'INVENTORY', itemId, {}, iso(ctx));
    return find(ctx, 'inventory_items', itemId);
  }));
  api.route({ method: 'get', path: '/inventory', tag: 'Inventory', summary: 'Stock levels and low-stock alerts', roles: operations, query: pageSchema.extend({ lowStock: z.enum(['true','false']).default('false') }) }, ({ query }) => {
    const { page, limit, offset } = pagination(query);
    const low = Number(query.lowStock === 'true');
    const where = 'WHERE (?=0 OR stock<=low_stock_threshold)';
    return { items: all(ctx.db, `SELECT *, stock<=low_stock_threshold AS low_stock FROM inventory_items ${where} ORDER BY stock<=low_stock_threshold DESC, name LIMIT ? OFFSET ?`, low, limit, offset), total: one(ctx.db, `SELECT count(*) AS n FROM inventory_items ${where}`, low)!.n, page, limit };
  });
  api.route({ method: 'patch', path: '/inventory/:id', tag: 'Inventory', summary: 'Update a stock alert threshold', roles: management, body: z.object({ lowStockThreshold: z.number().int().min(0).max(100000000) }).strict() }, ({ req, body, params }) => transaction(ctx.db, () => {
    find(ctx, 'inventory_items', params.id!);
    run(ctx.db, 'UPDATE inventory_items SET low_stock_threshold=? WHERE id=?', body.lowStockThreshold, params.id!);
    audit(ctx.db, actor(req).id, 'STOCK_THRESHOLD_CHANGED', 'INVENTORY', params.id!, body, iso(ctx));
    return find(ctx, 'inventory_items', params.id!);
  }));
  api.route({ method: 'post', path: '/inventory/:id/movements', tag: 'Inventory', summary: 'Record a receipt, consumption, wastage or signed stock correction', roles: operations, status: 201,
    body: z.object({ kind: z.enum(['RECEIVE','CONSUME','WASTE','ADJUST']), quantity: z.number().int().min(-100000000).max(100000000).refine(value => value !== 0), totalCostPaise: money.default(0), supplierId: uuidSchema.optional(), reference: text(100).optional(), reason: text(1000), idempotencyKey: z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/) }).strict()
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const item = find(ctx, 'inventory_items', params.id!);
    ensure(body.kind !== 'ADJUST' || management.includes(actor(req).role), 403, 'FORBIDDEN', 'Only management can correct stock counts');
    ensure(body.kind !== 'RECEIVE' || management.includes(actor(req).role), 403, 'FORBIDDEN', 'Only management can record procurement receipts');
    ensure(body.kind !== 'RECEIVE' || body.quantity > 0, 400, 'INVALID_QUANTITY', 'A receipt requires a positive quantity');
    ensure(!['CONSUME','WASTE'].includes(body.kind) || body.quantity < 0, 400, 'INVALID_QUANTITY', 'Consumption and wastage require a negative quantity');
    ensure(body.kind === 'RECEIVE' || (body.totalCostPaise === 0 && !body.supplierId && !body.reference), 400, 'INVALID_PROCUREMENT_FIELDS', 'Cost, supplier and receipt reference only apply to receipts');
    ensure(body.kind !== 'RECEIVE' || (body.supplierId && body.reference), 400, 'RECEIPT_DETAILS_REQUIRED', 'Stock receipts require a supplier and receipt reference');
    if (body.supplierId) find(ctx, 'suppliers', body.supplierId);
    const existing = one(ctx.db, 'SELECT * FROM stock_movements WHERE idempotency_key=?', body.idempotencyKey);
    if (existing) {
      ensure(existing.item_id === item.id && existing.kind === body.kind && existing.quantity === body.quantity && existing.total_cost_paise === body.totalCostPaise && existing.supplier_id === (body.supplierId ?? null) && existing.reference === (body.reference ?? null) && existing.reason === body.reason, 409, 'IDEMPOTENCY_CONFLICT', 'This key was used for a different stock movement');
      return { movement: existing, item };
    }
    ensure(item.stock + body.quantity >= 0 && item.stock + body.quantity <= 1_000_000_000, 409, 'INVALID_STOCK_BALANCE', 'The movement would create an invalid stock balance');
    const movementId = id();
    run(ctx.db, 'INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?,?)', movementId, item.id, body.kind, body.quantity, body.totalCostPaise, body.supplierId ?? null, body.reference ?? null, body.reason, actor(req).id, iso(ctx), body.idempotencyKey);
    run(ctx.db, 'UPDATE inventory_items SET stock=stock+? WHERE id=?', body.quantity, item.id);
    audit(ctx.db, actor(req).id, 'STOCK_MOVEMENT_RECORDED', 'STOCK_MOVEMENT', movementId, { itemId: item.id, kind: body.kind, quantity: body.quantity }, iso(ctx));
    return { movement: find(ctx, 'stock_movements', movementId), item: find(ctx, 'inventory_items', item.id) };
  }));
  api.route({ method: 'get', path: '/inventory/:id/movements', tag: 'Inventory', summary: 'Read the append-only stock ledger', roles: operations, query: pageSchema }, ({ req, params, query }) => {
    find(ctx, 'inventory_items', params.id!);
    const { page, limit, offset } = pagination(query);
    const rows = all(ctx.db, 'SELECT m.*, s.name AS supplier_name FROM stock_movements m LEFT JOIN suppliers s ON m.supplier_id=s.id WHERE item_id=? ORDER BY m.created_at DESC, m.id LIMIT ? OFFSET ?', params.id!, limit, offset);
    return { items: rows.map(row => {
      if (management.includes(actor(req).role)) return row;
      const { total_cost_paise, supplier_id, supplier_name, reference, ...safe } = row;
      return safe;
    }), total: one(ctx.db, 'SELECT count(*) AS n FROM stock_movements WHERE item_id=?', params.id!)!.n, page, limit };
  });
  api.route({ method: 'post', path: '/meals/:id/waste', tag: 'Wastage', summary: 'Record prepared food leftovers and waste after service', roles: operations, status: 201,
    body: z.object({ preparedPortions: z.number().int().min(0).max(10000), leftoverPortions: z.number().int().min(0).max(10000), wasteGrams: z.number().int().min(0).max(100000000), note: text(1000) }).strict()
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const meal = find(ctx, 'meal_services', params.id!);
    ensure(meal.status === 'PUBLISHED' && meal.ends_at <= iso(ctx), 409, 'SERVICE_NOT_FINISHED', 'Record wastage after a published meal service has ended');
    const attended = one(ctx.db, "SELECT count(*) AS n FROM bookings WHERE meal_id=? AND status='ATTENDED'", meal.id)!.n;
    ensure(body.leftoverPortions <= body.preparedPortions && body.preparedPortions >= attended && body.leftoverPortions <= body.preparedPortions - attended, 400, 'INVALID_PORTIONS', 'Prepared and leftover portions must be consistent with recorded attendance');
    ensure(!one(ctx.db, 'SELECT meal_id FROM service_waste WHERE meal_id=?', meal.id), 409, 'WASTE_ALREADY_RECORDED', 'Wastage has already been recorded for this service');
    run(ctx.db, 'INSERT INTO service_waste VALUES (?,?,?,?,?,?,?)', meal.id, body.preparedPortions, body.leftoverPortions, body.wasteGrams, body.note, actor(req).id, iso(ctx));
    audit(ctx.db, actor(req).id, 'SERVICE_WASTE_RECORDED', 'MEAL', meal.id, body, iso(ctx));
    return one(ctx.db, 'SELECT * FROM service_waste WHERE meal_id=?', meal.id);
  }));
}
