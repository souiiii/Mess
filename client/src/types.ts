export type Role = "STUDENT" | "STAFF" | "MANAGER" | "ADMIN";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  roll_number: string | null;
  hostel: string | null;
  room: string | null;
  dietary_preference: "VEG" | "NON_VEG" | "VEGAN";
  allergies: string[];
  joined_on: string;
  active: boolean;
  must_change_password: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface Extra {
  id: string;
  meal_id: string;
  name: string;
  price_paise: number;
  capacity: number;
  available: number;
  allergens: string[];
}
export interface Meal {
  id: string;
  service_date: string;
  meal_type: string;
  title: string;
  menu: string[];
  allergens: string[];
  dietary_type: string;
  price_paise: number;
  capacity: number;
  starts_at: string;
  ends_at: string;
  cutoff_at: string;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  booked_count: number;
  attended_count: number;
  available: number;
  my_booking_id: string | null;
  my_booking_status: string | null;
  extras: Extra[];
}
export interface Order {
  id: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
  status: string;
}
export interface Booking {
  menu?: string[];
  id: string;
  user_id: string;
  meal_id: string;
  status: string;
  price_paise: number;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  attended_at: string | null;
  service_date: string;
  meal_type: string;
  title: string;
  starts_at: string;
  ends_at: string;
  cutoff_at: string;
  name: string;
  roll_number: string;
  meal?: Meal;
  extras?: Order[];
}
export interface Leave {
  id: string;
  user_id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
  status: string;
  review_note: string | null;
  name?: string;
  roll_number?: string;
  created_at: string;
}
export interface Invoice {
  id: string;
  user_id: string;
  month: string;
  total_paise: number;
  paid_paise: number;
  outstanding_paise: number;
  status: string;
  due_on: string;
  issued_at: string;
  payments_mode: string;
  name?: string;
  roll_number?: string;
  lines?: {
    id: string;
    description: string;
    quantity: number;
    unit_price_paise: number;
  }[];
  payments?: {
    id: string;
    amount_paise: number;
    method: string;
    reference: string;
    created_at: string;
  }[];
}
export interface Attempt {
  id: string;
  amount_paise: number;
  outcome: string;
  created_at: string;
}
export interface Preview {
  month: string;
  totalPaise: number;
  provisional: boolean;
  lines: {
    sourceId: string;
    description: string;
    quantity: number;
    unitPricePaise: number;
  }[];
}
export interface Notice {
  id: string;
  title: string;
  body: string;
  priority: string;
  expires_at: string;
  created_at: string;
  author_name?: string;
}
export interface Complaint {
  id: string;
  user_id: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  replies?: {
    id: string;
    author_name: string;
    author_role: Role;
    message: string;
    created_at: string;
  }[];
}
export interface Feedback {
  id: string;
  booking_id: string;
  taste: number;
  hygiene: number;
  portion: number;
  comment: string;
  title?: string;
  meal_type?: string;
  service_date?: string;
}
export interface Item {
  id: string;
  name: string;
  unit: string;
  stock: number;
  low_stock_threshold: number;
  low_stock?: number;
}
export interface Supplier {
  id: string;
  name: string;
  contact: string;
}
export interface Movement {
  id: string;
  kind: string;
  quantity: number;
  total_cost_paise?: number;
  supplier_name?: string;
  reference?: string;
  reason: string;
  created_at: string;
}
export interface ServiceReport {
  id: string;
  title: string;
  service_date: string;
  meal_type: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  attended: number;
  cancelled: number;
  no_shows: number | null;
  waste_grams: number | null;
  prepared_portions: number | null;
  leftover_portions: number | null;
  taste_rating: number | null;
  hygiene_rating: number | null;
  portion_rating: number | null;
  feedback_count: number;
  extras_reserved: number;
  attendance_percent: number;
  dietaryCounts?: { dietary_preference: string; count: number }[];
  extras?: { name: string; quantity: number }[];
}
export interface Dashboard {
  role: Role;
  date: string;
  paymentsMode: string;
  billingMonth?: string;
  provisionalBillPaise?: number;
  outstandingPaise?: number;
  upcomingBookings?: Booking[];
  pendingLeaves?: number;
  openComplaints: number;
  services?: ServiceReport[];
  lowStockItems?: Item[];
  activeResidents?: number;
  overduePaise?: number;
}
export interface Policy {
  booking_horizon_days: number;
  minimum_leave_days: number;
  feedback_window_days: number;
}
export interface FinancialReport {
  month: string;
  paymentsMode: string;
  invoiceCount: number;
  billedPaise: number;
  collectedForInvoicesPaise: number;
  simulatedCollectionsPaise: number;
  verifiedCollectionsPaise: number;
  cashReceivedDuringMonthPaise: number;
  simulatedReceivedDuringMonthPaise: number;
  procurementCostPaise: number;
  outstandingPaise: number;
}
export interface Audit {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
