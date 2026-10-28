"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, Plus, Minus, Trash2, ShoppingBag, CheckCircle, XCircle, ArrowLeft, ListOrdered, X } from "lucide-react";
import { createPosOrder, updatePosOrder } from "./actions";
import { useOrderManager } from "../../OrderManagerProvider";
import { fetchTables, RestaurantTable } from "../tables/actions";
import { printOrderBill } from "@/lib/print/bill";

type VariantOption = {
  label: string;
  values: string[];
};

type MenuItem = {
  id: string;
  item_number: number | null;
  item_name: string;
  category: string;
  price: number;
  available: boolean;
  description: string;
  image_url: string;
  variants: { options: VariantOption[] } | null;
};

type CartItem = {
  cartId: string; // Unique ID for cart row (item + variant)
  menu_item_id: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  variant_name: string | null;
};

const CATEGORY_COLORS = [
  { match: ["ice cream", "cone", "family pack"], bg: "bg-[#F0F6FF]", border: "border-[#D6E4F9]", accent: "bg-[#3B82F6]", hover: "hover:border-[#3B82F6]/40" },
  { match: ["sundae"], bg: "bg-[#E6F9F8]", border: "border-[#C5EFEA]", accent: "bg-[#14B8A6]", hover: "hover:border-[#14B8A6]/40" },
  { match: ["juice"], bg: "bg-[#F0FDF4]", border: "border-[#BBF7D0]", accent: "bg-[#22C55E]", hover: "hover:border-[#22C55E]/40" },
  { match: ["milk shake", "milkshake"], bg: "bg-[#FEF1F2]", border: "border-[#FEE2E2]", accent: "bg-[#F43F5E]", hover: "hover:border-[#F43F5E]/40" },
  { match: ["crepe"], bg: "bg-[#FFFbeb]", border: "border-[#FEF3C7]", accent: "bg-[#F59E0B]", hover: "hover:border-[#F59E0B]/40" },
  { match: ["cocktail"], bg: "bg-[#F5F3FF]", border: "border-[#EDE9FE]", accent: "bg-[#8B5CF6]", hover: "hover:border-[#8B5CF6]/40" },
];

const DEFAULT_COLOR = { bg: "bg-[#F8FAFB]", border: "border-[#EAF0F6]", accent: "bg-[#8799AF]", hover: "hover:border-[#C9D4E0]" };

function getCategoryColor(category: string) {
  if (!category || category === "All") return DEFAULT_COLOR;
  const normalized = category.toLowerCase().trim();
  for (const group of CATEGORY_COLORS) {
    if (group.match.some(m => normalized.includes(m))) {
      return group;
    }
  }
  return DEFAULT_COLOR;
}

// Global cache for POS data to speed up navigation
let cachedMenuItems: MenuItem[] | null = null;
let cachedTables: RestaurantTable[] | null = null;
let posDataPromise: Promise<any> | null = null;

export default function PosBoard() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>(cachedMenuItems || []);
  const [loading, setLoading] = useState(!cachedMenuItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [orderType, setOrderType] = useState<"takeaway" | "delivery" | "dine-in">("takeaway");

  // Customer Details State
  const [customerName, setCustomerName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  // Opened from a table card ("Start order"): always dine-in for that table, no type choice.
  const [lockedTable, setLockedTable] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLandmark, setDeliveryLandmark] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");

  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Variant Modal State
  const [variantModalItem, setVariantModalItem] = useState<MenuItem | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});

  // Review & Submit State
  const [showReview, setShowReview] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [orderResult, setOrderResult] = useState<{ success: boolean; order_number?: string; error?: string } | null>(null);

  const [showMobileCart, setShowMobileCart] = useState(false);

  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [appendOrderId, setAppendOrderId] = useState<string | null>(null);
  const [showActiveOrders, setShowActiveOrders] = useState(false);
  const { orders, autoPrint } = useOrderManager();

  const activePosOrders = useMemo(() => {
    return orders.filter(o => o.source === "pos" && o.status !== "delivered" && o.status !== "cancelled");
  }, [orders]);

  const supabase = createClient();

  useEffect(() => {
    async function init() {
      // Check for edit or append mode
      const params = new URLSearchParams(window.location.search);
      const editId = params.get("edit");
      const appendId = params.get("append");
      const activeId = editId || appendId;
      const tableParam = params.get("table");
      if (tableParam && !editId) {
        setOrderType("dine-in");
        setTableNumber(tableParam);
        setLockedTable(tableParam);
      }

      if (!cachedMenuItems || !cachedTables) {
        setLoading(true);
        if (!posDataPromise) {
          posDataPromise = Promise.all([
            supabase.from("menu_items").select("*").order("category").order("item_number"),
            fetchTables()
          ]);
        }
        
        const [menuRes, tablesRes] = await posDataPromise;
        
        if (menuRes.data) {
          cachedMenuItems = menuRes.data as MenuItem[];
          setMenuItems(cachedMenuItems);
        }
        if (tablesRes.success && tablesRes.tables) {
          cachedTables = tablesRes.tables;
          setRestaurantTables(tablesRes.tables);
        }
      }

      if (activeId) {
        if (editId) setEditOrderId(editId);
        if (appendId) setAppendOrderId(appendId);

        const { data } = await supabase
          .from("orders")
          .select("*")
          .eq("id", activeId)
          .single();
        
        const orderData = data as any;
        if (orderData) {
          setOrderType(orderData.order_type as any);
          setCustomerName(orderData.customer_name || "");
          setWhatsappNumber(orderData.customer_phone || "");
          setTableNumber(orderData.table_number || "");
          setDeliveryAddress(orderData.address || "");
          setDeliveryLandmark(orderData.landmark || "");
          setDeliveryPincode(orderData.pincode || "");
          
          if (editId && orderData.items_json && Array.isArray(orderData.items_json)) {
            setCart(orderData.items_json.map((item: any) => ({
              cartId: `${item.menu_item_id}-${item.variant_name || 'default'}`,
              menu_item_id: item.menu_item_id,
              item_name: item.item_name,
              unit_price: item.unit_price,
              quantity: item.quantity,
              variant_name: item.variant_name || null
            })));
          }
        }
      }
      setLoading(false);
    }
    init();
  }, [supabase]);

  const categories = useMemo(() => {
    const cats = new Set(menuItems.map((item) => item.category));
    return ["All", ...Array.from(cats)];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    let filtered = menuItems;
    if (selectedCategory !== "All") {
      filtered = filtered.filter((i) => i.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.item_name.toLowerCase().includes(q) ||
          (i.item_number && i.item_number.toString().includes(q))
      );
    }
    return filtered;
  }, [menuItems, selectedCategory, searchQuery]);

  const addToCart = (item: MenuItem, variantName: string | null = null, variantPrice: number | null = null) => {
    if (!item.available) return;

    const cartId = variantName ? `${item.id}-${variantName}` : item.id;
    const priceToUse = variantPrice ?? item.price;
    const finalItemName = variantName ? `${item.item_name} (${variantName})` : item.item_name;

    setCart((prev) => {
      const existing = prev.find((c) => c.cartId === cartId);
      if (existing) {
        return prev.map((c) =>
          c.cartId === cartId ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          cartId,
          menu_item_id: item.id,
          item_name: finalItemName,
          unit_price: priceToUse,
          quantity: 1,
          variant_name: variantName,
        },
      ];
    });
  };

  const handleProductClick = (item: MenuItem) => {
    if (!item.available) return;
    
    if (item.variants && item.variants.options && item.variants.options.length > 0) {
      // Initialize default selections to the first value of each option
      const initialSelections: Record<string, string> = {};
      item.variants.options.forEach((opt) => {
        if (opt.values.length > 0) {
          initialSelections[opt.label] = opt.values[0];
        }
      });
      setSelectedVariants(initialSelections);
      setVariantModalItem(item);
    } else {
      addToCart(item);
    }
  };

  const updateQuantity = (cartId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.cartId === cartId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  }, [cart]);

  const handleReviewOrder = () => {
    setShowReview(true);
  };

  const handleConfirmOrder = () => {
    if (orderType === "dine-in" && !tableNumber.trim()) {
      setOrderResult({ success: false, error: "Please select a table for a dine-in order." });
      return;
    }
    startTransition(async () => {
      if (appendOrderId) {
        try {
          const res = await fetch("/api/orders/append", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: appendOrderId,
              table_number: tableNumber,
              new_items: cart.map(c => ({
                menu_item_id: c.menu_item_id,
                item_name: c.item_name,
                quantity: c.quantity,
                unit_price: c.unit_price,
                variant_name: c.variant_name
              }))
            })
          });
          const result = await res.json();
          if (result.success) {
            setOrderResult({ success: true, order_number: "Round Added" });
            setCart([]);
            setTimeout(() => {
              if (typeof window !== "undefined") window.location.href = "/dashboard/tables";
            }, 1500);
          } else {
            setOrderResult({ success: false, error: result.error });
          }
        } catch (error) {
          setOrderResult({ success: false, error: "Failed to add round." });
        }
        return;
      }

      const itemsSummary = cart.map((c) => `${c.item_name} x ${c.quantity}`).join(', ');
      
      const payload = {
        customer_name: customerName.trim() || "Walk-in",
        customer_phone: whatsappNumber.trim(),
        order_type: orderType,
        table_number: orderType === "dine-in" ? tableNumber.trim() : "",
        address: orderType === "delivery" ? deliveryAddress.trim() : "",
        landmark: orderType === "delivery" ? deliveryLandmark.trim() : "",
        pincode: orderType === "delivery" ? deliveryPincode.trim() : "",
        total: cartTotal,
        items_summary: itemsSummary,
        items_json: cart.map(c => ({
          menu_item_id: c.menu_item_id,
          item_name: c.item_name,
          quantity: c.quantity,
          unit_price: c.unit_price,
          variant_name: c.variant_name || null
        }))
      };

      if (editOrderId) {
        const result = await updatePosOrder(editOrderId, payload);
        if (result.success) {
          setOrderResult({ success: true, order_number: "Updated Successfully" });
        } else {
          setOrderResult({ success: false, error: result.error });
        }
      } else {
        const result = await createPosOrder(payload);
        if (result.success) {
          setOrderResult({ success: true, order_number: result.order?.order_number });
          if (autoPrint && result.order?.id) {
            printOrderBill(result.order.id, { auto: true }).catch(console.error);
          }
          if (lockedTable) {
            setTimeout(() => { window.location.href = "/dashboard/tables"; }, 1500);
          }
        } else {
          setOrderResult({ success: false, error: result.error });
        }
      }
    });
  };

  const startNewOrder = () => {
    if (editOrderId) {
      window.location.href = "/dashboard/pos";
      return;
    }
    setCart([]);
    setCustomerName("");
    setWhatsappNumber("");
    setTableNumber(lockedTable ?? "");
    setDeliveryAddress("");
    setDeliveryLandmark("");
    setDeliveryPincode("");
    setOrderResult(null);
    setShowReview(false);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-[600px] w-full overflow-hidden bg-white shadow-sm border border-[#EAF0F6] lg:rounded-2xl lg:m-4 lg:w-[calc(100%-32px)] lg:h-[calc(100vh-120px)]">
      
      {/* LEFT: Menu Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F8FAFB]">
        {/* Header / Search */}
        <div className="px-6 py-5 border-b border-[#EAF0F6] bg-white flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-[24px] font-black tracking-tight text-[#0A1017] leading-none mb-1.5">Point of Sale</h1>
              <p className="text-[13px] font-bold text-[#8799AF]">Walk-in order management</p>
            </div>
            <button 
              onClick={() => setShowActiveOrders(prev => !prev)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#EAF3FF] text-[#1A5FA8] hover:bg-[#DCE9FA] font-extrabold text-[12px] border border-[#B8D5F6] transition-colors shadow-sm"
            >
              <ListOrdered className="h-4 w-4" />
              Active Orders ({activePosOrders.length})
            </button>
          </div>
          <div className="relative w-full sm:w-[320px] shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-[#A1B2C6]" />
            <input
              type="text"
              placeholder="Search items by name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-[12px] border border-[#EAF0F6] bg-white text-[14px] font-bold text-[#0A1017] shadow-[0_2px_8px_rgba(0,0,0,0.02)] focus:border-[#0D6EFD] focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
            />
          </div>
        </div>

        {/* Category Filter */}
        <div className="px-6 py-4 flex gap-2.5 overflow-x-auto scrollbar-hide border-b border-[#EAF0F6] bg-white/50 backdrop-blur-sm shadow-[inset_0_-1px_0_rgba(0,0,0,0.02)]">
          {categories.map((cat) => {
            const catColors = getCategoryColor(cat);
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-[13px] font-extrabold transition-all border flex items-center gap-2 ${
                  selectedCategory === cat
                    ? "bg-[#0A1017] text-white border-[#0A1017] shadow-[0_4px_12px_rgba(10,16,23,0.15)] transform scale-[1.02]"
                    : "bg-white text-[#6B7A90] border-[#EAF0F6] hover:border-[#C9D4E0] hover:text-[#0A1017] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                }`}
              >
                {cat !== "All" && (
                  <span className={`w-2 h-2 rounded-full ${catColors.accent}`} />
                )}
                {cat}
              </button>
            );
          })}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-[140px] bg-white rounded-[20px] border border-[#EAF0F6] animate-pulse" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#8799AF]">
              <Search className="h-10 w-10 mb-4 opacity-20" />
              <p className="font-extrabold text-[15px] text-[#0A1017]">No items found</p>
              <p className="font-bold text-[13px] mt-1">Try a different search term</p>
            </div>
          ) : (
            <>
              {!searchQuery && selectedCategory === "All" && filteredItems.length > 0 && (
                <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-[#FEF1F2] text-[#E23744] p-1.5 rounded-lg"><CheckCircle className="w-4 h-4" /></span>
                <h2 className="text-[16px] font-black tracking-tight text-[#0A1017]">Quick Add (Trending 🔥)</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {menuItems.filter(i => i.available).slice(0, 5).map((item) => {
                  const colors = getCategoryColor(item.category);
                  return (
                    <button
                      key={`trending-${item.id}`}
                      onClick={() => handleProductClick(item)}
                      className={`group flex items-center gap-3 text-left rounded-[16px] border p-3 transition-all duration-300 ${colors.bg} ${colors.border} ${colors.hover} hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] cursor-pointer`}
                    >
                      {item.image_url && (
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-white shrink-0 shadow-sm border border-white/50">
                          <img src={item.image_url} alt={item.item_name} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13px] font-black text-[#0A1017] leading-tight line-clamp-2">{item.item_name}</span>
                        <span className="text-[12px] font-bold text-[#E23744] mt-0.5">₹{item.price}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 pb-32 lg:pb-20">
              {filteredItems.map((item) => {
                const colors = getCategoryColor(item.category);
                return (
                  <button
                    key={item.id}
                    disabled={!item.available}
                    onClick={() => handleProductClick(item)}
                    className={`group relative flex flex-col text-left rounded-[20px] border p-5 transition-all duration-300 h-full ${
                      item.available 
                        ? `${colors.bg} ${colors.border} ${colors.hover} hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-1 cursor-pointer` 
                        : "border-[#EAF0F6] bg-[#F8FAFB] opacity-60 cursor-not-allowed grayscale"
                    }`}
                  >
                  <div className="mb-3 flex justify-between items-start gap-2 w-full">
                    <span className="inline-flex items-center justify-center rounded-[8px] bg-[#F3F6F9] px-2.5 py-1 text-[11px] font-black tracking-wide text-[#6B7A90] group-hover:bg-white transition-colors border border-[#EAF0F6] group-hover:border-[#EAF0F6]">
                      {item.item_number ? `#${item.item_number}` : "—"}
                    </span>
                    {item.variants && item.variants.options && item.variants.options.length > 0 && (
                      <span className="text-[10px] font-black text-[#0D6EFD] bg-[#EAF3FF] px-2.5 py-1 rounded-full uppercase tracking-wider">
                        Options
                      </span>
                    )}
                  </div>
                  {item.image_url ? (
                    <div className="w-full aspect-video rounded-xl overflow-hidden mb-3 bg-[#EAF0F6] shrink-0 border border-[#EAF0F6]">
                      <img src={item.image_url} alt={item.item_name} className="w-full h-full object-cover" />
                    </div>
                  ) : null}
                  <h3 className="text-[15px] font-black text-[#0A1017] leading-[1.3] mb-2 line-clamp-2">
                    {item.item_name}
                  </h3>
                  <div className="mt-auto pt-3 flex items-center justify-between w-full border-t border-dashed border-[#EAF0F6]">
                    <span className="text-[16px] font-black text-[#E23744]">
                      ₹{item.price}
                    </span>
                    {!item.available && (
                      <span className="text-[10px] font-black text-[#C0392B] bg-[#FDE8E8] px-2 py-1 rounded-md uppercase tracking-widest">
                        Out
                      </span>
                    )}
                  </div>
                </button>
              )})}
            </div>
            </>
          )}
        </div>
        
        {/* Mobile Sticky Cart Bar */}
        {cart.length > 0 && !showMobileCart && (
          <div className="lg:hidden fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-[#EAF0F6] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] z-40">
            <button 
              onClick={() => setShowMobileCart(true)}
              className="w-full flex items-center justify-between bg-[#E23744] text-white p-4 rounded-[16px] shadow-[0_4px_16px_rgba(226,55,68,0.25)] hover:bg-[#C0392B] transition-colors"
            >
              <div className="flex flex-col items-start text-left">
                <span className="text-[12px] font-bold uppercase tracking-widest opacity-80">{cart.reduce((sum, c) => sum + c.quantity, 0)} Items</span>
                <span className="text-[18px] font-black leading-none mt-1">₹{cartTotal}</span>
              </div>
              <div className="flex items-center gap-2 text-[15px] font-black tracking-wide">
                View Order <ShoppingBag className="w-5 h-5" />
              </div>
            </button>
          </div>
        )}
      </div>

      {/* RIGHT: Cart Area */}
      <div className={`${showMobileCart ? 'fixed inset-0 z-[100] flex' : 'hidden'} lg:relative lg:flex lg:w-[380px] w-full bg-white lg:border-l border-[#EAF0F6] flex-col shrink-0 lg:z-10 shadow-[0_0_40px_rgba(0,0,0,0.03)] overflow-hidden`}>
        <div className="p-5 border-b border-[#EAF0F6] bg-white flex flex-col gap-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-black tracking-tight text-[#0A1017] flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#FDE8E8] flex items-center justify-center">
                <ShoppingBag className="h-4 w-4 text-[#E23744]" />
              </div>
              Current Order
            </h2>
            <div className="flex items-center gap-3">
              <span className="bg-[#EAF0F6] text-[#0A1017] text-[12px] font-extrabold px-3 py-1 rounded-full">
                {cart.reduce((sum, c) => sum + c.quantity, 0)} items
              </span>
              <button 
                className="lg:hidden p-1.5 rounded-lg bg-[#F8FAFB] text-[#8799AF] hover:text-[#0A1017] hover:bg-[#EAF0F6] transition-colors border border-[#EAF0F6]"
                onClick={() => setShowMobileCart(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {lockedTable || (appendOrderId && orderType === "dine-in") ? (
            <div className="flex items-center justify-between gap-2 rounded-[14px] border border-[#C6ECD6] bg-[#E5F5EC] px-4 py-2.5">
              <span className="text-[14px] font-extrabold text-[#146C43]">🍽️ Dine-in · Table {tableNumber || lockedTable}</span>
              <a href="/dashboard/tables" className="text-[12px] font-bold text-[#146C43] underline">Change table</a>
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-1.5 bg-[#F8FAFB] p-1.5 rounded-[14px] border border-[#EAF0F6]">
            {([
              { id: "takeaway", label: "Takeaway" },
              { id: "delivery", label: "Delivery" },
              { id: "dine-in", label: "Dine-in" },
            ] as const).map((type) => (
              <button
                key={type.id}
                onClick={() => setOrderType(type.id)}
                className={`py-2 text-[13px] font-extrabold rounded-[10px] transition-all ${
                  orderType === type.id
                    ? "bg-white text-[#0A1017] shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-[#EAF0F6]"
                    : "text-[#8799AF] hover:text-[#0A1017] hover:bg-white/50 border border-transparent"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-[#F8FAFB]">
          <div className="p-5 space-y-3">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-[#8799AF] opacity-80">
                <div className="w-16 h-16 bg-[#EAF0F6] rounded-full flex items-center justify-center mb-4">
                  <ShoppingBag className="h-7 w-7 text-[#A1B2C6]" />
                </div>
                <p className="font-extrabold text-[15px] text-[#0A1017]">Your cart is empty</p>
                <p className="text-[13px] font-semibold mt-1">Select items to begin</p>
              </div>
            ) : (
              cart.map((c) => (
                <div key={c.cartId} className="flex flex-col gap-3 p-4 rounded-[16px] bg-white border border-[#EAF0F6] shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all hover:border-[#C9D4E0]">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex flex-col flex-1">
                      <span className="text-[14px] font-black text-[#0A1017] leading-[1.3]">{c.item_name}</span>
                      <span className="text-[12px] font-extrabold text-[#8799AF] mt-0.5">₹{c.unit_price} each</span>
                    </div>
                    <span className="text-[15px] font-black text-[#0A1017]">₹{c.unit_price * c.quantity}</span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1 pt-3 border-t border-dashed border-[#EAF0F6]">
                    <div className="flex items-center bg-[#F8FAFB] rounded-[10px] border border-[#EAF0F6] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <button 
                        onClick={() => updateQuantity(c.cartId, -1)}
                        className="w-9 h-9 flex items-center justify-center text-[#8799AF] hover:text-[#E23744] hover:bg-[#FDE8E8] transition-colors"
                      >
                        {c.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-4 w-4" />}
                      </button>
                      <div className="w-10 h-9 flex items-center justify-center text-[14px] font-black text-[#0A1017] bg-white border-x border-[#EAF0F6]">
                        {c.quantity}
                      </div>
                      <button 
                        onClick={() => updateQuantity(c.cartId, 1)}
                        className="w-9 h-9 flex items-center justify-center text-[#8799AF] hover:text-[#0D5424] hover:bg-[#E6F4EA] transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Customer Details Form */}
        <div className="p-5 border-t border-[#EAF0F6] bg-white flex flex-col gap-4 shrink-0 shadow-[0_-4px_24px_rgba(0,0,0,0.02)] z-10">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[12px] font-black tracking-widest text-[#8799AF] uppercase">Customer Info</h3>
            <div className="flex-1 h-px bg-[#EAF0F6]"></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">
                {orderType === "takeaway" || orderType === "dine-in" ? "Name (Opt)" : "Name"}
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in"
                className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
              />
            </div>
            <div>
              <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">WhatsApp (Opt)</label>
              <input
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="+91..."
                className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
              />
            </div>
          </div>


          {orderType === "dine-in" && !lockedTable && !appendOrderId && (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">Select Table</label>
                <select
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all"
                >
                  <option value="" disabled>Select an available table</option>
                  {restaurantTables.map(t => (
                    <option key={t.id} value={t.table_number} disabled={t.is_active && t.table_number !== tableNumber}>
                      {t.table_number} {t.is_active && t.table_number !== tableNumber ? "(Occupied)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}


          {orderType === "delivery" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">Address</label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Full Address"
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">Landmark (Opt)</label>
                <input
                  type="text"
                  value={deliveryLandmark}
                  onChange={(e) => setDeliveryLandmark(e.target.value)}
                  placeholder="Near..."
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-[#6B7A90] uppercase tracking-widest mb-1.5 block">Pincode</label>
                <input
                  type="text"
                  value={deliveryPincode}
                  onChange={(e) => setDeliveryPincode(e.target.value)}
                  placeholder="575001"
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-[#EAF0F6] bg-[#F8FAFB] text-[13px] font-black text-[#0A1017] focus:border-[#0D6EFD] focus:bg-white focus:ring-4 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-dashed border-[#EAF0F6] bg-white shrink-0 z-10">
          <div className="flex justify-between items-end mb-5">
            <span className="text-[14px] font-black text-[#8799AF] uppercase tracking-widest">Total</span>
            <span className="text-[28px] font-black tracking-[-1px] text-[#0A1017] leading-none">₹{cartTotal}</span>
          </div>
          
          <button
            onClick={handleReviewOrder}
            disabled={cart.length === 0}
            className="w-full rounded-[14px] bg-[#E23744] px-4 py-4 text-[16px] font-black tracking-wide text-white shadow-[0_6px_20px_rgba(226,55,68,0.25)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(226,55,68,0.35)] transition-all disabled:opacity-50 disabled:transform-none disabled:shadow-none active:translate-y-0"
          >
            {editOrderId ? "Review Updates" : "Review Order"}
          </button>
        </div>
      </div>
      
      {/* Variant Selection Modal */}
      {variantModalItem && variantModalItem.variants?.options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A1017]/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
            <h3 className="text-[20px] font-extrabold text-[#0A1017] tracking-[-0.5px] mb-1">
              {variantModalItem.item_name}
            </h3>
            <p className="text-[13px] font-bold text-[#8799AF] mb-6">Select options</p>
            
            <div className="space-y-5 mb-8">
              {variantModalItem.variants.options.map((opt) => (
                <div key={opt.label}>
                  <label className="text-[12px] font-extrabold text-[#0A1017] uppercase tracking-widest mb-2 block">
                    {opt.label}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {opt.values.map((val) => (
                      <button
                        key={val}
                        onClick={() => setSelectedVariants(prev => ({ ...prev, [opt.label]: val }))}
                        className={`px-4 py-2 rounded-xl text-[13px] font-bold transition-all border ${
                          selectedVariants[opt.label] === val
                            ? "bg-[#EAF3FF] border-[#0D6EFD] text-[#1A5FA8]"
                            : "bg-white border-[#EAF0F6] text-[#6B7A90] hover:border-[#C9D4E0]"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setVariantModalItem(null)}
                className="flex-1 rounded-xl bg-[#F3F6F9] px-4 py-3 text-[14px] font-extrabold text-[#6B7A90] hover:bg-[#EAF0F6] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const combinedVariantName = variantModalItem.variants!.options
                    .map(opt => selectedVariants[opt.label])
                    .filter(Boolean)
                    .join(", ");
                  
                  addToCart(variantModalItem, combinedVariantName);
                  setVariantModalItem(null);
                }}
                className="flex-1 rounded-xl bg-[#0A1017] px-4 py-3 text-[14px] font-extrabold text-white shadow-[0_4px_12px_rgba(10,16,23,0.15)] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(10,16,23,0.2)] transition-all"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Order Modal */}
      {showReview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0A1017]/60 backdrop-blur-md p-4 sm:p-6">
          <div className="w-full max-w-2xl bg-white rounded-[24px] shadow-[0_24px_48px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-full">
            
            {orderResult?.success ? (
              <div className="p-10 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-[#E6F4EA] text-[#0D5424] rounded-full flex items-center justify-center mb-6">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h2 className="text-[28px] font-black text-[#0A1017] tracking-tight mb-2">{editOrderId ? "Order Updated!" : "Order Created!"}</h2>
                <p className="text-[15px] font-bold text-[#8799AF] mb-1">Order Number:</p>
                <div className="bg-[#F8FAFB] px-6 py-3 rounded-xl border border-[#EAF0F6] mb-8">
                  <span className="text-[24px] font-extrabold text-[#0D6EFD] tracking-widest">{orderResult.order_number}</span>
                </div>
                <button
                  onClick={startNewOrder}
                  className="rounded-xl bg-[#0A1017] px-8 py-3.5 text-[15px] font-extrabold text-white hover:bg-[#111923] transition-colors"
                >
                  {editOrderId ? "Back to POS" : "Start New Order"}
                </button>
              </div>
            ) : (
              <>
                <div className="px-6 py-5 border-b border-[#EAF0F6] bg-[#F8FAFB] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => !isPending && setShowReview(false)}
                      disabled={isPending}
                      className="p-2 hover:bg-[#EAF0F6] rounded-lg transition-colors disabled:opacity-50"
                    >
                      <ArrowLeft className="w-5 h-5 text-[#6B7A90]" />
                    </button>
                    <h2 className="text-[20px] font-black text-[#0A1017] tracking-tight">{editOrderId ? "Review Updates" : "Review Order"}</h2>
                  </div>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-white">
                  {orderResult?.error && (
                    <div className="mb-6 p-4 rounded-xl bg-[#FDE8E8] border border-[#F9C3C3] flex items-start gap-3 text-[#C0392B]">
                      <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-extrabold text-[14px]">Order Failed</p>
                        <p className="text-[13px] font-semibold mt-0.5">{orderResult.error}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left: Details */}
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-[12px] font-extrabold text-[#8799AF] uppercase tracking-widest mb-3">Order Details</h3>
                        <div className="bg-[#F8FAFB] p-4 rounded-xl border border-[#EAF0F6] space-y-3">
                          <div className="flex justify-between">
                            <span className="text-[13px] font-bold text-[#6B7A90]">Type</span>
                            <span className="text-[13px] font-black text-[#0A1017] capitalize">{orderType}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[13px] font-bold text-[#6B7A90]">Name</span>
                            <span className="text-[13px] font-black text-[#0A1017]">{customerName || "Walk-in"}</span>
                          </div>
                          {whatsappNumber && (
                            <div className="flex justify-between">
                              <span className="text-[13px] font-bold text-[#6B7A90]">WhatsApp</span>
                              <span className="text-[13px] font-black text-[#0A1017]">{whatsappNumber}</span>
                            </div>
                          )}

                          {orderType === "delivery" && (
                            <div className="flex justify-between">
                              <span className="text-[13px] font-bold text-[#6B7A90]">Address</span>
                              <span className="text-[13px] font-black text-[#0A1017] text-right max-w-[200px] truncate" title={`${deliveryAddress} ${deliveryLandmark} ${deliveryPincode}`}>
                                {deliveryAddress}, {deliveryPincode}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Items */}
                    <div>
                      <h3 className="text-[12px] font-extrabold text-[#8799AF] uppercase tracking-widest mb-3">Cart Items</h3>
                      <div className="bg-[#F8FAFB] rounded-xl border border-[#EAF0F6] overflow-hidden">
                        <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
                          {cart.map(c => (
                            <div key={c.cartId} className="flex justify-between items-start">
                              <div>
                                <p className="text-[13px] font-black text-[#0A1017] leading-tight">{c.quantity}x {c.item_name}</p>
                              </div>
                              <p className="text-[13px] font-black text-[#0A1017]">₹{c.unit_price * c.quantity}</p>
                            </div>
                          ))}
                        </div>
                        <div className="p-4 bg-[#EAF0F6] flex justify-between items-center">
                          <span className="text-[14px] font-extrabold text-[#0A1017]">Total</span>
                          <span className="text-[18px] font-black text-[#E23744]">₹{cartTotal}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5 border-t border-[#EAF0F6] bg-white flex justify-end gap-3">
                  <button
                    onClick={() => setShowReview(false)}
                    disabled={isPending}
                    className="px-6 py-3 rounded-xl bg-[#F3F6F9] text-[14px] font-extrabold text-[#6B7A90] hover:bg-[#EAF0F6] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmOrder}
                    disabled={isPending}
                    className="px-8 py-3 rounded-xl bg-[#E23744] text-[14px] font-extrabold text-white shadow-[0_4px_12px_rgba(226,55,68,0.25)] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(226,55,68,0.35)] transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      editOrderId ? "Confirm & Update Order" : "Confirm & Place Order"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Active Orders Panel */}
      {showActiveOrders && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0A1017]/40 backdrop-blur-sm" onClick={() => setShowActiveOrders(false)}>
          <div className="w-full max-w-sm h-full bg-white shadow-[-8px_0_32px_rgba(0,0,0,0.1)] flex flex-col transform transition-transform" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-[#EAF0F6] flex justify-between items-center bg-[#F8FAFB]">
              <h3 className="text-[18px] font-extrabold text-[#0A1017]">Active POS Orders</h3>
              <button onClick={() => setShowActiveOrders(false)} className="text-[#8799AF] hover:text-[#0A1017]"><XCircle className="h-6 w-6" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFB]">
              {activePosOrders.length === 0 ? (
                <p className="text-[14px] font-bold text-[#8799AF] text-center mt-10">No active POS orders</p>
              ) : (
                activePosOrders.map(order => (
                  <div key={order.id} className="bg-white border border-[#EAF0F6] rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[16px] font-black text-[#0A1017]">{order.order_number}</span>
                      <span className={`text-[11px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md ${
                        order.status === 'preparing' ? 'bg-[#EAF3FF] text-[#1A5FA8]' :
                        order.status === 'ready_for_pickup' ? 'bg-[#EAF8EF] text-[#0D5424]' :
                        'bg-[#F3F6F9] text-[#6B7A90]'
                      }`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold text-[#6B7A90] mb-3">
                      {order.customer_name || 'Walk-in'} • ₹{order.total}
                    </div>
                    <button
                      onClick={() => {
                        setShowActiveOrders(false);
                        window.location.href = `/dashboard/pos?edit=${order.id}`;
                      }}
                      className="w-full py-2 bg-[#F3F6F9] hover:bg-[#EAF0F6] text-[#0A1017] rounded-lg font-extrabold text-[13px] transition-colors"
                    >
                      Edit Order
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
