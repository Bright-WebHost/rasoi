-- RASOI single-file Supabase initialization
-- Target: new Rasoi project xwakalryzigtvoirwooq, whose public schema was reported empty.
-- Run once in Supabase SQL Editor. Draft only: not applied or verified on remote Postgres.
-- Creates schema and security objects only; no menu/customer/staff/table seed data or secrets.
-- Orders start paused. Do not combine with legacy phase4/phase5/order-event scripts.
BEGIN;CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- SEQUENCE
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
  START WITH 1000
  MINVALUE 1
  MAXVALUE 9223372036854775807
  INCREMENT BY 1
  NO CYCLE;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number integer NOT NULL UNIQUE,
  item_name text NOT NULL,
  category text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT true,
  vegetarian boolean,
  description text DEFAULT '',
  image_url text DEFAULT '',
  variants jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text DEFAULT '',
  preferred_language text NOT NULL DEFAULT 'en',
  address text DEFAULT '',
  last_order_date date,
  total_orders integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'whatsapp',
  blast_message_id text DEFAULT '',
  blast_sent_at timestamptz,
  blast_read_at timestamptz,
  opted_out boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL DEFAULT '' UNIQUE,
  customer_phone text NOT NULL DEFAULT '',
  customer_name text DEFAULT '',
  items text DEFAULT '',
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'draft', 'new', 'confirmed', 'preparing', 'ready_for_pickup',
    'out_for_delivery', 'delivered', 'cancelled'
  )),
  order_type text DEFAULT 'delivery' CHECK (order_type IN ('delivery', 'takeaway', 'dine-in')),
  source text NOT NULL DEFAULT 'whatsapp',
  address text DEFAULT '',
  landmark text DEFAULT '',
  city text DEFAULT '',
  pincode text DEFAULT '',
  table_number text DEFAULT '',
  confirmed_at timestamptz,
  amend_window_until timestamptz,
  amended_at timestamptz,
  amendment_count integer NOT NULL DEFAULT 0,
  original_items text DEFAULT '',
  items_json jsonb DEFAULT '[]'::jsonb,
  cancel_reason text,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  menu_item_id uuid REFERENCES public.menu_items(id),
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  size text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  content text DEFAULT '',
  sender text NOT NULL DEFAULT 'customer' CHECK (sender IN ('customer', 'ai', 'agent', 'system')),
  message_type text NOT NULL DEFAULT 'text',
  message_id text DEFAULT '',
  ai_intent text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  last_message text DEFAULT '',
  last_message_at timestamptz,
  last_message_by text DEFAULT 'customer',
  unread_count integer NOT NULL DEFAULT 0,
  ai_enabled boolean NOT NULL DEFAULT true,
  ai_disabled_at timestamptz,
  ai_disabled_by text DEFAULT '',
  last_human_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  flow_state jsonb
);

CREATE TABLE IF NOT EXISTS public.memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  last_order_summary text DEFAULT '',
  favorite_items text DEFAULT '',
  preferences text DEFAULT '',
  notes text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  original_price numeric DEFAULT 0,
  promo_price numeric DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_pincodes (
  pincode text PRIMARY KEY,
  area text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text,
  phone text NOT NULL,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  comment text DEFAULT '',
  asked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carts (
  phone text PRIMARY KEY,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  nudged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blast_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL,
  message_id text DEFAULT '',
  error text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_members (
  email text PRIMARY KEY,
  name text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Secondary indexes are intentionally omitted here because the verified
-- Schema Visualizer export supplied table constraints, not named indexes.

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  p text;
BEGIN
  IF raw IS NULL THEN RETURN ''; END IF;
  p := regexp_replace(raw, '[^0-9]', '', 'g');
  IF p = '' THEN RETURN ''; END IF;
  IF length(p) = 11 AND p LIKE '0%' THEN RETURN '91' || substring(p FROM 2); END IF;
  IF length(p) = 10 AND (p LIKE '6%' OR p LIKE '7%' OR p LIKE '8%' OR p LIKE '9%') THEN RETURN '91' || p; END IF;
  IF length(p) = 12 AND p LIKE '91%' THEN RETURN p; END IF;
  IF length(p) BETWEEN 11 AND 15 AND (p LIKE '971%' OR p LIKE '966%' OR p LIKE '44%' OR p LIKE '1%' OR p LIKE '65%') THEN RETURN p; END IF;
  RETURN '91' || p;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_customer_phone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.phone := public.normalize_phone(NEW.phone); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.normalize_generic_phone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.phone := public.normalize_phone(NEW.phone); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.normalize_order_phone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.customer_phone := public.normalize_phone(NEW.customer_phone); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.items_text(p_items jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  select coalesce(string_agg((e ->> 'name') || ' x' || (e ->> 'quantity'), ', ' order by ord), '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality t(e, ord)
$$;

CREATE OR REPLACE FUNCTION public.stamp_cancel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, 'staff');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.stamp_confirm_window()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    NEW.confirmed_at := now();
    NEW.amend_window_until := now() + interval '2 minutes';
    IF COALESCE(NEW.original_items, '') = '' THEN
      NEW.original_items := NEW.items;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.next_order_number(src text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE prefix text;
BEGIN
  prefix := CASE lower(COALESCE(src, 'whatsapp'))
    WHEN 'pwa' THEN 'RSO-P-'
    WHEN 'staff' THEN 'RSO-S-'
    ELSE 'RSO-W-'
  END;
  RETURN prefix || nextval('public.order_number_seq')::text;
END; $$;

CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := public.next_order_number(NEW.source);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.increment_customer_orders()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.customers (phone, name, last_order_date, total_orders, source)
  VALUES (NEW.customer_phone, NEW.customer_name, NEW.created_at, 1, NEW.source)
  ON CONFLICT (phone) DO UPDATE SET
    name = CASE WHEN COALESCE(btrim(EXCLUDED.name), '') = '' THEN customers.name ELSE EXCLUDED.name END,
    last_order_date = EXCLUDED.last_order_date,
    total_orders = customers.total_orders + 1,
    updated_at = now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.touch_chat_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.chat_sessions (phone, last_message, last_message_at, last_message_by, updated_at)
  VALUES (NEW.phone, NEW.content, NEW.created_at, NEW.sender, now())
  ON CONFLICT (phone) DO UPDATE SET
    last_message = EXCLUDED.last_message,
    last_message_at = EXCLUDED.last_message_at,
    last_message_by = EXCLUDED.last_message_by,
    unread_count = CASE WHEN NEW.direction = 'inbound' THEN chat_sessions.unread_count + 1 ELSE 0 END,
    updated_at = now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.is_open(p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_open text;
  v_close text;
  v_now time;
BEGIN
  IF (SELECT value FROM settings WHERE key = 'orders_paused') = 'true' THEN
    RETURN false;
  END IF;

  SELECT NULLIF(value, '') INTO v_open FROM settings WHERE key = 'open_time';
  SELECT NULLIF(value, '') INTO v_close FROM settings WHERE key = 'close_time';
  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN true;
  END IF;

  v_now := (p_at AT TIME ZONE 'Asia/Kolkata')::time;
  IF v_open::time <= v_close::time THEN
    RETURN v_now >= v_open::time AND v_now < v_close::time;
  END IF;
  RETURN v_now >= v_open::time OR v_now < v_close::time;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_check()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('staff', public.is_staff(), 'email', coalesce(auth.jwt() ->> 'email', ''))
$function$;

-- ============================================================
-- BUSINESS FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.chat_context(p_phone text, p_order text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'is_open', public.is_open(),
  'customer', (select to_jsonb(c) from customers c where c.phone = normalize_phone(p_phone)),
  'session', (select to_jsonb(s) from chat_sessions s where s.phone = normalize_phone(p_phone)),
  'history', coalesce((select jsonb_agg(h order by h.created_at) from (select direction, sender, content, created_at from messages where phone = normalize_phone(p_phone) order by created_at desc limit 12) h), '[]'::jsonb),
  'settings', coalesce((select jsonb_object_agg(key, value) from settings), '{}'::jsonb),
  'pincodes', coalesce((select jsonb_agg(pincode) from delivery_pincodes where active), '[]'::jsonb),
  'promos', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'price', promo_price)) from promotions where active), '[]'::jsonb),
  'menu', coalesce((select string_agg(item_name || '|' || case when price > 0 then round(price)::text else 'ASK' end, E'\n' order by category, item_number) from menu_items where available), ''),
  'open_order', (select to_jsonb(o) from orders o where o.customer_phone = normalize_phone(p_phone)
                   and ((o.status = 'draft' and o.created_at > now() - interval '45 minutes') or (o.status in ('new', 'confirmed') and o.created_at > now() - interval '2 hours'))
                 order by o.created_at desc limit 1),
  'target_order', (select to_jsonb(o) from orders o where p_order is not null and o.order_number = upper(p_order) and o.customer_phone = normalize_phone(p_phone)),
  'active_order', (select to_jsonb(o) from orders o where o.customer_phone = normalize_phone(p_phone) and o.status in ('preparing', 'ready_for_pickup', 'out_for_delivery') and o.created_at > now() - interval '3 hours' order by o.created_at desc limit 1)
);
$function$;

CREATE OR REPLACE FUNCTION public.order_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('is_open', public.is_open(), 'hours', coalesce((select value from settings where key = 'hours'), ''),
    'min_order', coalesce((select value from settings where key = 'min_order'), '0'), 'city', coalesce((select value from settings where key = 'city'), ''),
    'pincodes', coalesce((select jsonb_agg(pincode) from delivery_pincodes where active), '[]'::jsonb),
    'menu', coalesce((select jsonb_agg(jsonb_build_object('n', item_number, 'name', item_name, 'price', price, 'available', available)) from menu_items), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.save_cart(p_phone text, p_items jsonb, p_total numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ph text := normalize_phone(p_phone);
begin
  if length(ph) < 11 or length(ph) > 15 then return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then return; end if;
  insert into carts(phone, items, total, nudged_at, updated_at) values (ph, p_items, least(greatest(coalesce(p_total, 0), 0), 100000), null, now())
  on conflict (phone) do update set items = excluded.items, total = excluded.total, nudged_at = null, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.customer_confirm(p_phone text, p_order text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o orders;
begin
  select * into o from orders where order_number = upper(p_order) and customer_phone = normalize_phone(p_phone) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status = 'draft' then
    if o.created_at < now() - interval '45 minutes' then return jsonb_build_object('result', 'expired', 'order', to_jsonb(o)); end if;
    if not public.is_open() then return jsonb_build_object('result', 'closed', 'order', to_jsonb(o)); end if;
    update orders set status = 'new' where id = o.id returning * into o;
    return jsonb_build_object('result', 'confirmed', 'order', to_jsonb(o));
  end if;
  return jsonb_build_object('result', case when o.status = 'cancelled' then 'cancelled' when o.status in ('new', 'confirmed') then 'already' else 'in_progress' end, 'order', to_jsonb(o));
end $function$;

CREATE OR REPLACE FUNCTION public.customer_cancel(p_phone text, p_order text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o orders;
begin
  select * into o from orders where order_number = upper(p_order) and customer_phone = normalize_phone(p_phone) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status in ('draft', 'new', 'confirmed') then
    update orders set status = 'cancelled', cancel_reason = p_reason, cancelled_by = 'customer', cancelled_at = now() where id = o.id returning * into o;
    return jsonb_build_object('result', 'cancelled', 'order', to_jsonb(o));
  elsif o.status = 'cancelled' then return jsonb_build_object('result', 'already_cancelled', 'order', to_jsonb(o));
  elsif o.status = 'delivered' then return jsonb_build_object('result', 'delivered', 'order', to_jsonb(o));
  end if;
  update orders set cancel_requested_at = now(), cancel_reason = p_reason where id = o.id returning * into o;
  return jsonb_build_object('result', 'requested', 'order', to_jsonb(o));
end $function$;

CREATE OR REPLACE FUNCTION public.customer_amend(p_phone text, p_order text, p_items jsonb, p_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o orders;
begin
  select * into o from orders where order_number = upper(p_order) and customer_phone = normalize_phone(p_phone) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status = 'draft' then
    update orders set items = public.items_text(p_items), items_json = p_items, total = p_total where id = o.id returning * into o;
    return jsonb_build_object('result', 'updated_draft', 'order', to_jsonb(o));
  elsif o.status in ('new', 'confirmed') then
    update orders set original_items = coalesce(nullif(original_items, ''), items), items = public.items_text(p_items), items_json = p_items, total = p_total, amended_at = now(), amendment_count = coalesce(amendment_count, 0) + 1 where id = o.id returning * into o;
    return jsonb_build_object('result', 'amended', 'order', to_jsonb(o));
  end if;
  return jsonb_build_object('result', 'locked', 'order', to_jsonb(o));
end $function$;

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_carts_updated ON public.carts;
CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_chat_sessions_normalize_phone ON public.chat_sessions;
CREATE TRIGGER trg_chat_sessions_normalize_phone BEFORE INSERT OR UPDATE ON public.chat_sessions FOR EACH ROW EXECUTE FUNCTION public.normalize_generic_phone();
DROP TRIGGER IF EXISTS trg_chat_sessions_updated ON public.chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated BEFORE UPDATE ON public.chat_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_customers_normalize_phone ON public.customers;
CREATE TRIGGER trg_customers_normalize_phone BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_phone();
DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_memory_normalize_phone ON public.memory;
CREATE TRIGGER trg_memory_normalize_phone BEFORE INSERT OR UPDATE ON public.memory FOR EACH ROW EXECUTE FUNCTION public.normalize_generic_phone();
DROP TRIGGER IF EXISTS trg_memory_updated ON public.memory;
CREATE TRIGGER trg_memory_updated BEFORE UPDATE ON public.memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_menu_items_updated ON public.menu_items;
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_messages_normalize_phone ON public.messages;
CREATE TRIGGER trg_messages_normalize_phone BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.normalize_generic_phone();
DROP TRIGGER IF EXISTS trg_messages_touch_session ON public.messages;
CREATE TRIGGER trg_messages_touch_session AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.touch_chat_session();
DROP TRIGGER IF EXISTS trg_order_increment_customer ON public.orders;
CREATE TRIGGER trg_order_increment_customer AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.increment_customer_orders();
DROP TRIGGER IF EXISTS trg_orders_confirm_window ON public.orders;
CREATE TRIGGER trg_orders_confirm_window BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.stamp_confirm_window();
DROP TRIGGER IF EXISTS trg_orders_normalize_phone ON public.orders;
CREATE TRIGGER trg_orders_normalize_phone BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.normalize_order_phone();
DROP TRIGGER IF EXISTS trg_orders_set_number ON public.orders;
CREATE TRIGGER trg_orders_set_number BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_order_number();
DROP TRIGGER IF EXISTS trg_orders_stamp_cancel ON public.orders;
CREATE TRIGGER trg_orders_stamp_cancel BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.stamp_cancel();
DROP TRIGGER IF EXISTS trg_orders_updated ON public.orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_promotions_updated ON public.promotions;
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.abandoned_carts AS
SELECT c.*
FROM public.carts c
WHERE c.nudged_at IS NULL
  AND c.total > 0
  AND c.updated_at BETWEEN now() - interval '1 day' AND now() - interval '30 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_phone = c.phone AND o.created_at > c.updated_at
  )
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.phone = c.phone AND m.direction = 'inbound'
      AND m.created_at >= now() - interval '23 hours'
  );

CREATE OR REPLACE VIEW public.daily_sales AS
SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(*) AS orders,
       COALESCE(sum(total), 0) AS revenue,
       COALESCE(avg(total), 0) AS avg_order
FROM public.orders
WHERE status NOT IN ('draft', 'cancelled')
GROUP BY (created_at AT TIME ZONE 'Asia/Kolkata')::date;

CREATE OR REPLACE VIEW public.pending_ratings AS
SELECT o.*
FROM public.orders o
WHERE o.status = 'delivered'
  AND o.updated_at BETWEEN now() - interval '1 day' AND now() - interval '30 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews r WHERE r.order_number = o.order_number
  );

CREATE OR REPLACE VIEW public.top_items AS
SELECT trim(regexp_replace(part, '^\s*[0-9]+\s*x\s*', '')) AS item,
       count(*) AS occurrences
FROM public.orders o
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(o.items, ''), ',') AS part
WHERE o.status NOT IN ('draft', 'cancelled')
  AND trim(part) <> ''
GROUP BY trim(regexp_replace(part, '^\s*[0-9]+\s*x\s*', ''));

-- ============================================================

-- Application tables not present in the candidate base schema.
CREATE TABLE IF NOT EXISTS public.app_customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL, channel_user_id text NOT NULL,
 phone text, name text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel,channel_user_id)
);
CREATE TABLE IF NOT EXISTS public.ordering_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL DEFAULT 'whatsapp', channel_user_id text NOT NULL,
 customer_id uuid NOT NULL REFERENCES public.app_customers(id), token_hash text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired')),
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ordering_sessions_expires_idx ON public.ordering_sessions(expires_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS public.customer_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.app_customers(id) ON DELETE CASCADE,
 label text, address text NOT NULL, landmark text, pincode text, is_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON public.customer_addresses(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_idx ON public.customer_addresses(customer_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_number text NOT NULL UNIQUE,
 capacity integer NOT NULL DEFAULT 4 CHECK(capacity>0), qr_code_url text, is_active boolean NOT NULL DEFAULT false,
 current_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.table_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL REFERENCES public.restaurant_tables(id),
 customer_id uuid REFERENCES public.app_customers(id), order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 reservation_time timestamptz NOT NULL, end_time timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','seated','completed','cancelled')),
 party_size integer NOT NULL CHECK(party_size>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.riders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, whatsapp_number text NOT NULL,
 is_active boolean NOT NULL DEFAULT true, deliveries_count integer NOT NULL DEFAULT 0, declines_count integer NOT NULL DEFAULT 0,
 cash_collected numeric NOT NULL DEFAULT 0, pending_cash numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.menu_item_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
 name text NOT NULL, price numeric, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(menu_item_id,name)
);
CREATE TABLE IF NOT EXISTS public.ai_carts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_user_id text NOT NULL UNIQUE,
 items jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.restaurant_info (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), info_key text NOT NULL UNIQUE, info_value text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.settings_private (
 key text PRIMARY KEY, value text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.order_status_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
 order_number text NOT NULL, action text NOT NULL, from_status text, to_status text NOT NULL,
 actor_email text, actor_role text, detail text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dev_whatsapp_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- Add fields used by the current customer, AI, POS, tables, rider, and receipt flows.
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS vegetarian boolean;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'kitchen';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_role_check CHECK(role IN ('admin','counter','waiter','kitchen'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.app_customers(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_amount numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS party_size integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS printed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_id uuid REFERENCES public.riders(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_phone text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collected_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_collected boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_payment_status_check') THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK(payment_status IS NULL OR payment_status IN ('collected','unpaid','paid_later'));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.menu_item_variants(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_name text;
-- Query and foreign-key indexes used by menu, order, messaging and operations screens.
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_phone_created_idx ON public.orders(customer_phone,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON public.orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON public.orders(customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_idx ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_rider_id_idx ON public.orders(rider_id) WHERE rider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS messages_phone_created_idx ON public.messages(phone,created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_order_number_idx ON public.reviews(order_number);
CREATE INDEX IF NOT EXISTS table_reservations_table_time_idx ON public.table_reservations(table_id,reservation_time,end_time);
CREATE INDEX IF NOT EXISTS order_status_log_order_created_idx ON public.order_status_log(order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS menu_item_variants_menu_item_idx ON public.menu_item_variants(menu_item_id) WHERE is_active;

-- Keep old and current order total/address field names in sync.
CREATE OR REPLACE FUNCTION public.sync_order_compatibility_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.total_amount:=COALESCE(NEW.total_amount,NEW.total,0); NEW.total:=COALESCE(NEW.total,NEW.total_amount,0);
  NEW.delivery_address:=COALESCE(NEW.delivery_address,NEW.address); NEW.address:=COALESCE(NEW.address,NEW.delivery_address);
 ELSE
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount AND NEW.total IS NOT DISTINCT FROM OLD.total THEN NEW.total:=NEW.total_amount; ELSE NEW.total_amount:=NEW.total; END IF;
  IF NEW.delivery_address IS DISTINCT FROM OLD.delivery_address AND NEW.address IS NOT DISTINCT FROM OLD.address THEN NEW.address:=NEW.delivery_address; ELSE NEW.delivery_address:=NEW.address; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_sync_compatibility ON public.orders;
CREATE TRIGGER trg_orders_sync_compatibility BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.sync_order_compatibility_columns();

-- Staff authorization helpers used by server and authenticated dashboard clients.
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_members s WHERE lower(s.email)=lower(COALESCE(auth.jwt()->>'email','')) AND s.is_active)
$$;
CREATE OR REPLACE FUNCTION public.staff_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.role FROM public.staff_members s WHERE lower(s.email)=lower(COALESCE(auth.jwt()->>'email','')) AND s.is_active LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.staff_check() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('staff',public.is_staff(),'email',COALESCE(auth.jwt()->>'email',''),'role',public.staff_role())
$$;
CREATE OR REPLACE FUNCTION public.next_order_number(src text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE prefix text;
BEGIN prefix:=CASE lower(COALESCE(src,'whatsapp')) WHEN 'pwa' THEN 'RSO-P-' WHEN 'staff' THEN 'RSO-S-' WHEN 'pos' THEN 'RSO-S-' ELSE 'RSO-W-' END;
 RETURN prefix||nextval('public.order_number_seq')::text; END $$;

CREATE OR REPLACE FUNCTION public.consume_ordering_token(p_token_hash text) RETURNS SETOF public.ordering_sessions
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.ordering_sessions SET status='consumed',used_at=now() WHERE token_hash=p_token_hash AND status='pending' AND expires_at>now() RETURNING *
$$;
CREATE OR REPLACE FUNCTION public.create_customer_address(p_customer_id uuid,p_address text,p_landmark text,p_pincode text,p_label text,p_is_default boolean)
RETURNS public.customer_addresses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE want_default boolean; result public.customer_addresses;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));
 want_default:=COALESCE(p_is_default,false) OR NOT EXISTS(SELECT 1 FROM public.customer_addresses WHERE customer_id=p_customer_id);
 IF want_default THEN UPDATE public.customer_addresses SET is_default=false WHERE customer_id=p_customer_id AND is_default; END IF;
 INSERT INTO public.customer_addresses(customer_id,address,landmark,pincode,label,is_default) VALUES(p_customer_id,p_address,p_landmark,p_pincode,p_label,want_default) RETURNING * INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.update_customer_address(p_customer_id uuid,p_address_id uuid,p_address text,p_landmark text,p_pincode text,p_label text,p_is_default boolean)
RETURNS public.customer_addresses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.customer_addresses;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));
 IF NOT EXISTS(SELECT 1 FROM public.customer_addresses WHERE id=p_address_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'Address not found'; END IF;
 IF COALESCE(p_is_default,false) THEN UPDATE public.customer_addresses SET is_default=false WHERE customer_id=p_customer_id AND is_default; END IF;
 UPDATE public.customer_addresses SET address=COALESCE(p_address,address),landmark=p_landmark,pincode=p_pincode,label=p_label,is_default=COALESCE(p_is_default,is_default),updated_at=now()
 WHERE id=p_address_id AND customer_id=p_customer_id RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.delete_customer_address(p_customer_id uuid,p_address_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE was_default boolean; next_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));
 SELECT is_default INTO was_default FROM public.customer_addresses WHERE id=p_address_id AND customer_id=p_customer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Address not found'; END IF;
 DELETE FROM public.customer_addresses WHERE id=p_address_id AND customer_id=p_customer_id;
 IF was_default THEN SELECT id INTO next_id FROM public.customer_addresses WHERE customer_id=p_customer_id ORDER BY updated_at DESC LIMIT 1; IF next_id IS NOT NULL THEN UPDATE public.customer_addresses SET is_default=true WHERE id=next_id; END IF; END IF;
 RETURN true;
END $$;

-- POS order RPC; website orders are inserted by the server after live price checks.
CREATE OR REPLACE FUNCTION public.create_pos_order(p_customer_name text,p_customer_phone text,p_order_type text,p_table_number text,p_address text,p_landmark text,p_pincode text,p_total numeric,p_items_summary text,p_items_json jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; onum text; item jsonb;
BEGIN
 IF p_items_json IS NULL OR jsonb_typeof(p_items_json)<>'array' OR jsonb_array_length(p_items_json)=0 THEN RAISE EXCEPTION 'Cart cannot be empty'; END IF;
 onum:=public.next_order_number('pos');
 INSERT INTO public.orders(order_number,customer_phone,customer_name,items,total,total_amount,status,order_type,source,address,delivery_address,landmark,pincode,table_number,items_json)
 VALUES(onum,public.normalize_phone(p_customer_phone),p_customer_name,p_items_summary,p_total,p_total,'preparing',p_order_type,'pos',p_address,p_address,p_landmark,p_pincode,p_table_number,p_items_json) RETURNING id INTO oid;
 FOR item IN SELECT * FROM jsonb_array_elements(p_items_json) LOOP
  INSERT INTO public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,variant_name)
  VALUES(oid,NULLIF(item->>'menu_item_id','')::uuid,COALESCE(item->>'item_name','Item'),(item->>'quantity')::integer,(item->>'unit_price')::numeric,item->>'variant_name');
 END LOOP;
 RETURN jsonb_build_object('id',oid,'order_number',onum);
END $$;

-- AI bridge order RPC, using server-side current menu prices and an idempotency key.
CREATE OR REPLACE FUNCTION public.create_customer_order(p_customer_id uuid,p_order_type text,p_customer_name text,p_customer_phone text,p_delivery_address text,p_landmark text,p_pincode text,p_scheduled_time timestamptz,p_payment_method text,p_idempotency_key text,p_cart_items jsonb,p_table_id uuid,p_party_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE typ text; item jsonb; iid uuid; vid uuid; qty integer; nm text; pr numeric; subtotal numeric:=0; fee numeric:=0; total_due numeric; table_no text; summary text:=''; lines jsonb:='[]'::jsonb; line jsonb; ord public.orders; cfg text;
BEGIN
 IF p_idempotency_key IS NOT NULL THEN SELECT * INTO ord FROM public.orders WHERE idempotency_key=p_idempotency_key; IF FOUND THEN RETURN to_jsonb(ord); END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Customer not found'; END IF;
 typ:=CASE lower(p_order_type) WHEN 'pickup' THEN 'takeaway' WHEN 'takeaway' THEN 'takeaway' WHEN 'delivery' THEN 'delivery' WHEN 'dine-in' THEN 'dine-in' WHEN 'dinein' THEN 'dine-in' ELSE NULL END;
 IF typ IS NULL THEN RAISE EXCEPTION 'Invalid order type'; END IF;
 IF NOT public.is_open(now()) THEN RAISE EXCEPTION 'Orders are paused or the restaurant is closed'; END IF;
 IF p_cart_items IS NULL OR jsonb_typeof(p_cart_items)<>'array' OR jsonb_array_length(p_cart_items)=0 THEN RAISE EXCEPTION 'Cart cannot be empty'; END IF;
 IF typ='delivery' AND COALESCE(btrim(p_delivery_address),'')='' THEN RAISE EXCEPTION 'Delivery address required'; END IF;
 IF typ='dine-in' THEN SELECT table_number INTO table_no FROM public.restaurant_tables WHERE id=p_table_id AND NOT is_active AND current_order_id IS NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Table unavailable'; END IF; END IF;
 IF typ='delivery' AND p_pincode IS NOT NULL AND EXISTS(SELECT 1 FROM public.delivery_pincodes WHERE active) AND NOT EXISTS(SELECT 1 FROM public.delivery_pincodes WHERE active AND pincode=p_pincode) THEN RAISE EXCEPTION 'Pincode not serviceable'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_cart_items) LOOP
  iid:=COALESCE(NULLIF(item->>'menu_item_id',''),NULLIF(item->>'menuItemId',''))::uuid; vid:=COALESCE(NULLIF(item->>'variant_id',''),NULLIF(item->>'variantId',''))::uuid; qty:=(item->>'quantity')::integer;
  IF qty IS NULL OR qty<1 OR qty>20 THEN RAISE EXCEPTION 'Invalid item quantity'; END IF;
  SELECT item_name,price INTO nm,pr FROM public.menu_items WHERE id=iid AND available; IF NOT FOUND THEN RAISE EXCEPTION 'Menu item unavailable'; END IF;
  IF vid IS NOT NULL THEN SELECT COALESCE(NULLIF(price,0),pr),name INTO pr,nm FROM public.menu_item_variants WHERE id=vid AND menu_item_id=iid AND is_active; IF NOT FOUND THEN RAISE EXCEPTION 'Variant unavailable'; END IF; END IF;
  subtotal:=subtotal+pr*qty; line:=jsonb_build_object('menu_item_id',iid,'item_name',nm,'quantity',qty,'unit_price',pr,'variant_id',vid,'round',1); lines:=lines||jsonb_build_array(line); summary:=concat_ws(', ',NULLIF(summary,''),nm||' x '||qty);
 END LOOP;
 SELECT value INTO cfg FROM public.settings WHERE key='min_order'; IF subtotal<COALESCE(NULLIF(cfg,'')::numeric,0) THEN RAISE EXCEPTION 'Below minimum order'; END IF;
 IF typ='delivery' THEN SELECT value INTO cfg FROM public.settings WHERE key='delivery_fee'; fee:=COALESCE(NULLIF(cfg,'')::numeric,0); SELECT value INTO cfg FROM public.settings WHERE key='free_delivery_above'; IF COALESCE(NULLIF(cfg,'')::numeric,0)>0 AND subtotal>=cfg::numeric THEN fee:=0; END IF; END IF;
 total_due:=round(subtotal+fee,2);
 INSERT INTO public.orders(order_number,customer_id,customer_phone,customer_name,items,total,total_amount,status,order_type,source,address,delivery_address,landmark,pincode,table_number,scheduled_for,payment_method,delivery_fee,idempotency_key,party_size,items_json)
 VALUES(public.next_order_number('whatsapp'),p_customer_id,public.normalize_phone(p_customer_phone),p_customer_name,summary,total_due,total_due,'new',typ,'whatsapp',CASE WHEN typ='delivery' THEN p_delivery_address END,CASE WHEN typ='delivery' THEN p_delivery_address END,p_landmark,p_pincode,table_no,p_scheduled_time,p_payment_method,fee,p_idempotency_key,p_party_size,lines) RETURNING * INTO ord;
 INSERT INTO public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,variant_id) SELECT ord.id,(x->>'menu_item_id')::uuid,x->>'item_name',(x->>'quantity')::integer,(x->>'unit_price')::numeric,NULLIF(x->>'variant_id','')::uuid FROM jsonb_array_elements(lines) x;
 IF typ='dine-in' THEN UPDATE public.restaurant_tables SET is_active=true,current_order_id=ord.id WHERE table_number=table_no; END IF;
 RETURN to_jsonb(ord);
END $$;

-- Secure defaults and operational configuration; no invented restaurant data.
INSERT INTO public.settings(key,value) VALUES ('restaurant_name','Rasoi'),('tagline',''),('address',''),('phone',''),('city',''),('logo_url',''),('gst_percent','0'),('gstin',''),('open_time',''),('close_time',''),('hours',''),('orders_paused','true'),('order_types',''),('min_order','0'),('delivery_fee','0'),('free_delivery_above','0'),('delivery_note',''),('payment_methods',''),('auto_print','false') ON CONFLICT(key) DO NOTHING;

-- RLS: public catalog reads only, staff dashboard reads, admin menu writes, server-only mutations.
ALTER TABLE public.app_customers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ordering_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_reservations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ai_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_info ENABLE ROW LEVEL SECURITY; ALTER TABLE public.settings_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_log ENABLE ROW LEVEL SECURITY; ALTER TABLE public.dev_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY; ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY; ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory ENABLE ROW LEVEL SECURITY; ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_pincodes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blast_log ENABLE ROW LEVEL SECURITY; ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.menu_items,public.delivery_pincodes,public.promotions,public.settings,public.restaurant_tables TO anon;
GRANT SELECT ON public.menu_items,public.customers,public.orders,public.order_items,public.messages,public.chat_sessions,public.memory,public.promotions,public.delivery_pincodes,public.settings,public.reviews,public.carts,public.blast_log,public.staff_members,public.restaurant_tables,public.riders,public.order_status_log TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_items TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE ALL ON public.app_customers,public.ordering_sessions,public.customer_addresses,public.ai_carts,public.settings_private,public.dev_whatsapp_messages FROM anon,authenticated;
REVOKE ALL ON public.customers,public.orders,public.order_items,public.messages,public.chat_sessions,public.memory,public.reviews,public.carts,public.blast_log,public.riders,public.order_status_log,public.table_reservations,public.menu_item_variants FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.orders,public.order_items,public.customers,public.messages,public.chat_sessions,public.settings,public.delivery_pincodes,public.staff_members,public.restaurant_tables,public.riders FROM anon,authenticated;
CREATE POLICY rasoi_menu_anon_read ON public.menu_items FOR SELECT TO anon USING(available);
CREATE POLICY rasoi_pincodes_anon_read ON public.delivery_pincodes FOR SELECT TO anon USING(active);
CREATE POLICY rasoi_promotions_anon_read ON public.promotions FOR SELECT TO anon USING(active);
CREATE POLICY rasoi_settings_anon_read ON public.settings FOR SELECT TO anon USING(true);
CREATE POLICY rasoi_tables_anon_read ON public.restaurant_tables FOR SELECT TO anon USING(NOT is_active);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customers','orders','order_items','messages','chat_sessions','memory','promotions','delivery_pincodes','settings','reviews','carts','blast_log','staff_members','restaurant_tables','riders','order_status_log'] LOOP
  EXECUTE format('CREATE POLICY rasoi_%s_staff_read ON public.%I FOR SELECT TO authenticated USING(public.is_staff())',t,t);
 END LOOP;
END $$;
CREATE POLICY rasoi_menu_staff_read ON public.menu_items FOR SELECT TO authenticated USING(public.is_staff());
CREATE POLICY rasoi_menu_admin_write ON public.menu_items FOR ALL TO authenticated USING(public.staff_role()='admin') WITH CHECK(public.staff_role()='admin');
CREATE POLICY rasoi_private_settings_service ON public.settings_private FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_app_customers_service ON public.app_customers FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_sessions_service ON public.ordering_sessions FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_addresses_service ON public.customer_addresses FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_ai_carts_service ON public.ai_carts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_variants_service ON public.menu_item_variants FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_reservations_service ON public.table_reservations FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_dev_messages_service ON public.dev_whatsapp_messages FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY rasoi_restaurant_info_service ON public.restaurant_info FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE EXECUTE ON FUNCTION public.consume_ordering_token(text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.create_customer_address(uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.update_customer_address(uuid,uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_customer_address(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.create_pos_order(text,text,text,text,text,text,text,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.create_customer_order(uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ordering_token(text),public.create_customer_address(uuid,text,text,text,text,boolean),public.update_customer_address(uuid,uuid,text,text,text,text,boolean),public.delete_customer_address(uuid,uuid),public.create_pos_order(text,text,text,text,text,text,text,numeric,text,jsonb),public.create_customer_order(uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb,uuid,integer),public.next_order_number(text),public.normalize_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_check(),public.staff_role(),public.is_staff() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_open(timestamptz) TO anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.customer_confirm(text,text),public.customer_cancel(text,text,text),public.customer_amend(text,text,jsonb,numeric),public.chat_context(text,text),public.order_context(),public.save_cart(text,jsonb,numeric),public.next_order_number(text),public.normalize_phone(text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_check(),public.staff_role(),public.is_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_confirm(text,text),public.customer_cancel(text,text,text),public.customer_amend(text,text,jsonb,numeric),public.chat_context(text,text),public.order_context(),public.save_cart(text,jsonb,numeric),public.next_order_number(text),public.normalize_phone(text) TO service_role;
REVOKE ALL ON public.abandoned_carts,public.daily_sales,public.pending_ratings,public.top_items FROM PUBLIC,anon,authenticated;
INSERT INTO storage.buckets(id,name,public) VALUES('menu_images','menu_images',true) ON CONFLICT(id) DO NOTHING;
CREATE POLICY rasoi_menu_images_public_read ON storage.objects FOR SELECT TO public USING(bucket_id='menu_images');
CREATE POLICY rasoi_menu_images_staff_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='menu_images' AND public.is_staff());
CREATE POLICY rasoi_menu_images_admin_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='menu_images' AND public.staff_role()='admin') WITH CHECK(bucket_id='menu_images' AND public.staff_role()='admin');
CREATE POLICY rasoi_menu_images_admin_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='menu_images' AND public.staff_role()='admin');
COMMIT;
