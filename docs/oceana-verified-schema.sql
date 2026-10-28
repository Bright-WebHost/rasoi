-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.menu_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_number integer NOT NULL UNIQUE,
  item_name text NOT NULL,
  category text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT true,
  description text DEFAULT ''::text,
  image_url text DEFAULT ''::text,
  variants jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT menu_items_pkey PRIMARY KEY (id)
);
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text DEFAULT ''::text,
  preferred_language text NOT NULL DEFAULT 'en'::text,
  address text DEFAULT ''::text,
  last_order_date date,
  total_orders integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'whatsapp'::text,
  blast_message_id text DEFAULT ''::text,
  blast_sent_at timestamp with time zone,
  blast_status text DEFAULT ''::text,
  blast_read_at timestamp with time zone,
  opted_out boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_number text NOT NULL DEFAULT ''::text UNIQUE,
  customer_phone text NOT NULL DEFAULT ''::text,
  customer_name text DEFAULT ''::text,
  items text DEFAULT ''::text,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new'::text CHECK (status = ANY (ARRAY['draft'::text, 'new'::text, 'confirmed'::text, 'preparing'::text, 'ready_for_pickup'::text, 'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text])),
  order_type text DEFAULT 'delivery'::text CHECK (order_type = ANY (ARRAY['delivery'::text, 'takeaway'::text, 'dine-in'::text])),
  source text NOT NULL DEFAULT 'whatsapp'::text,
  address text DEFAULT ''::text,
  landmark text DEFAULT ''::text,
  city text DEFAULT ''::text,
  pincode text DEFAULT ''::text,
  table_number text DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  confirmed_at timestamp with time zone,
  amend_window_until timestamp with time zone,
  amended_at timestamp with time zone,
  amendment_count integer NOT NULL DEFAULT 0,
  original_items text DEFAULT ''::text,
  items_json jsonb DEFAULT '[]'::jsonb,
  cancel_reason text,
  cancelled_by text,
  cancelled_at timestamp with time zone,
  cancel_requested_at timestamp with time zone,
  CONSTRAINT orders_pkey PRIMARY KEY (id)
);
CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  menu_item_id uuid,
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  size text DEFAULT ''::text,
  notes text DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound'::text CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text])),
  content text DEFAULT ''::text,
  sender text NOT NULL DEFAULT 'customer'::text CHECK (sender = ANY (ARRAY['customer'::text, 'ai'::text, 'agent'::text, 'system'::text])),
  message_type text NOT NULL DEFAULT 'text'::text,
  message_id text DEFAULT ''::text,
  ai_intent text DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.chat_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  last_message text DEFAULT ''::text,
  last_message_at timestamp with time zone,
  last_message_by text DEFAULT 'customer'::text,
  unread_count integer NOT NULL DEFAULT 0,
  ai_enabled boolean NOT NULL DEFAULT true,
  ai_disabled_at timestamp with time zone,
  ai_disabled_by text DEFAULT ''::text,
  last_human_activity_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  flow_state jsonb,
  CONSTRAINT chat_sessions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.memory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  last_order_summary text DEFAULT ''::text,
  favorite_items text DEFAULT ''::text,
  preferences text DEFAULT ''::text,
  notes text DEFAULT ''::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT memory_pkey PRIMARY KEY (id)
);
CREATE TABLE public.promotions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT ''::text,
  original_price numeric DEFAULT 0,
  promo_price numeric DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT promotions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.delivery_pincodes (
  pincode text NOT NULL,
  area text DEFAULT ''::text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delivery_pincodes_pkey PRIMARY KEY (pincode)
);
CREATE TABLE public.settings (
  key text NOT NULL,
  value text NOT NULL DEFAULT ''::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (key)
);
CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_number text,
  phone text NOT NULL,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text DEFAULT ''::text,
  asked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id)
);
CREATE TABLE public.carts (
  phone text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  nudged_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT carts_pkey PRIMARY KEY (phone)
);
CREATE TABLE public.blast_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL,
  message_id text DEFAULT ''::text,
  error text DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT blast_log_pkey PRIMARY KEY (id)
);
CREATE TABLE public.staff_members (
  email text NOT NULL,
  name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT staff_members_pkey PRIMARY KEY (email)
);