"use server";

import { randomUUID } from "crypto";
import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type MenuItemInput = {
  item_number: number;
  item_name: string;
  category: string;
  price: number;
  available: boolean;
  description: string | null;
  image_url: string | null;
  variants: unknown | null;
};

type MenuActionError = { success: false; error: string };
type MenuItemRow = {
  id: string;
  item_number: number;
  item_name: string;
  category: string;
  price: number;
  available: boolean;
  description: string | null;
  image_url: string | null;
  variants: unknown;
  is_pinned?: boolean;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function getMenuItems(): Promise<{ success: true; items: MenuItemRow[] } | MenuActionError> {
  try {
    await authorize("manage_menu");
    const { data, error } = await createAdminClient()
      .from("menu_items")
      .select("*")
      .order("item_number", { ascending: true });

    if (error) throw error;
    return { success: true, items: (data ?? []) as MenuItemRow[] };
  } catch (error: unknown) {
    console.error("[getMenuItems] Failed to load menu:", error);
    return { success: false, error: getErrorMessage(error, "Failed to load menu items.") };
  }
}

export async function saveMenuItem(
  input: MenuItemInput,
  itemId: string | null = null,
): Promise<{ success: true } | MenuActionError> {
  try {
    await authorize("manage_menu");

    const itemNumber = Number(input?.item_number);
    const price = Number(input?.price);
    const itemName = String(input?.item_name ?? "").trim();
    const category = String(input?.category ?? "").trim();

    if (!Number.isInteger(itemNumber) || itemNumber < 1) {
      return { success: false, error: "Item number must be a positive whole number." };
    }
    if (!itemName) return { success: false, error: "Item name is required." };
    if (!category) return { success: false, error: "Category is required." };
    if (!Number.isFinite(price) || price < 0) {
      return { success: false, error: "Price must be zero or greater." };
    }
    if (input?.variants !== null && input?.variants !== undefined && typeof input.variants !== "object") {
      return { success: false, error: "Variants must be a JSON object or array." };
    }

    const record = {
      item_number: itemNumber,
      item_name: itemName,
      category,
      price,
      available: Boolean(input.available),
      description: String(input.description ?? "").trim() || null,
      image_url: String(input.image_url ?? "").trim() || null,
      variants: input.variants ?? null,
      updated_at: new Date().toISOString(),
    };

    const admin = createAdminClient();
    const { error } = itemId
      ? await admin.from("menu_items").update(record).eq("id", itemId)
      : await admin.from("menu_items").insert(record);

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: `Item number ${itemNumber} already exists.` };
      }
      throw error;
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[saveMenuItem] Failed to save menu item:", error);
    return { success: false, error: getErrorMessage(error, "Failed to save menu item.") };
  }
}

export async function setMenuItemAvailable(
  itemId: string,
  available: boolean,
): Promise<{ success: true } | MenuActionError> {
  try {
    await authorize("manage_menu");
    const { error } = await createAdminClient()
      .from("menu_items")
      .update({ available, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error("[setMenuItemAvailable] Failed to update availability:", error);
    return { success: false, error: getErrorMessage(error, "Could not update item availability.") };
  }
}

export async function setMenuItemPinned(
  itemId: string,
  isPinned: boolean,
): Promise<{ success: true } | MenuActionError> {
  try {
    await authorize("manage_menu");
    const { error } = await createAdminClient()
      .from("menu_items")
      .update({ is_pinned: isPinned, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error("[setMenuItemPinned] Failed to update pin:", error);
    return { success: false, error: getErrorMessage(error, "Could not update item pin.") };
  }
}

export async function deleteMenuItem(itemId: string): Promise<{ success: true } | MenuActionError> {
  try {
    await authorize("manage_menu");
    const { error } = await createAdminClient().from("menu_items").delete().eq("id", itemId);
    if (error?.code === "23503") {
      return { success: false, error: "This item is in past orders. Hide it instead of deleting it." };
    }
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error("[deleteMenuItem] Failed to delete menu item:", error);
    return { success: false, error: getErrorMessage(error, "Could not delete menu item.") };
  }
}

export async function uploadMenuImage(formData: FormData): Promise<{ success: true; url: string } | MenuActionError> {
  try {
    await authorize("manage_menu");

    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "Choose an image to upload." };
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
      return { success: false, error: "Images must be smaller than 8 MB." };
    }

    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/gif": "gif",
    };
    const extension = extensions[file.type];
    if (!extension) return { success: false, error: "Use a JPG, PNG, WebP, AVIF, or GIF image." };

    const admin = createAdminClient();
    const path = `${randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("menu_images")
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });

    if (uploadError) throw uploadError;
    const { data } = admin.storage.from("menu_images").getPublicUrl(path);
    if (!data.publicUrl) return { success: false, error: "Image uploaded, but its public URL could not be created." };
    return { success: true, url: data.publicUrl };
  } catch (error: unknown) {
    console.error("[uploadMenuImage] Failed to upload image:", error);
    return { success: false, error: getErrorMessage(error, "Could not upload the menu image.") };
  }
}
