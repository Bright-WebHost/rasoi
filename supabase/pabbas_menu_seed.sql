-- PABBAS menu seed for the separate Pabbas Supabase project.
-- Source: lib/menu-data.ts
-- No database operations are performed by creating this file.

INSERT INTO public.menu_items (
  item_number,
  item_name,
  category,
  price,
  available,
  description,
  image_url,
  variants
)
VALUES
  (1, 'Golden Gadbad', 'Gold Series Sundaes', 260, true, 'Layers of fruit, vanilla, nuts and Pabbas'' signature sauces.', 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=900&q=85', '{"options":[{"label":"Topping","values":["Classic","Extra nuts"]}]}'::jsonb),
  (2, 'Dubai Chocolate', 'Gold Series Sundaes', 280, true, 'Silky chocolate ice cream, pistachio crunch and golden drizzle.', 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=85', NULL),
  (3, 'Iranian Pistachio Sundae', 'Gold Series Sundaes', 275, true, 'Creamy pistachio, roasted nuts and a delicate rose finish.', 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?auto=format&fit=crop&w=900&q=85', NULL),
  (4, 'Biscoff Sundae', 'Special Ice Cream', 230, true, 'Caramel biscuit crumble with vanilla and warm cookie sauce.', 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=85', '{"options":[{"label":"Size","values":["Regular","Large"]}]}'::jsonb),
  (5, 'Special Gadbad', 'Special Ice Cream', 190, true, 'A cheerful Pabbas classic with three flavours, fruit and jelly.', 'https://images.unsplash.com/photo-1560008581-09826d1de69e?auto=format&fit=crop&w=900&q=85', NULL),
  (6, 'Royal Falooda', 'Special Ice Cream', 210, true, 'Rose milk, basil seeds, vermicelli and a scoop of ice cream.', '/falooda.jpg', NULL),
  (7, 'Vanilla Cone', 'Konero In Cones', 55, true, 'A crisp cone with smooth, timeless vanilla.', '/vanillacone.png', NULL),
  (8, 'Chocolate Cone', 'Konero In Cones', 65, true, 'Chocolate ice cream in a freshly baked cone.', 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=900&q=85', NULL),
  (9, 'Kaju Malai Cone', 'Konero In Cones', 75, true, 'Rich cashew creaminess with a nutty finish.', 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=900&q=85', NULL),
  (10, 'Classic Choco Shake', 'Milk Shake', 155, true, 'Thick, cold and unapologetically chocolatey.', 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=900&q=85', NULL),
  (11, 'Mango Shake', 'Milk Shake', 165, true, 'Seasonal mango blended into a creamy, sunny sip.', 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=85', NULL),
  (12, 'Fresh Lime Soda', 'Juice', 85, true, 'Bright, fizzy and made to order.', 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=900&q=85', NULL),
  (13, 'Watermelon Juice', 'Juice', 110, true, 'Chilled, refreshing and naturally sweet.', 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&w=900&q=85', NULL),
  (14, 'Choco Lava Cake', 'Sweets', 145, true, 'Warm chocolate cake with a molten centre.', 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85', NULL),
  (15, 'Hot Carrot Halwa', 'Sweets', 130, true, 'Comforting carrot halwa with nuts and a warm aroma.', 'https://images.unsplash.com/photo-1589119908995-c6837fa14848?auto=format&fit=crop&w=900&q=85', NULL),
  (16, 'Pabbas Veg Sandwich', 'Sandwiches', 120, true, 'Toasted bread, fresh vegetables and a creamy spread.', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=85', NULL),
  (17, 'Classic Cheese Pizza', 'Pizzas', 240, true, 'A crisp base, tomato sauce and a generous cheese pull.', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85', NULL),
  (18, 'Masala Fries', 'Short Eats', 105, true, 'Golden fries tossed with a bright house masala.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85', NULL),
  (19, 'Chocolate Premium Cup', 'Premium Ice Cream Cups', 95, true, 'A neat little cup of deep chocolate indulgence.', 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=900&q=85', NULL),
  (20, 'Classic Family Pack', '1 Litre Family Pack', 390, true, 'A litre of crowd-pleasing vanilla for sharing.', 'https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?auto=format&fit=crop&w=900&q=85', NULL);
