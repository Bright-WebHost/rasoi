/**
 * Database types for the existing Supabase tables.
 *
 * These mirror the EXISTING production schema used by n8n.
 * Do NOT modify these types without also verifying backward
 * compatibility with the n8n workflow.
 */

export interface SupabaseMenuRow {
  id: number
  name: string
  category: string
  description: string
  price: number
  vegetarian: boolean
  spicy: boolean
}

export interface SupabaseCustomerRow {
  id: number
  created_at: string
  name: string
  email: string
  phone: string
  request_type: string
  date: string
  time: string
  preferences: string
}

export interface ProfileRow {
  id: number
  user_id: string
  full_name: string
  phone: string
  email: string
  default_address: string
  created_at: string
  updated_at: string
}

/**
 * Dedicated customer identity table for website ordering.
 */
export interface AppCustomerRow {
  id: string
  channel: string
  channel_user_id: string
  phone: string | null
  name: string | null
  created_at: string
  updated_at: string
}

/**
 * Customer address table for saving delivery addresses.
 */
export interface CustomerAddressRow {
  id: string
  customer_id: string
  label: string | null
  address: string
  landmark: string | null
  pincode: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

/**
 * Ordering session — links a WhatsApp conversation to
 * a website browsing session via a one-time token.
 */
export interface OrderingSessionRow {
  id: string       // uuid
  customer_id: string // uuid references app_customers
  channel: string
  channel_user_id: string
  token_hash: string
  status: 'pending' | 'consumed' | 'expired'
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface MenuCategoryRow {
  id: string
  name: string
  display_order: number
  created_at: string
  updated_at: string
}

export interface MenuItemRow {
  id: string
  category_id: string
  name: string
  description: string
  price_paise: number
  image: string
  vegetarian: boolean
  badge: string | null
  featured: boolean
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface MenuItemVariantRow {
  id: string
  menu_item_id: string
  name: string
  price_paise: number
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface OrderRow {
  id: string
  order_number: string
  customer_id: string
  order_type: 'delivery' | 'pickup' | 'dine-in'
  order_status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled'
  payment_status: 'pending' | 'paid' | 'failed'
  payment_method: 'upi' | 'cash' | 'online'
  subtotal_paise: number
  delivery_fee_paise: number
  discount_paise: number
  total_paise: number
  customer_name_snapshot: string
  customer_phone_snapshot: string
  delivery_address_snapshot: string | null
  landmark_snapshot: string | null
  pincode_snapshot: string | null
  table_id: string | null
  table_reservation_id: string | null
  scheduled_time: string | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface OrderItemRow {
  id: string
  order_id: string
  menu_item_id: string | null
  variant_id: string | null
  item_name_snapshot: string
  variant_name_snapshot: string | null
  unit_price_paise_snapshot: number
  quantity: number
  line_total_paise: number
  created_at: string
}

export interface RestaurantTableRow {
  id: string
  table_number: string
  capacity: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TableReservationRow {
  id: string
  table_id: string
  customer_id: string
  order_id: string | null
  reservation_time: string
  end_time: string
  status: 'reserved' | 'seated' | 'completed' | 'cancelled'
  party_size: number
  created_at: string
  updated_at: string
}

export interface OrderEventRow {
  id: string
  order_id: string
  event_type: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter'
  payload: Record<string, any>
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

/**
 * Minimal Database type for Supabase client generics.
 * Only defines the tables we read from; keeps the client type-safe
 * without requiring a full generated schema.
 */
export interface Database {
  public: {
    Tables: {
      menu: {
        Row: SupabaseMenuRow
        Insert: Omit<SupabaseMenuRow, 'id'>
        Update: Partial<Omit<SupabaseMenuRow, 'id'>>
        Relationships: []
      }
      customers: {
        Row: SupabaseCustomerRow
        Insert: Omit<SupabaseCustomerRow, 'id' | 'created_at'>
        Update: Partial<Omit<SupabaseCustomerRow, 'id' | 'created_at'>>
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        Insert: {
          id?: number
          user_id: string
          full_name?: string
          phone?: string
          email?: string
          default_address?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          full_name?: string
          phone?: string
          email?: string
          default_address?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_customers: {
        Row: AppCustomerRow
        Insert: {
          id?: string
          channel: string
          channel_user_id: string
          phone?: string | null
          name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel?: string
          channel_user_id?: string
          phone?: string | null
          name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_addresses: {
        Row: CustomerAddressRow
        Insert: {
          id?: string
          customer_id: string
          label?: string | null
          address: string
          landmark?: string | null
          pincode?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          label?: string | null
          address?: string
          landmark?: string | null
          pincode?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "app_customers"
            referencedColumns: ["id"]
          }
        ]
      }
      ordering_sessions: {
        Row: OrderingSessionRow
        Insert: {
          id?: string
          customer_id: string
          channel: string
          channel_user_id: string
          token_hash: string
          status?: string
          expires_at: string
          used_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          channel?: string
          channel_user_id?: string
          token_hash?: string
          status?: string
          expires_at?: string
          used_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordering_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "app_customers"
            referencedColumns: ["id"]
          }
        ]
      }
      menu_categories: {
        Row: MenuCategoryRow
        Insert: Omit<MenuCategoryRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<MenuCategoryRow, 'id'>>
        Relationships: []
      }
      menu_items: {
        Row: MenuItemRow
        Insert: Omit<MenuItemRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<MenuItemRow, 'id'>>
        Relationships: []
      }
      menu_item_variants: {
        Row: MenuItemVariantRow
        Insert: Omit<MenuItemVariantRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<MenuItemVariantRow, 'id'>>
        Relationships: []
      }
      orders: {
        Row: OrderRow
        Insert: Omit<OrderRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<OrderRow, 'id'>>
        Relationships: []
      }
      order_items: {
        Row: OrderItemRow
        Insert: Omit<OrderItemRow, 'id' | 'created_at'>
        Update: Partial<Omit<OrderItemRow, 'id'>>
        Relationships: []
      }
      restaurant_tables: {
        Row: RestaurantTableRow
        Insert: Omit<RestaurantTableRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<RestaurantTableRow, 'id'>>
        Relationships: []
      }
      table_reservations: {
        Row: TableReservationRow
        Insert: Omit<TableReservationRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<TableReservationRow, 'id'>>
        Relationships: []
      }
      order_events: {
        Row: OrderEventRow
        Insert: Omit<OrderEventRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<OrderEventRow, 'id'>>
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

