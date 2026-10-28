-- ============================================================
-- PABBAS — Phase 4: Production Menu Schema & Seed Data
-- Creates menu_categories, menu_items, menu_item_variants tables.
-- Prices are strictly stored in integer PAISE (1 INR = 100 paise).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.menu_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES public.menu_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  image text DEFAULT '',
  vegetarian boolean NOT NULL DEFAULT true,
  badge text DEFAULT NULL,
  featured boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.menu_item_variants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON public.menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_is_active ON public.menu_items(is_active);
CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item_id ON public.menu_item_variants(menu_item_id);

-- ============================================================
-- ROW LEVEL SECURITY & PERMISSIONS
-- ============================================================

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY;

-- Allow public reading of active menu items and categories
CREATE POLICY "Allow read menu_categories" ON public.menu_categories FOR SELECT USING (true);
CREATE POLICY "Allow read active menu_items" ON public.menu_items FOR SELECT USING (is_active = true);
CREATE POLICY "Allow read active menu_item_variants" ON public.menu_item_variants FOR SELECT USING (is_active = true);

-- Restrict mutation to service_role
REVOKE ALL ON public.menu_categories FROM anon, authenticated;
REVOKE ALL ON public.menu_items FROM anon, authenticated;
REVOKE ALL ON public.menu_item_variants FROM anon, authenticated;

GRANT SELECT ON public.menu_categories TO anon, authenticated;
GRANT SELECT ON public.menu_items TO anon, authenticated;
GRANT SELECT ON public.menu_item_variants TO anon, authenticated;

GRANT ALL ON public.menu_categories TO service_role;
GRANT ALL ON public.menu_items TO service_role;
GRANT ALL ON public.menu_item_variants TO service_role;

-- ============================================================
-- SEED VERIFIED PABBAS MENU DATA
-- ============================================================

DO $$
DECLARE
  v_cat_sundaes uuid;
  v_cat_specials uuid;
  v_cat_cones uuid;
  v_cat_shakes uuid;
  v_cat_juices uuid;
  v_cat_sweets uuid;
  v_cat_snacks uuid;
  v_cat_cups uuid;
  v_cat_packs uuid;
BEGIN
  -- Insert Categories
  INSERT INTO public.menu_categories (name, display_order)
  VALUES 
    ('Gold Series Sundaes', 10),
    ('Special Ice Cream', 20),
    ('Konero In Cones', 30),
    ('Milk Shake', 40),
    ('Juice', 50),
    ('Sweets', 60),
    ('Snacks', 70),
    ('Premium Ice Cream Cups', 80),
    ('1 Litre Family Pack', 90)
  ON CONFLICT (name) DO UPDATE SET display_order = EXCLUDED.display_order;

  SELECT id INTO v_cat_sundaes FROM public.menu_categories WHERE name = 'Gold Series Sundaes';
  SELECT id INTO v_cat_specials FROM public.menu_categories WHERE name = 'Special Ice Cream';
  SELECT id INTO v_cat_cones FROM public.menu_categories WHERE name = 'Konero In Cones';
  SELECT id INTO v_cat_shakes FROM public.menu_categories WHERE name = 'Milk Shake';
  SELECT id INTO v_cat_juices FROM public.menu_categories WHERE name = 'Juice';
  SELECT id INTO v_cat_sweets FROM public.menu_categories WHERE name = 'Sweets';
  SELECT id INTO v_cat_snacks FROM public.menu_categories WHERE name = 'Snacks';
  SELECT id INTO v_cat_cups FROM public.menu_categories WHERE name = 'Premium Ice Cream Cups';
  SELECT id INTO v_cat_packs FROM public.menu_categories WHERE name = '1 Litre Family Pack';

  -- Seed Gold Series Sundaes
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_sundaes, 'Golden Gadbad', 'Layers of fruit, vanilla, nuts and Pabbas signature sauces.', 26000, 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=900&q=85', true, 'Pabbas Special', true, 1),
  (v_cat_sundaes, 'Dubai Chocolate', 'Silky chocolate ice cream, pistachio crunch and golden drizzle.', 28000, 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=85', true, 'Bestseller', true, 2),
  (v_cat_sundaes, 'Iranian Pistachio Sundae', 'Creamy pistachio, roasted nuts and a delicate rose finish.', 27500, 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?auto=format&fit=crop&w=900&q=85', true, NULL, true, 3);

  -- Seed Special Ice Cream
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_specials, 'Biscoff Sundae', 'Caramel biscuit crumble with vanilla and warm cookie sauce.', 23000, 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=85', true, 'Popular', true, 1),
  (v_cat_specials, 'Special Gadbad', 'A cheerful Pabbas classic with three flavours, fruit and jelly.', 19000, 'https://images.unsplash.com/photo-1560008581-09826d1de69e?auto=format&fit=crop&w=900&q=85', true, 'Classic', true, 2),
  (v_cat_specials, 'Royal Falooda', 'Rose milk, basil seeds, vermicelli and a scoop of ice cream.', 21000, '/falooda.jpg', true, NULL, false, 3);

  -- Seed Konero In Cones
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_cones, 'Vanilla Cone', 'A crisp cone with smooth, timeless vanilla.', 5500, '/vanillacone.png', true, NULL, false, 1),
  (v_cat_cones, 'Chocolate Cone', 'Chocolate ice cream in a freshly baked cone.', 6500, 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=900&q=85', true, NULL, false, 2),
  (v_cat_cones, 'Kaju Malai Cone', 'Rich cashew creaminess with a nutty finish.', 7500, 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=900&q=85', true, NULL, false, 3);

  -- Seed Milk Shake
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_shakes, 'Classic Choco Shake', 'Thick, cold and unapologetically chocolatey.', 15500, 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=900&q=85', true, 'Bestseller', false, 1),
  (v_cat_shakes, 'Mango Shake', 'Seasonal mango blended into a creamy, sunny sip.', 16500, 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=85', true, NULL, false, 2);

  -- Seed Juice
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_juices, 'Fresh Lime Soda', 'Bright, fizzy and made to order.', 8500, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=900&q=85', true, NULL, false, 1),
  (v_cat_juices, 'Watermelon Juice', 'Chilled, refreshing and naturally sweet.', 11000, 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&w=900&q=85', true, NULL, false, 2);

  -- Seed Sweets
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_sweets, 'Choco Lava Cake', 'Warm chocolate cake with a molten centre.', 14500, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85', true, 'Warm favourite', false, 1),
  (v_cat_sweets, 'Hot Carrot Halwa', 'Comforting carrot halwa with nuts and a warm aroma.', 13000, 'https://images.unsplash.com/photo-1589119908995-c6837fa14848?auto=format&fit=crop&w=900&q=85', true, NULL, false, 2);

  -- Seed Snacks
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_snacks, 'Pabbas Veg Sandwich', 'Toasted bread, fresh vegetables and a creamy spread.', 12000, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=85', true, NULL, false, 1),
  (v_cat_snacks, 'Classic Cheese Pizza', 'A crisp base, tomato sauce and a generous cheese pull.', 24000, 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85', true, NULL, false, 2),
  (v_cat_snacks, 'Masala Fries', 'Golden fries tossed with a bright house masala.', 10500, 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85', true, NULL, false, 3);

  -- Seed Premium Ice Cream Cups & Family Pack
  INSERT INTO public.menu_items (category_id, name, description, price_paise, image, vegetarian, badge, featured, display_order) VALUES
  (v_cat_cups, 'Chocolate Premium Cup', 'A neat little cup of deep chocolate indulgence.', 9500, 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=900&q=85', true, NULL, false, 1),
  (v_cat_packs, 'Classic Family Pack', 'A litre of crowd-pleasing vanilla for sharing.', 39000, 'https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?auto=format&fit=crop&w=900&q=85', true, 'Perfect for sharing', false, 1);
END $$;
