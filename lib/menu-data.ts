import { MenuItem } from "./types";

// Rasoi's catalog is loaded from Supabase. Keep local fallbacks empty so a
// copied source demo menu can never appear as Rasoi inventory.
export const categories = ["All"];
export const menuItems: MenuItem[] = [];
export const featuredItems: MenuItem[] = [];

export const displayCategory = (category: string) => category;
