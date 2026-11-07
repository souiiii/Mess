import { z } from 'zod';

const identifier = z.uuid();
const integer = z.number().int();
const nullableText = z.string().nullable();
const role = z.enum(['STUDENT','STAFF','MANAGER','ADMIN']);
const bookingStatus = z.enum(['CONFIRMED','CANCELLED','ATTENDED']);
const orderStatus = z.enum(['CONFIRMED','CANCELLED','FULFILLED']);
const user = z.object({
  id: identifier, name: z.string(), email: z.email(), role, roll_number: nullableText,
  hostel: nullableText, room: nullableText, dietary_preference: z.enum(['VEG','NON_VEG','VEGAN']),
  allergies: z.array(z.string()), joined_on: z.string(), active: z.boolean(), must_change_password: z.boolean(), created_at: z.string()
}).meta({ id: 'User' });
const meal = z.object({
  id: identifier, service_date: z.string(), meal_type: z.enum(['BREAKFAST','LUNCH','SNACKS','DINNER']),
  title: z.string(), menu: z.array(z.string()), allergens: z.array(z.string()), dietary_type: z.enum(['VEG','NON_VEG','VEGAN','MIXED']),
  price_paise: integer, capacity: integer, starts_at: z.string(), ends_at: z.string(), cutoff_at: z.string(),
  status: z.enum(['DRAFT','PUBLISHED','CANCELLED']), created_by: identifier, created_at: z.string()
}).meta({ id: 'MealService' });
const extra = z.object({ id: identifier, meal_id: identifier, name: z.string(), price_paise: integer, capacity: integer, allergens: z.array(z.string()) }).meta({ id: 'Extra' });
const order = z.object({ id: identifier, booking_id: identifier, extra_id: identifier, quantity: integer, unit_price_paise: integer, status: orderStatus, created_at: z.string(), name: z.string().optional() }).meta({ id: 'ExtraOrder' });
const booking = z.object({
  id: identifier, user_id: identifier, meal_id: identifier, status: bookingStatus, price_paise: integer,
  created_at: z.string(), cancelled_at: nullableText, cancellation_reason: nullableText, attended_at: nullableText, attended_by: identifier.nullable()
}).meta({ id: 'Booking' });
const bookingListItem = booking.extend({ service_date: z.string(), meal_type: z.string(), title: z.string(), starts_at: z.string(), ends_at: z.string(), cutoff_at: z.string(), name: z.string(), roll_number: z.string() });
const leave = z.object({ id: identifier, user_id: identifier, starts_on: z.string(), ends_on: z.string(), reason: z.string(), status: z.enum(['PENDING','APPROVED','REJECTED','WITHDRAWN']), reviewed_by: identifier.nullable(), review_note: nullableText, reviewed_at: nullableText, created_at: z.string() }).meta({ id: 'LeaveRequest' });
const invoiceBase = z.object({ id: identifier, user_id: identifier, month: z.string(), total_paise: integer, issued_by: identifier, issued_at: z.string(), due_on: z.string() });
const invoiceLine = z.object({ id: identifier, invoice_id: identifier, source_type: z.enum(['MEAL','EXTRA']), source_id: identifier, description: z.string(), quantity: integer, unit_price_paise: integer }).meta({ id: 'InvoiceLine' });
const paymentHistory = z.object({ id: identifier, amount_paise: integer, method: z.enum(['CASH','BANK_TRANSFER','UPI','FAKE']), reference: z.string(), created_at: z.string() }).meta({ id: 'PaymentHistoryEntry' });
const payment = paymentHistory.extend({ invoice_id: identifier, idempotency_key: z.string(), recorded_by: identifier }).meta({ id: 'Payment' });
const invoiceSummary = invoiceBase.extend({ payments_mode: z.enum(['FAKE','MANUAL']), paid_paise: integer, outstanding_paise: integer, status: z.enum(['UNPAID','PARTIALLY_PAID','PAID','OVERDUE']) }).meta({ id: 'InvoiceSummary' });
const invoice = invoiceSummary.extend({ lines: z.array(invoiceLine), payments: z.array(paymentHistory) }).meta({ id: 'Invoice' });
const attempt = z.object({ id: identifier, invoice_id: identifier, initiated_by: identifier, amount_paise: integer, outcome: z.enum(['SUCCESS','FAILURE']), idempotency_key: z.string(), payment_id: identifier.nullable(), created_at: z.string() }).meta({ id: 'FakePaymentAttempt' });
const feedback = z.object({ id: identifier, booking_id: identifier, taste: integer, hygiene: integer, portion: integer, comment: z.string(), created_at: z.string() }).meta({ id: 'Feedback' });
const complaint = z.object({ id: identifier, user_id: identifier, category: z.enum(['FOOD','HYGIENE','SERVICE','BILLING','OTHER']), subject: z.string(), description: z.string(), status: z.enum(['OPEN','IN_PROGRESS','RESOLVED']), assigned_to: identifier.nullable(), created_at: z.string(), updated_at: z.string() }).meta({ id: 'Complaint' });
const reply = z.object({ id: identifier, complaint_id: identifier, author_id: identifier, message: z.string(), created_at: z.string() }).meta({ id: 'ComplaintReply' });
const announcement = z.object({ id: identifier, title: z.string(), body: z.string(), priority: z.enum(['NORMAL','IMPORTANT']), expires_at: z.string(), created_at: z.string() }).meta({ id: 'Announcement' });
const inventory = z.object({ id: identifier, name: z.string(), unit: z.enum(['GRAM','MILLILITRE','PIECE']), stock: integer, low_stock_threshold: integer, created_at: z.string() }).meta({ id: 'InventoryItem' });
const movement = z.object({ id: identifier, item_id: identifier, kind: z.enum(['RECEIVE','CONSUME','WASTE','ADJUST']), quantity: integer, total_cost_paise: integer.optional(), supplier_id: identifier.nullable().optional(), reference: nullableText.optional(), reason: z.string(), recorded_by: identifier, created_at: z.string(), idempotency_key: z.string() }).meta({ id: 'StockMovement' });
const supplier = z.object({ id: identifier, name: z.string(), contact: z.string(), created_at: z.string() }).meta({ id: 'Supplier' });
const serviceReport = z.object({
  id: identifier, service_date: z.string(), meal_type: z.string(), title: z.string(), capacity: integer, starts_at: z.string(), ends_at: z.string(),
  booked: integer, attended: integer, cancelled: integer, extras_reserved: integer, residents_on_leave: integer,
  prepared_portions: integer.nullable(), leftover_portions: integer.nullable(), waste_grams: integer.nullable(),
  taste_rating: z.number().nullable(), hygiene_rating: z.number().nullable(), portion_rating: z.number().nullable(),
  feedback_count: integer, no_shows: integer.nullable(), attendance_percent: z.number()
}).meta({ id: 'ServiceReport' });
const page = (item: z.ZodType) => z.object({ items: z.array(item), total: integer, page: integer, limit: integer });
const previewLine = z.object({ sourceId: identifier, sourceType: z.enum(['MEAL','EXTRA']), description: z.string(), quantity: integer, unitPricePaise: integer });
const upcomingBooking = z.object({ id: identifier, price_paise: integer, service_date: z.string(), meal_type: z.string(), title: z.string(), menu: z.array(z.string()), starts_at: z.string(), ends_at: z.string(), cutoff_at: z.string() });
const dashboardBase = z.object({ role, date: z.string(), paymentsMode: z.enum(['FAKE','MANUAL']) });
const contracts: Record<string, z.ZodType> = {
  'post /auth/login': z.object({ user, csrfToken: z.string(), expiresAt: z.string() }),
  'get /auth/me': z.object({ user, csrfToken: z.string() }),
  'post /auth/logout': z.object({ signedOut: z.literal(true) }),
  'post /auth/password': z.object({ signInRequired: z.literal(true) }),
  'get /users': page(user),
  'post /users': user,
  'patch /users/me': user,
  'patch /users/:id/access': user,
  'post /users/:id/reset-password': z.object({ reset: z.literal(true) }),
  'get /audit': page(z.object({ id: identifier, actor_id: identifier.nullable(), action: z.string(), entity_type: z.string(), entity_id: z.string(), details: z.record(z.string(), z.unknown()), created_at: z.string(), actor_name: nullableText })),
  'get /meals': z.array(meal.extend({ booked_count: integer, attended_count: integer, available: integer, my_booking_id: identifier.nullable(), my_booking_status: bookingStatus.nullable(), extras: z.array(extra.extend({ available: integer })) })),
  'post /meals': meal,
  'patch /meals/:id': meal,
  'post /meals/:id/publish': meal,
  'post /meals/:id/cancel': meal.extend({ bookingsCancelled: integer }),
  'post /meals/:id/extras': extra,
  'post /bookings': booking,
  'post /bookings/bulk': z.array(booking),
  'get /bookings': page(bookingListItem),
  'get /bookings/:id': booking.extend({ meal, extras: z.array(order) }),
  'post /bookings/:id/cancel': booking,
  'post /bookings/:id/extras': order,
  'post /extra-orders/:id/cancel': order,
  'post /bookings/:id/pass': z.object({ token: z.string(), expiresAt: z.string(), bookingId: identifier }),
  'post /attendance/scan': z.object({ bookingId: identifier, student: z.object({ name: z.string(), rollNumber: z.string(), hostel: nullableText }), meal: z.object({ type: z.string(), date: z.string() }), extras: z.array(z.object({ name: z.string(), quantity: integer })), attendedAt: z.string() }),
  'post /leaves': leave,
  'get /leaves': page(leave.extend({ name: z.string(), roll_number: z.string() })),
  'post /leaves/:id/review': leave.extend({ cancelledBookings: integer, avoidedChargesPaise: integer }),
  'post /leaves/:id/withdraw': leave,
  'get /billing/preview': z.object({ userId: identifier, month: z.string(), lines: z.array(previewLine), totalPaise: integer, provisional: z.boolean() }),
  'post /invoices': invoice,
  'post /invoices/bulk': z.array(invoice),
  'get /invoices': page(invoiceSummary.extend({ name: z.string(), roll_number: z.string() })),
  'get /invoices/:id': invoice,
  'post /invoices/:id/payments': z.object({ payment, invoice }),
  'post /invoices/:id/fake-payment': z.object({ simulated: z.literal(true), moneyMoved: z.literal(false), attempt, invoice }),
  'get /invoices/:id/payment-attempts': page(attempt),
  'post /feedback': feedback,
  'get /feedback': page(feedback.extend({ service_date: z.string(), meal_type: z.string(), title: z.string() })),
  'post /complaints': complaint,
  'get /complaints': page(complaint),
  'get /complaints/:id': complaint.extend({ replies: z.array(reply.extend({ author_name: z.string(), author_role: role })) }),
  'post /complaints/:id/replies': reply,
  'patch /complaints/:id/status': complaint,
  'post /complaints/:id/reopen': complaint,
  'get /announcements': z.array(announcement.extend({ author_name: z.string() })),
  'post /announcements': announcement.extend({ created_by: identifier }),
  'delete /announcements/:id': z.object({ withdrawn: z.literal(true) }),
  'get /suppliers': page(supplier),
  'post /suppliers': supplier,
  'post /inventory': inventory,
  'get /inventory': page(inventory.extend({ low_stock: integer })),
  'patch /inventory/:id': inventory,
  'post /inventory/:id/movements': z.object({ movement, item: inventory }),
  'get /inventory/:id/movements': page(movement.extend({ supplier_name: nullableText.optional() })),
  'post /meals/:id/waste': z.object({ meal_id: identifier, prepared_portions: integer, leftover_portions: integer, waste_grams: integer, note: z.string(), recorded_by: identifier, recorded_at: z.string() }),
  'get /dashboard': z.union([
    dashboardBase.extend({ role: z.literal('STUDENT'), billingMonth: z.string(), provisionalBillPaise: integer, outstandingPaise: integer, upcomingBookings: z.array(upcomingBooking), pendingLeaves: integer, openComplaints: integer }),
    dashboardBase.extend({ role: z.enum(['STAFF','MANAGER','ADMIN']), services: z.array(serviceReport), lowStockItems: z.array(inventory), openComplaints: integer, activeResidents: integer.optional(), pendingLeaves: integer.optional(), overduePaise: integer.optional() })
  ]),
  'get /reports/operations': z.object({ from: z.string(), to: z.string(), services: z.array(serviceReport.extend({ dietaryCounts: z.array(z.object({ meal_id: identifier, dietary_preference: z.string(), count: integer })), extras: z.array(z.object({ meal_id: identifier, name: z.string(), quantity: integer })) })) }),
  'get /reports/billing': z.object({ month: z.string(), paymentsMode: z.enum(['FAKE','MANUAL']), invoiceCount: integer, billedPaise: integer, collectedForInvoicesPaise: integer, simulatedCollectionsPaise: integer, verifiedCollectionsPaise: integer, cashReceivedDuringMonthPaise: integer, simulatedReceivedDuringMonthPaise: integer, procurementCostPaise: integer, outstandingPaise: integer })
};
const policy = z.object({ id: z.literal(1), booking_horizon_days: integer, minimum_leave_days: integer, feedback_window_days: integer, updated_at: z.string() }).meta({ id: 'MessPolicy' });
contracts['get /settings'] = policy;
contracts['patch /settings'] = policy;
export function responseContract(method: string, path: string): z.ZodType {
  const contract = contracts[`${method.toLowerCase()} ${path}`];
  if (!contract) throw new Error(`Missing response contract for ${method} ${path}`);
  return contract;
}
