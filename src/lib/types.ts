/**
 * Shared API-facing types for the Merrylane Cafe system.
 */

import type { OrderDiscount } from "./orderDiscount";

export interface Category {
  id: number;
  name: string;
  slug: string;
  display_order: number;
}

export interface MenuVariant {
  id: number;
  menu_item_id: number;
  name: string;
  variant_type: string;
  price_modifier: number;
  display_order: number;
}

export interface MenuExtra {
  id: number;
  menu_item_id: number;
  name: string;
  price_modifier: number;
}

export interface Addon {
  id: number;
  name: string;
  price_modifier: number;
  is_active: boolean | number;
  display_order: number;
  created_at?: string;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  category_id: number;
  category_name?: string;
  image_url: string;
  is_active: boolean | number;
  is_best_seller: boolean | number;
  display_order: number;
  stock_count: number;
  stock_tracking_enabled: boolean | number;
  low_stock_threshold: number;
  stock_status: "available" | "low" | "out";
  stock_note: string | null;
  stock_scope: "today" | "until_changed";
  stock_manual_out_date: string | null;
  variants: MenuVariant[];
  extras: MenuExtra[];
}

export type OrderStatus =
  | "pending"
  | "payment_pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";
export type OrderType = "dine_in" | "take_out";
export type PaymentMethod = "gcash" | "counter" | "cash";
export type PaymentStatus = "pending" | "verified" | "rejected";

export interface OrderItemAddon {
  id: number;
  order_id: number;
  order_item_id: number;
  addon_id?: number | null;
  name: string;
  price_modifier: number;
  quantity: number;
  added_by?: number | null;
  added_by_name?: string | null;
  created_at: string;
}

export interface OrderBalancePayment {
  id: number;
  order_id: number;
  amount: number;
  payment_method: "gcash" | "counter";
  status: "pending" | "verified" | "rejected";
  payment_reference?: string | null;
  payment_proof_url?: string | null;
  received_by?: number | null;
  received_by_name?: string | null;
  created_at: string;
  verified_at?: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number;
  name: string;
  variant_name?: string | null;
  extras: string;
  sugar_level?: string | null;
  note?: string | null;
  quantity: number;
  price_at_time: number;
  addons?: OrderItemAddon[];
}

export interface SalesTransaction {
  transaction_id: string;
  order_id: number;
  order_number?: number;
  handled_by?: string | null;
  table_number: number;
  customer_name: string;
  payment_method: "gcash" | "counter";
  amount: number;
  subtotal?: number;
  service_charge?: number;
  discount_amount: number;
  vat_mode?: "none" | "add" | "included";
  vat_rate_pct?: number;
  vat_amount?: number;
  rounding_adjustment?: number;
  paid_at: string;
  payment_reference: string | null;
  transaction_type: "order" | "additional";
}

export interface RejectedPayment {
  rejection_id: number;
  order_id: number;
  order_number: number;
  table_number: number;
  customer_name: string;
  payment_method: string;
  amount: number;
  rejected_at: string;
  rejected_by: string | null;
  payment_reference: string | null;
  proof_type: "inline" | "external" | null;
  external_proof_url: string | null;
}

export interface Order {
  id: number;
  table_number: number;
  order_type: OrderType;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  customer_name?: string | null;
  subtotal: number;
  service_charge: number;
  total: number;
  vat_mode?: "none" | "add" | "included" | null;
  vat_rate_pct?: number;
  vat_amount?: number;
  rounding_adjustment?: number;
  discount_amount?: number;
  discounts?: OrderDiscount[];
  remarks?: string | null;
  queue_number?: number | null;
  order_number?: number;
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
  preparing_at?: string | null;
  cancelled_at?: string | null;
  ready_at?: string | null;
  completed_at?: string | null;
  completion_reason?: string | null;
  cancellation_reason?: string | null;
  payment_proof_url?: string | null;
  payment_reference?: string | null;
  payment_amount?: number | null;
  cash_received?: number | null;
  change_given?: number | null;
  balance_due?: number;
  balance_payments?: OrderBalancePayment[];
  prep_minutes?: number | null;
  estimated_ready_at?: string | null;
  items?: OrderItem[];
}

export interface WaiterRequest {
  id: number;
  table_number: number;
  order_id?: number | null;
  guest_id?: string | null;
  attempt_no?: number | null;
  request_type: string;
  message: string;
  status: "pending" | "acknowledged" | "resolved";
  created_at: string;
  updated_at?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export interface Review {
  id: number;
  order_id: number | null;
  table_number: number;
  rating: number;
  customer_name?: string | null;
  comment?: string | null;
  photo_url?: string | null;
  created_at: string;
}

export interface CafeSettings {
  cafe_name: string;
  cafe_location: string;
  wifi_ssid: string;
  gcash_number: string;
  gcash_name: string;
  ordering_closed: boolean;
  last_order_time: string;
  opening_time: string;
  closing_time: string;
  service_charge_pct: number;
  vat_mode: "none" | "add" | "included";
  vat_rate_pct: number;
  days_operating: string;
}

export interface CartExtra {
  id: number;
  name: string;
  price_modifier: number;
}

export interface CartItem {
  key: string;
  menuItemId: number;
  name: string;
  category: string;
  basePrice: number;
  variant?: { id: number; name: string; priceModifier: number } | null;
  variantIds?: number[];
  extras: CartExtra[];
  sugarLevel?: string | null;
  note?: string | null;
  quantity: number;
  unitPrice: number;
  /** Portions left when this line was added, so the cart cannot exceed stock. */
  stockLimit?: number | null;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  contact_number?: string | null;
  address?: string | null;
  duty_hours?: string | null;
  role: "admin" | "staff";
  is_active?: number;
  last_login_at?: string | null;
  last_logout_at?: string | null;
  duty_minutes?: number;
  session_id?: string | null;
  created_at?: string;
}
