-- PABBAS — Oceana-compatible database foundation
--
-- TARGET: NEW, SEPARATE Pabbas Supabase project only.
-- STATUS: DESIGN MIGRATION. NOT APPLIED.
--
-- This migration reproduces the verified Oceana-shaped structure and behavior
-- without copying Oceana data, Auth users, secrets, provider IDs, or credentials.
-- It intentionally does not preserve the older UUID/price_paise Pabbas schema.
--
-- Pabbas-specific decisions:
--   * order numbers use PBN- as the prefix (not Oceana's OCN-).
--   * prices use numeric rupees, matching the verified Oceana contract.
--   * customer identity is normalized phone, not app_customers UUID.
--   * no production or demo seed data is included.
--
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    WHEN 'pwa' THEN 'PBN-P-'
    WHEN 'staff' THEN 'PBN-S-'
    ELSE 'PBN-W-'
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
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  select (p_at at time zone 'Asia/Kolkata')::time >= coalesce((select value from settings where key = 'open_time'), '07:00')::time
     and (p_at at time zone 'Asia/Kolkata')::time < coalesce((select value from settings where key = 'close_time'), '23:30')::time
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
  select jsonb_build_object('is_open', public.is_open(), 'hours', coalesce((select value from settings where key = 'hours'), '7:00 AM to 11:30 PM'),
    'min_order', coalesce((select value from settings where key = 'min_order'), '200'), 'city', coalesce((select value from settings where key = 'city'), 'Mangalore'),
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
-- RLS AND POLICIES
-- ============================================================

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_pincodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blast_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.menu_items, public.delivery_pincodes, public.promotions, public.settings TO anon;
GRANT ALL ON public.menu_items, public.customers, public.orders, public.order_items, public.messages, public.chat_sessions, public.memory, public.promotions, public.delivery_pincodes, public.settings, public.reviews, public.carts, public.blast_log TO authenticated;
GRANT SELECT ON public.staff_members TO authenticated;
GRANT ALL ON public.menu_items, public.customers, public.orders, public.order_items, public.messages, public.chat_sessions, public.memory, public.promotions, public.delivery_pincodes, public.settings, public.reviews, public.carts, public.blast_log, public.staff_members TO service_role;

CREATE POLICY p_menu_items_anon_read ON public.menu_items FOR SELECT TO anon USING (available = true);
CREATE POLICY p_pincodes_anon_read ON public.delivery_pincodes FOR SELECT TO anon USING (active = true);
CREATE POLICY p_promotions_anon_read ON public.promotions FOR SELECT TO anon USING (active = true);
CREATE POLICY p_settings_anon_read ON public.settings FOR SELECT TO anon USING (true);

CREATE POLICY p_blast_log_service_all ON public.blast_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_carts_service_all ON public.carts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_chat_sessions_service_all ON public.chat_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_customers_service_all ON public.customers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_delivery_pincodes_service_all ON public.delivery_pincodes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_memory_service_all ON public.memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_menu_items_service_all ON public.menu_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_messages_service_all ON public.messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_order_items_service_all ON public.order_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_orders_service_all ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_promotions_service_all ON public.promotions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_reviews_service_all ON public.reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_settings_service_all ON public.settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY p_staff_members_service_all ON public.staff_members FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY p_menu_items_staff_all ON public.menu_items FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_customers_staff_all ON public.customers FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_orders_staff_all ON public.orders FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_order_items_staff_all ON public.order_items FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_messages_staff_all ON public.messages FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_chat_sessions_staff_all ON public.chat_sessions FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_memory_staff_all ON public.memory FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_promotions_staff_all ON public.promotions FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_pincodes_staff_all ON public.delivery_pincodes FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_settings_staff_all ON public.settings FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_reviews_staff_all ON public.reviews FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_carts_staff_all ON public.carts FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_blast_log_staff_all ON public.blast_log FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY p_staff_members_staff_select ON public.staff_members FOR SELECT TO authenticated USING (public.is_staff());

REVOKE ALL ON public.customers, public.orders, public.order_items, public.messages, public.chat_sessions, public.memory, public.reviews, public.carts, public.blast_log FROM anon;
REVOKE ALL ON public.abandoned_carts, public.daily_sales, public.pending_ratings, public.top_items FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.customer_confirm(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_cancel(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_amend(text, text, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_context(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_context() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_cart(text, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_cancel(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_amend(text, text, jsonb, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_context(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.order_context() TO service_role;
GRANT EXECUTE ON FUNCTION public.save_cart(text, jsonb, numeric) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_open(timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_check() TO authenticated, service_role;
