/**
 * Restaurant settings — shared by server, dashboard and customer app.
 *
 * Values live in the `settings` key/value table as strings, using the same
 * keys as the Oceana dashboard so n8n's chat_context() can read them as-is.
 * This file is pure (no DB access) so it is safe to import anywhere.
 */

export const SETTING_KEYS = [
  "restaurant_name",
  "tagline",
  "address",
  "phone",
  "city",
  "logo_url",
  "gst_percent",
  "gstin",
  "open_time",
  "close_time",
  "hours",
  "orders_paused",
  "order_types",
  "min_order",
  "delivery_fee",
  "free_delivery_above",
  "delivery_note",
  "payment_methods",
  "auto_print",
  "unknown_policy",
  "google_review_url",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type RawSettings = Record<SettingKey, string>;

export const DEFAULT_RAW_SETTINGS: RawSettings = {
  restaurant_name: "Pabbas",
  tagline: "Delicious desserts since 1969",
  address: "Lalbagh, Mangaluru",
  phone: "",
  city: "Mangaluru",
  logo_url: "",
  gst_percent: "5",
  gstin: "",
  open_time: "07:00",
  close_time: "23:30",
  hours: "7:00 AM to 11:30 PM, every day",
  orders_paused: "false",
  order_types: "Delivery, Takeaway, Dine-in",
  min_order: "0",
  delivery_fee: "35",
  free_delivery_above: "0",
  delivery_note: "",
  payment_methods: "Cash on delivery or at the counter. UPI coming soon.",
  auto_print: "false",
  unknown_policy: "If you do not know something, say you will check with the team and offer to take the order anyway. Never invent facts.",
  google_review_url: "",
};

export interface OrderTypesEnabled {
  delivery: boolean;
  takeaway: boolean;
  dineIn: boolean;
}

export interface RestaurantSettings {
  restaurantName: string;
  tagline: string;
  address: string;
  phone: string;
  city: string;
  logoUrl: string;
  gstPercent: number;
  gstin: string;
  openTime: string;
  closeTime: string;
  hoursText: string;
  ordersPaused: boolean;
  orderTypes: OrderTypesEnabled;
  minOrder: number;
  deliveryFee: number;
  freeDeliveryAbove: number;
  deliveryNote: string;
  paymentMethods: string;
  autoPrint: boolean;
  unknownPolicy: string;
  googleReviewUrl: string;
}

export type CustomerOrderType = "delivery" | "takeaway" | "dine-in";

const toNumber = (value: string, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function parseOrderTypes(value: string): OrderTypesEnabled {
  return {
    delivery: /delivery/i.test(value),
    takeaway: /takeaway|pickup/i.test(value),
    dineIn: /dine/i.test(value),
  };
}

export function serializeOrderTypes(types: OrderTypesEnabled): string {
  return [types.delivery && "Delivery", types.takeaway && "Takeaway", types.dineIn && "Dine-in"].filter(Boolean).join(", ");
}

/** Merge DB rows over the defaults. Unknown keys are ignored. */
export function rowsToRawSettings(rows: Array<{ key: string; value: string | null }> | null | undefined): RawSettings {
  const raw: RawSettings = { ...DEFAULT_RAW_SETTINGS };
  for (const row of rows ?? []) {
    if ((SETTING_KEYS as readonly string[]).includes(row.key)) {
      raw[row.key as SettingKey] = row.value ?? "";
    }
  }
  return raw;
}

export function parseSettings(raw: RawSettings): RestaurantSettings {
  return {
    restaurantName: raw.restaurant_name || DEFAULT_RAW_SETTINGS.restaurant_name,
    tagline: raw.tagline,
    address: raw.address,
    phone: raw.phone,
    city: raw.city,
    logoUrl: raw.logo_url,
    gstPercent: toNumber(raw.gst_percent),
    gstin: raw.gstin,
    openTime: raw.open_time,
    closeTime: raw.close_time,
    hoursText: raw.hours,
    ordersPaused: raw.orders_paused === "true",
    orderTypes: parseOrderTypes(raw.order_types),
    minOrder: toNumber(raw.min_order),
    deliveryFee: toNumber(raw.delivery_fee),
    freeDeliveryAbove: toNumber(raw.free_delivery_above),
    deliveryNote: raw.delivery_note,
    paymentMethods: raw.payment_methods,
    autoPrint: raw.auto_print === "true",
    unknownPolicy: raw.unknown_policy,
    googleReviewUrl: raw.google_review_url,
  };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string) {
  return TIME_RE.test(value);
}

/** Minutes since midnight in India time. */
function istMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Mirrors public.is_open() in SQL: paused → closed, blank hours → open, overnight supported. */
export function isOpenAt(settings: Pick<RestaurantSettings, "ordersPaused" | "openTime" | "closeTime">, at: Date = new Date()) {
  if (settings.ordersPaused) return false;
  if (!isValidTime(settings.openTime) || !isValidTime(settings.closeTime)) return true;
  const now = istMinutes(at);
  const open = toMinutes(settings.openTime);
  const close = toMinutes(settings.closeTime);
  if (open <= close) return now >= open && now < close;
  return now >= open || now < close;
}

/** "19:30" → "7:30 PM" */
export function formatTime12h(hhmm: string) {
  if (!isValidTime(hhmm)) return hhmm;
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function closedMessage(settings: Pick<RestaurantSettings, "ordersPaused" | "openTime" | "closeTime">) {
  if (settings.ordersPaused) return "We're not taking orders right now. Please check back soon.";
  return `We're closed right now. We open at ${formatTime12h(settings.openTime)}.`;
}

export function deliveryFeeFor(settings: Pick<RestaurantSettings, "deliveryFee" | "freeDeliveryAbove">, itemsSubtotal: number) {
  if (itemsSubtotal <= 0) return 0;
  if (settings.freeDeliveryAbove > 0 && itemsSubtotal >= settings.freeDeliveryAbove) return 0;
  return settings.deliveryFee;
}

export function isOrderTypeEnabled(settings: Pick<RestaurantSettings, "orderTypes">, type: CustomerOrderType) {
  if (type === "delivery") return settings.orderTypes.delivery;
  if (type === "takeaway") return settings.orderTypes.takeaway;
  return settings.orderTypes.dineIn;
}

const ORDER_TYPE_LABEL: Record<CustomerOrderType, string> = { delivery: "Delivery", takeaway: "Takeaway", "dine-in": "Dine-in" };

/**
 * Business rules for a new customer order (website + WhatsApp AI).
 * Returns a customer-friendly reason, or null when the order is allowed.
 * An empty pincode list means every pincode is accepted.
 */
export function checkOrderRules(
  settings: Pick<RestaurantSettings, "ordersPaused" | "openTime" | "closeTime" | "orderTypes" | "minOrder">,
  pincodes: string[],
  order: { orderType: CustomerOrderType; itemsSubtotal: number; pincode?: string | null },
  at: Date = new Date()
): string | null {
  if (!isOpenAt(settings, at)) return closedMessage(settings);

  if (!isOrderTypeEnabled(settings, order.orderType)) {
    return `Sorry, ${ORDER_TYPE_LABEL[order.orderType].toLowerCase()} orders are not available right now.`;
  }

  if (order.orderType === "delivery") {
    if (settings.minOrder > 0 && order.itemsSubtotal < settings.minOrder) {
      return `The minimum order for delivery is ₹${settings.minOrder}. Please add ₹${Math.ceil(settings.minOrder - order.itemsSubtotal)} more.`;
    }
    if (pincodes.length > 0) {
      const pin = (order.pincode ?? "").trim();
      if (!pin) return "Please enter your delivery pincode.";
      if (!pincodes.includes(pin)) return `Sorry, we don't deliver to ${pin} yet.`;
    }
  }

  return null;
}

/** Menu prices include GST, so the tax is carved out of the amount, not added. */
export function gstBreakup(amountInclusive: number, gstPercent: number) {
  if (!(gstPercent > 0) || !(amountInclusive > 0)) return null;
  const taxable = amountInclusive / (1 + gstPercent / 100);
  const gst = amountInclusive - taxable;
  return {
    taxable: Math.round(taxable * 100) / 100,
    cgst: Math.round((gst / 2) * 100) / 100,
    sgst: Math.round((gst / 2) * 100) / 100,
    halfRate: gstPercent / 2,
  };
}

/** Subset safe to send to anyone (customer app). */
export interface PublicSettings {
  restaurantName: string;
  tagline: string;
  address: string;
  phone: string;
  logoUrl: string;
  hoursText: string;
  openTime: string;
  closeTime: string;
  ordersPaused: boolean;
  isOpen: boolean;
  orderTypes: OrderTypesEnabled;
  minOrder: number;
  deliveryFee: number;
  freeDeliveryAbove: number;
  deliveryNote: string;
  paymentMethods: string;
  pincodes: string[];
}

export function toPublicSettings(settings: RestaurantSettings, pincodes: string[], at: Date = new Date()): PublicSettings {
  return {
    restaurantName: settings.restaurantName,
    tagline: settings.tagline,
    address: settings.address,
    phone: settings.phone,
    logoUrl: settings.logoUrl,
    hoursText: settings.hoursText,
    openTime: settings.openTime,
    closeTime: settings.closeTime,
    ordersPaused: settings.ordersPaused,
    isOpen: isOpenAt(settings, at),
    orderTypes: settings.orderTypes,
    minOrder: settings.minOrder,
    deliveryFee: settings.deliveryFee,
    freeDeliveryAbove: settings.freeDeliveryAbove,
    deliveryNote: settings.deliveryNote,
    paymentMethods: settings.paymentMethods,
    pincodes,
  };
}
