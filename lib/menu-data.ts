import { MenuItem } from "./types";

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`;

export const categories = ["All", "Sundaes", "Scoops", "Cones", "Shakes", "Juices", "Cups", "Specials", "Sweets", "Snacks"];

export const menuItems: MenuItem[] = [
  { id: "golden-gadbad", name: "Golden Gadbad", category: "Gold Series Sundaes", description: "Layers of fruit, vanilla, nuts and Pabbas' signature sauces.", price: 260, image: image("photo-1579954115545-a95591f28bfc"), vegetarian: true, badge: "Pabbas Special", featured: true, options: [{ label: "Topping", values: ["Classic", "Extra nuts"] }] },
  { id: "dubai-chocolate", name: "Dubai Chocolate", category: "Gold Series Sundaes", description: "Silky chocolate ice cream, pistachio crunch and golden drizzle.", price: 280, image: image("photo-1551024601-bec78aea704b"), vegetarian: true, badge: "Bestseller", featured: true },
  { id: "iranian-pistachio", name: "Iranian Pistachio Sundae", category: "Gold Series Sundaes", description: "Creamy pistachio, roasted nuts and a delicate rose finish.", price: 275, image: image("photo-1497034825429-c343d7c6a68f"), vegetarian: true, featured: true },
  { id: "biscoff-sundae", name: "Biscoff Sundae", category: "Special Ice Cream", description: "Caramel biscuit crumble with vanilla and warm cookie sauce.", price: 230, image: image("photo-1551024601-bec78aea704b"), vegetarian: true, badge: "Popular", featured: true, options: [{ label: "Size", values: ["Regular", "Large"] }] },
  { id: "special-gadbad", name: "Special Gadbad", category: "Special Ice Cream", description: "A cheerful Pabbas classic with three flavours, fruit and jelly.", price: 190, image: image("photo-1560008581-09826d1de69e"), vegetarian: true, badge: "Classic", featured: true },
  { id: "royal-falooda", name: "Royal Falooda", category: "Special Ice Cream", description: "Rose milk, basil seeds, vermicelli and a scoop of ice cream.", price: 210, image: "/falooda.jpg", vegetarian: true },
  { id: "vanilla-cone", name: "Vanilla Cone", category: "Konero In Cones", description: "A crisp cone with smooth, timeless vanilla.", price: 55, image: "/vanillacone.png", vegetarian: true },
  { id: "chocolate-cone", name: "Chocolate Cone", category: "Konero In Cones", description: "Chocolate ice cream in a freshly baked cone.", price: 65, image: image("photo-1570197788417-0e82375c9371"), vegetarian: true },
  { id: "kaju-malai-cone", name: "Kaju Malai Cone", category: "Konero In Cones", description: "Rich cashew creaminess with a nutty finish.", price: 75, image: image("photo-1570197788417-0e82375c9371"), vegetarian: true },
  { id: "choco-shake", name: "Classic Choco Shake", category: "Milk Shake", description: "Thick, cold and unapologetically chocolatey.", price: 155, image: image("photo-1572490122747-3968b75cc699"), vegetarian: true, badge: "Bestseller" },
  { id: "mango-shake", name: "Mango Shake", category: "Milk Shake", description: "Seasonal mango blended into a creamy, sunny sip.", price: 165, image: image("photo-1546173159-315724a31696"), vegetarian: true },
  { id: "fresh-lime", name: "Fresh Lime Soda", category: "Juice", description: "Bright, fizzy and made to order.", price: 85, image: image("photo-1513558161293-cdaf765ed2fd"), vegetarian: true },
  { id: "watermelon-juice", name: "Watermelon Juice", category: "Juice", description: "Chilled, refreshing and naturally sweet.", price: 110, image: image("photo-1587049352846-4a222e784d38"), vegetarian: true },
  { id: "choco-lava", name: "Choco Lava Cake", category: "Sweets", description: "Warm chocolate cake with a molten centre.", price: 145, image: image("photo-1606313564200-e75d5e30476c"), vegetarian: true, badge: "Warm favourite" },
  { id: "carrot-halwa", name: "Hot Carrot Halwa", category: "Sweets", description: "Comforting carrot halwa with nuts and a warm aroma.", price: 130, image: image("photo-1589119908995-c6837fa14848"), vegetarian: true },
  { id: "veg-sandwich", name: "Pabbas Veg Sandwich", category: "Sandwiches", description: "Toasted bread, fresh vegetables and a creamy spread.", price: 120, image: image("photo-1528735602780-2552fd46c7af"), vegetarian: true },
  { id: "cheese-pizza", name: "Classic Cheese Pizza", category: "Pizzas", description: "A crisp base, tomato sauce and a generous cheese pull.", price: 240, image: image("photo-1574071318508-1cdbab80d002"), vegetarian: true },
  { id: "masala-fries", name: "Masala Fries", category: "Short Eats", description: "Golden fries tossed with a bright house masala.", price: 105, image: image("photo-1573080496219-bb080dd4f877"), vegetarian: true },
  { id: "chocolate-cup", name: "Chocolate Premium Cup", category: "Premium Ice Cream Cups", description: "A neat little cup of deep chocolate indulgence.", price: 95, image: image("photo-1563805042-7684c019e1cb"), vegetarian: true },
  { id: "family-pack", name: "Classic Family Pack", category: "1 Litre Family Pack", description: "A litre of crowd-pleasing vanilla for sharing.", price: 390, image: image("photo-1567206563064-6f60f40a2b57"), vegetarian: true, badge: "Perfect for sharing" },
];

export const featuredItems = menuItems.filter((item) => item.featured);

export const displayCategory = (category: string) => {
  const map: Record<string, string> = { "Gold Series Sundaes": "Sundaes", "Special Ice Cream": "Specials", "Konero In Cones": "Cones", "Milk Shake": "Shakes", Juice: "Juices", "Premium Ice Cream Cups": "Cups", Sandwiches: "Snacks", "Short Eats": "Snacks", Pizzas: "Snacks", "1 Litre Family Pack": "Cups" };
  return map[category] ?? category;
};
