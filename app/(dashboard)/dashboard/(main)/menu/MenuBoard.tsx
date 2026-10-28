"use client";

import { useState, useEffect, FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Edit2, Trash2, Eye, EyeOff } from "lucide-react";

type MenuItem = {
  id: string;
  item_number: number;
  item_name: string;
  category: string;
  price: number;
  available: boolean;
  description: string | null;
  image_url: string | null;
  variants: any; // jsonb
  is_pinned?: boolean;
};

export default function MenuBoard() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formNumber, setFormNumber] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formAvailable, setFormAvailable] = useState(true);
  const [formVariants, setFormVariants] = useState("");
  
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const supabase = createClient() as any;

  const fetchMenu = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("menu_items")
      .select("*")
      .order("item_number", { ascending: true });

    if (err) {
      setError("Failed to fetch menu items.");
    } else {
      setItems(data as MenuItem[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMenu();
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setFormError(null);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('menu_images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('menu_images')
        .getPublicUrl(fileName);

      setFormImageUrl(publicUrl);
    } catch (err: any) {
      console.error(err);
      setFormError("Failed to upload image: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const existingCategories = Array.from(
    new Set(items.map((i) => i.category).filter(c => Boolean(c) && c !== "Pinned ⭐"))
  ).sort((a, b) => a.localeCompare(b));

  const openAddModal = () => {
    setModalMode("add");
    setEditingId(null);
    setFormNumber("");
    setFormName("");
    setFormCategory(existingCategories[0] || "");
    setIsCustomCategory(false);
    setNewCategoryName("");
    setFormPrice("");
    setFormDescription("");
    setFormImageUrl("");
    setFormAvailable(true);
    setFormVariants("");
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item: MenuItem) => {
    setModalMode("edit");
    setEditingId(item.id);
    setFormNumber(item.item_number.toString());
    setFormName(item.item_name);
    if (existingCategories.includes(item.category)) {
      setFormCategory(item.category);
      setIsCustomCategory(false);
      setNewCategoryName("");
    } else {
      setFormCategory("__NEW__");
      setIsCustomCategory(true);
      setNewCategoryName(item.category || "");
    }
    setFormPrice(item.price.toString());
    setFormDescription(item.description || "");
    setFormImageUrl(item.image_url || "");
    setFormAvailable(item.available);
    setFormVariants(item.variants ? JSON.stringify(item.variants, null, 2) : "");
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSaving(true);

    const itemNum = parseInt(formNumber, 10);
    const priceNum = parseFloat(formPrice);

    if (isNaN(itemNum)) {
      setFormError("Item number must be a valid integer.");
      setFormSaving(false);
      return;
    }
    if (isNaN(priceNum)) {
      setFormError("Price must be a valid number.");
      setFormSaving(false);
      return;
    }

    const finalCategory = (isCustomCategory ? newCategoryName : formCategory).trim();
    if (!finalCategory) {
      setFormError("Category is required. Please choose or enter a category name.");
      setFormSaving(false);
      return;
    }

    let variantsJson = null;
    if (formVariants.trim()) {
      try {
        variantsJson = JSON.parse(formVariants);
      } catch {
        setFormError("Variants must be valid JSON.");
        setFormSaving(false);
        return;
      }
    }

    const payload = {
      item_number: itemNum,
      item_name: formName.trim(),
      category: finalCategory,
      price: priceNum,
      available: formAvailable,
      description: formDescription.trim() || null,
      image_url: formImageUrl.trim() || null,
      variants: variantsJson,
    };

    if (modalMode === "add") {
      const { error: insertErr } = await supabase.from("menu_items").insert(payload);
      if (insertErr) {
        if (insertErr.code === "23505") {
          setFormError(`Item number ${itemNum} already exists.`);
        } else {
          setFormError(insertErr.message);
        }
      } else {
        setIsModalOpen(false);
        fetchMenu();
      }
    } else {
      const { error: updateErr } = await supabase.from("menu_items").update(payload).eq("id", editingId!);
      if (updateErr) {
        if (updateErr.code === "23505") {
          setFormError(`Item number ${itemNum} already exists.`);
        } else {
          setFormError(updateErr.message);
        }
      } else {
        setIsModalOpen(false);
        fetchMenu();
      }
    }

    setFormSaving(false);
  };

  const handleToggle = async (item: MenuItem) => {
    const { error: err } = await supabase
      .from("menu_items")
      .update({ available: !item.available })
      .eq("id", item.id);
    if (!err) {
      setItems(items.map(i => (i.id === item.id ? { ...i, available: !item.available } : i)));
    } else {
      alert("Failed to toggle visibility: " + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this menu item?")) return;
    const { error: err } = await supabase.from("menu_items").delete().eq("id", id);
    if (err) {
      if (err.code === "23503") {
        alert("Cannot delete this item because it exists in historical orders. Please hide it instead.");
      } else {
        alert("Failed to delete item: " + err.message);
      }
    } else {
      setItems(items.filter(i => i.id !== id));
    }
  };

  const handleTogglePin = async (item: MenuItem) => {
    const { error: err } = await supabase
      .from("menu_items")
      .update({ is_pinned: !item.is_pinned })
      .eq("id", item.id);
    if (!err) {
      setItems(items.map(i => (i.id === item.id ? { ...i, is_pinned: !item.is_pinned } : i)));
    } else {
      alert("Failed to pin item: " + err.message);
    }
  };

  // Group items by category. Pinned items go into a special "Pinned" category
  const grouped = items.reduce((acc, item) => {
    const cat = item.is_pinned ? "Pinned ⭐" : item.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  const categories = Object.keys(grouped).sort((a, b) => {
    if (a === "Pinned ⭐") return -1;
    if (b === "Pinned ⭐") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-col gap-6 p-1 sm:p-2 pb-20 md:pb-6 max-w-[1200px] mx-auto w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white/50 p-6 rounded-[20px] border border-[#EAF0F6] backdrop-blur-md">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0A1017]">Menu Management</h1>
          <p className="text-sm font-semibold text-[#8799AF] mt-1">Manage your menu items, categories, and availability.</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 rounded-xl bg-[#E23744] px-5 py-2.5 font-bold text-white shadow-[0_4px_12px_rgba(226,55,68,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(226,55,68,0.35)]"
        >
          <Plus className="h-5 w-5" />
          Add Item
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F5C2C6] bg-[#FDE8E8] px-4 py-3 text-sm font-semibold text-[#C0392B] shadow-[0_4px_12px_rgba(226,55,68,0.1)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-[100px] w-full rounded-[20px] bg-white/40 p-4 shadow-sm animate-pulse border border-[#EAF0F6]"></div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[#C9D4E0] bg-white/50 py-16 gap-3 backdrop-blur-sm">
          <div className="text-[40px] opacity-40">🍔</div>
          <span className="text-[15px] font-bold text-[#8799AF]">No menu items found</span>
          <button onClick={openAddModal} className="text-[#E23744] font-bold hover:underline">
            Add your first item
          </button>
        </div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="rounded-[20px] border border-[#EAF0F6] bg-white overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <div className="bg-[#F8FAFB] px-6 py-4 border-b border-[#EAF0F6]">
              <h2 className="text-[15px] font-extrabold uppercase tracking-widest text-[#0A1017]">{cat}</h2>
            </div>
            <div className="divide-y divide-[#EAF0F6]">
              {grouped[cat].map((item) => (
                <div key={item.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-6 transition hover:bg-[#F8FAFB] gap-4 ${!item.available ? "opacity-60 bg-[#F8FAFB]" : ""}`}>
                  <div className="flex items-center gap-5">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.item_name} className="h-20 w-20 rounded-[14px] object-cover border border-[#EAF0F6] shadow-sm" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-[14px] bg-[#F3F6F9] border border-[#EAF0F6] text-xs font-semibold text-[#A1B2C6]">
                        No Img
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] bg-[#F3F6F9] px-2 py-0.5 rounded-md text-[#6B7A90] font-bold border border-[#EAF0F6]">#{item.item_number}</span>
                        <h3 className="font-extrabold text-[16px] text-[#0A1017]">{item.item_name}</h3>
                        {!item.available && (
                          <span className="rounded-full bg-[#FDE8E8] px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase text-[#C0392B]">Hidden</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-[#6B7A90] line-clamp-2 leading-relaxed max-w-md">{item.description || "No description"}</p>
                      <p className="font-extrabold text-[#E23744] text-[15px]">₹{item.price}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => handleTogglePin(item)}
                      title={item.is_pinned ? "Unpin item" : "Pin item to top"}
                      className={`rounded-xl p-2.5 transition-all border ${
                        item.is_pinned ? "bg-amber-100 text-amber-600 border-amber-200" : "text-[#8799AF] hover:bg-[#F3F6F9] hover:text-[#0A1017] border-transparent hover:border-[#EAF0F6]"
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill={item.is_pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                    </button>
                    <button
                      onClick={() => handleToggle(item)}
                      title={item.available ? "Hide item" : "Show item"}
                      className="rounded-xl p-2.5 text-[#8799AF] hover:bg-[#F3F6F9] hover:text-[#0A1017] transition-all border border-transparent hover:border-[#EAF0F6]"
                    >
                      {item.available ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                    <button
                      onClick={() => openEditModal(item)}
                      title="Edit item"
                      className="rounded-xl p-2.5 text-[#8799AF] hover:bg-[#EAF2FD] hover:text-[#0D6EFD] transition-all border border-transparent hover:border-[#C9DEFA]"
                    >
                      <Edit2 className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Delete item"
                      className="rounded-xl p-2.5 text-[#8799AF] hover:bg-[#FDE8E8] hover:text-[#C0392B] transition-all border border-transparent hover:border-[#F5C2C6]"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A1017]/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-[24px] bg-white shadow-[0_24px_48px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh]">
            <div className="px-8 py-6 border-b border-[#EAF0F6]">
              <h2 className="text-[20px] font-extrabold tracking-tight text-[#0A1017]">
                {modalMode === "add" ? "Add Menu Item" : "Edit Menu Item"}
              </h2>
            </div>
            
            <div className="p-8 overflow-y-auto">
              {formError && (
                <div className="mb-6 rounded-xl bg-[#FDE8E8] p-4 text-sm font-semibold text-[#C0392B] border border-[#F5C2C6]">
                  {formError}
                </div>
              )}
              
              <form id="menu-form" onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Item Number *</label>
                  <input required type="number" value={formNumber} onChange={e => setFormNumber(e.target.value)} className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Item Name *</label>
                  <input required type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Category *</label>
                    {!isCustomCategory ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(true);
                          setNewCategoryName("");
                        }}
                        className="text-[11px] font-bold text-[#E23744] hover:underline cursor-pointer"
                      >
                        + New
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(false);
                          setFormCategory(existingCategories[0] || "");
                        }}
                        className="text-[11px] font-bold text-[#0D6EFD] hover:underline cursor-pointer"
                      >
                        ← Choose list
                      </button>
                    )}
                  </div>

                  {!isCustomCategory ? (
                    <select
                      required
                      value={formCategory}
                      onChange={(e) => {
                        if (e.target.value === "__NEW__") {
                          setIsCustomCategory(true);
                          setNewCategoryName("");
                        } else {
                          setFormCategory(e.target.value);
                        }
                      }}
                      className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all cursor-pointer"
                    >
                      <option value="" disabled>-- Select Category --</option>
                      {existingCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                      <option value="__NEW__" className="font-bold text-[#E23744]">
                        ➕ + Add New Category...
                      </option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        required
                        type="text"
                        placeholder="New category name..."
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        autoFocus
                        className="flex-1 rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(false);
                          setFormCategory(existingCategories[0] || "");
                        }}
                        className="rounded-xl px-3 py-2 text-xs font-bold text-[#6B7A90] hover:bg-[#F3F6F9] hover:text-[#0A1017] border border-[#EAF0F6] transition shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Price (₹) *</label>
                  <input required type="number" step="0.01" value={formPrice} onChange={e => setFormPrice(e.target.value)} className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Description</label>
                  <textarea rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Image</label>
                  <div className="flex gap-4 items-start">
                    {formImageUrl ? (
                      <div className="relative">
                        <img src={formImageUrl} alt="Preview" className="h-20 w-20 rounded-xl object-cover border border-[#EAF0F6]" />
                        <button type="button" onClick={() => setFormImageUrl("")} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-20 w-20 flex items-center justify-center rounded-xl border border-dashed border-[#C9D4E0] bg-[#F8FAFB] text-[#8799AF]">
                        <span className="text-[10px] font-bold">No Image</span>
                      </div>
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className={`cursor-pointer inline-flex items-center justify-center rounded-xl bg-[#F3F6F9] px-4 py-2 text-sm font-bold text-[#0A1017] transition hover:bg-[#EAF0F6] ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          {isUploading ? "Uploading..." : "Upload from Gallery"}
                          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                        </label>
                        <span className="text-sm font-semibold text-[#8799AF]">OR</span>
                      </div>
                      <input type="url" placeholder="Paste image URL..." value={formImageUrl} onChange={e => setFormImageUrl(e.target.value)} className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]">Variants JSON (Optional)</label>
                  <textarea rows={4} placeholder='{"options": [{"label": "Size", "values": ["Regular", "Large"]}]}' value={formVariants} onChange={e => setFormVariants(e.target.value)} className="w-full font-mono text-[11px] rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all" />
                </div>
                <div className="flex items-center gap-3 sm:col-span-2 mt-2 bg-[#F8FAFB] p-4 rounded-xl border border-[#EAF0F6]">
                  <input type="checkbox" id="available" checked={formAvailable} onChange={e => setFormAvailable(e.target.checked)} className="h-5 w-5 rounded border-[#C9D4E0] text-[#E23744] focus:ring-[#E23744]" />
                  <label htmlFor="available" className="text-[14px] font-bold text-[#0A1017]">Visible to customers (Available)</label>
                </div>
              </form>
            </div>
            
            <div className="border-t border-[#EAF0F6] px-8 py-5 flex justify-end gap-3 bg-[#F8FAFB] rounded-b-[24px]">
              <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-xl px-5 py-2.5 font-bold text-[#6B7A90] hover:bg-white hover:text-[#0A1017] hover:shadow-sm transition border border-transparent hover:border-[#EAF0F6]">
                Cancel
              </button>
              <button type="submit" form="menu-form" disabled={formSaving} className="rounded-xl bg-[#E23744] px-6 py-2.5 font-bold text-white shadow-[0_4px_12px_rgba(226,55,68,0.25)] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(226,55,68,0.35)] transition disabled:opacity-50">
                {formSaving ? "Saving..." : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
