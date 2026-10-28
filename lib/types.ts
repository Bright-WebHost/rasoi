export type OrderType = "delivery" | "pickup" | "dine-in";
export type PaymentMethod = "cash" | "upi" | "online";

export interface MenuOption {
  label: string;
  values: string[];
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  image: string;
  vegetarian?: boolean;
  badge?: string;
  featured?: boolean;
  is_pinned?: boolean;
  /** In 2+ real orders today (set by /api/menu) */
  popular_today?: boolean;
  options?: MenuOption[];
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  address: string;
  landmark: string;
  pincode: string;
  pickupDate: string;
  pickupTime: string;
  payment: PaymentMethod;
}
