-- Verified Oceana production function definitions
-- Source: copied directly from the Oceana Supabase SQL Editor.
-- Reference only. Do NOT execute this file against Oceana production.

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


CREATE OR REPLACE FUNCTION public.order_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION public.staff_check()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('staff', public.is_staff(), 'email', coalesce(auth.jwt() ->> 'email', ''))
$function$;
