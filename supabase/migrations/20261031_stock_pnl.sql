-- Stock, recipe costing, P&L and rider cash ledger (Oceana dashboard parity).
-- Staff read everything; admin and counter staff (Oceana's "manager") write.

alter table menu_items
  add column if not exists track_stock boolean not null default false,
  add column if not exists stock_qty numeric not null default 0,
  add column if not exists low_stock_threshold numeric,
  add column if not exists par_level numeric,
  add column if not exists stock_updated_at timestamptz,
  add column if not exists stock_updated_by text;

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  unit text not null default 'kg' check (unit in ('kg','g','l','ml','pcs')),
  stock_qty numeric not null default 0,
  low_stock_threshold numeric,
  par_level numeric,
  cost_per_unit numeric,
  nearest_expiry date,
  track_stock boolean not null default true,
  active boolean not null default true,
  image_url text,
  stock_updated_at timestamptz,
  stock_updated_by text,
  created_at timestamptz not null default now()
);

create table if not exists recipe_lines (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  qty_per_item numeric not null check (qty_per_item > 0),
  unique (menu_item_id, ingredient_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('menu_item','ingredient')),
  entity_id uuid not null,
  entity_name text,
  reason text not null,
  qty_change numeric not null,
  balance_after numeric,
  unit text,
  supplier_name text,
  cost_per_unit numeric,
  total_cost numeric,
  expiry_date date,
  note text,
  order_id uuid,
  staff text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_entity_idx on stock_movements (entity_type, entity_id, created_at desc);
create index if not exists stock_movements_created_idx on stock_movements (created_at desc);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  amount numeric not null check (amount > 0),
  note text,
  recorded_by text,
  created_at timestamptz not null default now()
);

create table if not exists rider_payments (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references riders(id) on delete set null,
  rider_name text not null,
  amount numeric not null check (amount > 0),
  note text,
  received_by text,
  created_at timestamptz not null default now()
);
alter table rider_payments add column if not exists rider_name text;
update rider_payments p set rider_name = coalesce(r.name, 'Former rider')
  from riders r where p.rider_id = r.id and p.rider_name is null;
update rider_payments set rider_name = 'Former rider' where rider_name is null;
alter table rider_payments alter column rider_name set not null;
alter table rider_payments alter column rider_id drop not null;
alter table rider_payments drop constraint if exists rider_payments_rider_id_fkey;
alter table rider_payments add constraint rider_payments_rider_id_fkey
  foreign key (rider_id) references riders(id) on delete set null;
create index if not exists rider_payments_rider_created_idx on rider_payments (rider_id, created_at desc);

grant select on ingredients, recipe_lines, stock_movements, expenses, rider_payments to authenticated;
grant insert, update, delete on recipe_lines to authenticated;
grant all on ingredients, recipe_lines, stock_movements, expenses, rider_payments to service_role;

do $$
declare t text;
begin
  foreach t in array array['ingredients','recipe_lines','stock_movements','expenses','rider_payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Staff can read %1$s" on %1$I', t);
    if t = 'expenses' then
      execute format('create policy "Staff can read %1$s" on %1$I for select to authenticated using (staff_role() = ''admin'')', t);
    else
      execute format('create policy "Staff can read %1$s" on %1$I for select to authenticated using (staff_role() in (''admin'',''counter''))', t);
    end if;
    execute format('drop policy if exists "Managers can write %1$s" on %1$I', t);
  end loop;
end $$;

-- Recipe definitions may be edited by stock managers in the Menu screen.
-- Counts, movements, expenses and cash handovers are written by server actions.
drop policy if exists "Managers can write recipes" on recipe_lines;
create policy "Managers can write recipes" on recipe_lines for all to authenticated
  using (staff_role() in ('admin','counter')) with check (staff_role() in ('admin','counter'));

-- Stock writes go through the service-role server action and its audited RPC.
-- Do not grant counter staff row-wide UPDATE access to menu_items: that would
-- also let them change prices and availability.
drop policy if exists "Managers can update menu stock" on menu_items;
-- The compatible schema had a broader all-staff menu write policy. Menu writes
-- now go through permission-checked server actions, and stock through the RPC.
drop policy if exists "p_menu_items_staff_all" on menu_items;
drop policy if exists "Staff can read menu items" on menu_items;
create policy "Staff can read menu items" on menu_items for select to authenticated using (is_staff());

create or replace function apply_stock_change(
  p_entity_type text,
  p_entity_id uuid,
  p_stock_qty numeric,
  p_reason text,
  p_qty_change numeric,
  p_staff text,
  p_supplier_name text default null,
  p_cost_per_unit numeric default null,
  p_total_cost numeric default null,
  p_expiry_date date default null,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_unit text;
  v_previous_qty numeric;
  v_actual_delta numeric;
  v_target_qty numeric;
  v_par_level numeric;
begin
  if p_entity_type not in ('menu_item','ingredient')
     or p_reason not in ('manual_adjust','restock','waste','top_up_par','stock_take')
     or p_stock_qty < 0
     or p_qty_change is null then
    raise exception 'Invalid stock change';
  end if;
  if p_reason = 'restock' and p_qty_change <= 0 then raise exception 'Restock quantity must be positive'; end if;
  if p_reason = 'waste' and p_qty_change >= 0 then raise exception 'Waste quantity must be negative'; end if;

  if p_entity_type = 'menu_item' then
    select item_name, 'pcs', coalesce(stock_qty, 0), par_level into v_name, v_unit, v_previous_qty, v_par_level
    from menu_items where id = p_entity_id for update;
    if not found then raise exception 'Menu item not found'; end if;
  else
    select name, unit, coalesce(stock_qty, 0), par_level into v_name, v_unit, v_previous_qty, v_par_level
    from ingredients where id = p_entity_id for update;
    if not found then raise exception 'Ingredient not found'; end if;
  end if;

  if p_reason in ('restock','waste') then
    v_target_qty := v_previous_qty + p_qty_change;
    if p_reason = 'waste' and v_target_qty < 0 then raise exception 'Waste quantity exceeds current stock'; end if;
  elsif p_reason = 'top_up_par' then
    if v_par_level is null then raise exception 'Set a par level before topping up'; end if;
    v_target_qty := v_par_level;
  else
    v_target_qty := p_stock_qty;
  end if;
  if v_target_qty < 0 then raise exception 'Stock count cannot be negative'; end if;

  if p_entity_type = 'menu_item' then
    update menu_items
       set stock_qty = v_target_qty, stock_updated_at = now(), stock_updated_by = p_staff
     where id = p_entity_id;
  else
    update ingredients
       set stock_qty = v_target_qty,
           stock_updated_at = now(),
           stock_updated_by = p_staff,
           cost_per_unit = case when p_reason = 'restock' then coalesce(p_cost_per_unit, cost_per_unit) else cost_per_unit end,
           nearest_expiry = coalesce(p_expiry_date, nearest_expiry)
     where id = p_entity_id;
  end if;
  v_actual_delta := v_target_qty - v_previous_qty;

  insert into stock_movements (
    entity_type, entity_id, entity_name, reason, qty_change, balance_after,
    unit, supplier_name, cost_per_unit, total_cost, expiry_date, note, staff
  ) values (
    p_entity_type, p_entity_id, v_name, p_reason, v_actual_delta, v_target_qty,
    v_unit, p_supplier_name, p_cost_per_unit, p_total_cost, p_expiry_date, p_note, p_staff
  );
  return v_target_qty;
end;
$$;
revoke all on function apply_stock_change(text, uuid, numeric, text, numeric, text, text, numeric, numeric, date, text) from public, anon, authenticated;
grant execute on function apply_stock_change(text, uuid, numeric, text, numeric, text, text, numeric, numeric, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- Automatic stock deduction from orders.items_json.
-- New order -> sale; cancelled -> restore; restored -> sale again; items edited
-- or a round appended -> only the difference moves.
-- ---------------------------------------------------------------------------
create or replace function stock_qty_map(items jsonb)
returns table (menu_item_id uuid, qty numeric)
language sql immutable as $$
  select (i->>'menu_item_id')::uuid, sum(coalesce((i->>'quantity')::numeric, 0))
  from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) i
  where (i->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by 1
$$;

create or replace function stock_apply_delta(p_menu_item uuid, p_qty numeric, p_reason text, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record; l record; nb numeric; applied numeric;
begin
  if p_qty = 0 then return; end if;
  select id, item_name, track_stock, stock_qty into m from menu_items where id = p_menu_item for update;
  if not found then return; end if;
  if m.track_stock then
    nb := greatest(0, coalesce(m.stock_qty, 0) - p_qty);
    applied := nb - coalesce(m.stock_qty, 0);
    update menu_items set stock_qty = nb, stock_updated_at = now(), stock_updated_by = 'order' where id = m.id;
    if applied <> 0 then
      insert into stock_movements (entity_type, entity_id, entity_name, reason, qty_change, balance_after, unit, order_id, staff)
      values ('menu_item', m.id, m.item_name, p_reason, applied, nb, 'pcs', p_order, 'system');
    end if;
  end if;
  for l in select r.qty_per_item, i.id, i.name, i.unit, i.stock_qty from recipe_lines r join ingredients i on i.id = r.ingredient_id
           where r.menu_item_id = p_menu_item and i.track_stock order by i.id for update of i loop
    nb := greatest(0, coalesce(l.stock_qty, 0) - p_qty * l.qty_per_item);
    applied := nb - coalesce(l.stock_qty, 0);
    update ingredients set stock_qty = nb, stock_updated_at = now(), stock_updated_by = 'order' where id = l.id;
    if applied <> 0 then
      insert into stock_movements (entity_type, entity_id, entity_name, reason, qty_change, balance_after, unit, order_id, staff)
      values ('ingredient', l.id, l.name, p_reason, applied, nb, l.unit, p_order, 'system');
    end if;
  end loop;
end $$;
revoke all on function stock_apply_delta(uuid, numeric, text, uuid) from public, anon, authenticated;

create or replace function orders_stock_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; was_live boolean; is_live boolean;
begin
  is_live := coalesce(new.status, '') not in ('cancelled', 'draft');
  if tg_op = 'INSERT' then
    if is_live then
      for r in select * from stock_qty_map(new.items_json) order by menu_item_id loop
        perform stock_apply_delta(r.menu_item_id, r.qty, 'sale', new.id);
      end loop;
    end if;
    return new;
  end if;

  was_live := coalesce(old.status, '') not in ('cancelled', 'draft');
  if was_live and not is_live then
    for r in select * from stock_qty_map(old.items_json) order by menu_item_id loop
      perform stock_apply_delta(r.menu_item_id, -r.qty, 'cancel_restore', new.id);
    end loop;
  elsif not was_live and is_live then
    for r in select * from stock_qty_map(new.items_json) order by menu_item_id loop
      perform stock_apply_delta(r.menu_item_id, r.qty, 'sale', new.id);
    end loop;
  elsif is_live and new.items_json is distinct from old.items_json then
    for r in
      select coalesce(n.menu_item_id, o.menu_item_id) as menu_item_id, coalesce(n.qty, 0) - coalesce(o.qty, 0) as qty
      from stock_qty_map(new.items_json) n full join stock_qty_map(old.items_json) o on o.menu_item_id = n.menu_item_id
      order by coalesce(n.menu_item_id, o.menu_item_id)
    loop
      if r.qty > 0 then perform stock_apply_delta(r.menu_item_id, r.qty, 'sale', new.id);
      elsif r.qty < 0 then perform stock_apply_delta(r.menu_item_id, r.qty, 'cancel_restore', new.id);
      end if;
    end loop;
  end if;
  return new;
exception when others then
  -- Stock tracking must never block an order from being saved.
  raise warning 'orders_stock_sync failed for order %: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function orders_stock_sync() from public, anon, authenticated;

drop trigger if exists orders_stock_sync on orders;
create trigger orders_stock_sync after insert or update of status, items_json on orders
for each row execute function orders_stock_sync();

-- Record a rider handover, update its delivered orders and refresh the rider
-- balance in one transaction so the cash ledger cannot drift from the totals.
create or replace function collect_rider_cash_atomic(
  p_rider_id uuid,
  p_amount numeric,
  p_note text,
  p_received_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider record;
  v_order record;
  v_due numeric;
  v_total_due numeric := 0;
  v_budget numeric := coalesce(p_amount, 0);
  v_collected numeric := 0;
  v_new_amount numeric;
  v_remaining numeric;
begin
  if p_amount is not null and p_amount <= 0 then raise exception 'Enter a positive collection amount'; end if;
  select id, name, coalesce(cash_collected, 0) as cash_collected into v_rider
    from riders where id = p_rider_id for update;
  if not found then raise exception 'Rider not found'; end if;

  for v_order in
    select id, total, is_collected, collected_amount
      from orders
     where rider_id = p_rider_id
       and order_type = 'delivery'
       and status = 'delivered'
       and coalesce(payment_status, '') not in ('unpaid', 'paid_later')
     order by created_at asc, id asc
     for update
  loop
    if v_order.is_collected and coalesce(v_order.collected_amount, 0) = 0 then
      v_due := 0;
    else
      v_due := greatest(0, coalesce(v_order.total, 0) - coalesce(v_order.collected_amount, 0));
    end if;
    v_total_due := v_total_due + v_due;
    if v_due <= 0 then continue; end if;

    if p_amount is null then
      v_new_amount := coalesce(v_order.collected_amount, 0) + v_due;
    else
      v_new_amount := coalesce(v_order.collected_amount, 0) + least(v_budget, v_due);
      v_budget := v_budget - least(v_budget, v_due);
    end if;
    v_collected := v_collected + (v_new_amount - coalesce(v_order.collected_amount, 0));
    update orders
       set collected_amount = v_new_amount,
           is_collected = (v_new_amount >= coalesce(v_order.total, 0)),
           updated_at = now()
     where id = v_order.id;
  end loop;

  v_remaining := greatest(0, v_total_due - v_collected);
  if v_collected > 0 then
    update riders
       set cash_collected = coalesce(cash_collected, 0) + v_collected,
           pending_cash = v_remaining
     where id = p_rider_id;
    insert into rider_payments (rider_id, rider_name, amount, note, received_by)
      values (p_rider_id, v_rider.name, v_collected, nullif(btrim(p_note), ''), nullif(btrim(p_received_by), ''));
  else
    update riders set pending_cash = v_remaining where id = p_rider_id;
  end if;

  return jsonb_build_object('success', true, 'collected_amount', v_collected, 'remaining_owed', v_remaining);
end;
$$;
revoke all on function collect_rider_cash_atomic(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function collect_rider_cash_atomic(uuid, numeric, text, text) to service_role;
