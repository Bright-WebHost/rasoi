export type StaffRole = "admin" | "counter" | "waiter" | "kitchen";

export type FeaturePermission =
  | "view_orders_full"
  | "view_orders_basic"
  | "kitchen_screen"
  | "accept_delivery"
  | "mark_ready"
  | "assign_rider"
  | "handover"
  | "mark_delivered"
  | "cancel_order"
  | "collect_cash"
  | "pos"
  | "tables"
  | "view_riders"
  | "manage_riders"
  | "manage_menu"
  | "chat"
  | "contacts"
  | "blast"
  | "analytics"
  | "reopen_cancelled"
  | "settings";

export type PageRoute =
  | "/dashboard/orders"
  | "/dashboard/pos"
  | "/dashboard/tables"
  | "/dashboard/kitchen"
  | "/dashboard/riders"
  | "/dashboard/menu"
  | "/dashboard/chat"
  | "/dashboard/contacts"
  | "/dashboard/blast"
  | "/dashboard/stats"
  | "/dashboard/settings";

export const ROLE_PERMISSIONS: Record<StaffRole, FeaturePermission[]> = {
  admin: [
    "view_orders_full", "view_orders_basic", "kitchen_screen", "accept_delivery",
    "mark_ready", "assign_rider", "handover", "mark_delivered", "cancel_order",
    "collect_cash", "pos", "tables", "view_riders", "manage_riders", "manage_menu",
    "chat", "contacts", "blast", "analytics", "reopen_cancelled", "settings"
  ],
  counter: [
    "view_orders_full", "accept_delivery", "mark_ready", "assign_rider",
    "handover", "mark_delivered", "cancel_order", "collect_cash", "pos",
    "tables", "view_riders"
  ],
  waiter: [
    "pos", "tables"
  ],
  kitchen: [
    "kitchen_screen", "mark_ready"
  ]
};

export const ROLE_PAGES: Record<StaffRole, PageRoute[]> = {
  admin: [
    "/dashboard/orders", "/dashboard/pos", "/dashboard/tables", "/dashboard/kitchen",
    "/dashboard/riders", "/dashboard/menu", "/dashboard/chat", "/dashboard/contacts",
    "/dashboard/blast", "/dashboard/stats", "/dashboard/settings"
  ],
  counter: [
    "/dashboard/orders", "/dashboard/pos", "/dashboard/tables", "/dashboard/kitchen"
  ],
  waiter: [
    "/dashboard/pos", "/dashboard/tables"
  ],
  kitchen: [
    "/dashboard/kitchen"
  ]
};

export function hasPermission(role: StaffRole, permission: FeaturePermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessPage(role: StaffRole, page: PageRoute): boolean {
  return ROLE_PAGES[role]?.includes(page) ?? false;
}

export const NAV_ITEMS = [
  { href: "/dashboard/orders", label: "Orders", permission: "view_orders_basic" as FeaturePermission, icon: "ClipboardList" },
  { href: "/dashboard/kitchen", label: "Kitchen", permission: "kitchen_screen" as FeaturePermission, icon: "ChefHat" },
  { href: "/dashboard/pos", label: "POS", permission: "pos" as FeaturePermission, icon: "MonitorSmartphone" },
  { href: "/dashboard/tables", label: "Tables", permission: "tables" as FeaturePermission, icon: "UtensilsCrossed" },
  { href: "/dashboard/riders", label: "Riders", permission: "view_riders" as FeaturePermission, icon: "Bike" },
  { href: "/dashboard/menu", label: "Menu", permission: "manage_menu" as FeaturePermission, icon: "Menu" },
  { href: "/dashboard/chat", label: "Chat", permission: "chat" as FeaturePermission, icon: "MessageSquare" },
  { href: "/dashboard/contacts", label: "Contacts", permission: "contacts" as FeaturePermission, icon: "Users" },
  { href: "/dashboard/blast", label: "Blast", permission: "blast" as FeaturePermission, icon: "Megaphone" },
  { href: "/dashboard/stats", label: "Analytics", permission: "analytics" as FeaturePermission, icon: "BarChart3" },
  { href: "/dashboard/settings", label: "Settings", permission: "settings" as FeaturePermission, icon: "Settings" },
];
