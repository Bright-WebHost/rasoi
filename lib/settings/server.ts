import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSettings, rowsToRawSettings, type RawSettings, type RestaurantSettings } from "./index";

export interface DeliveryPincode {
  pincode: string;
  area: string;
  active: boolean;
}

/** Raw key/value settings merged over defaults. Cached per request. */
export const getRawSettings = cache(async (): Promise<RawSettings> => {
  const { data, error } = await createAdminClient().from("settings").select("key, value");
  if (error) console.error("[settings] load failed:", error.message);
  return rowsToRawSettings(data);
});

export const getSettings = cache(async (): Promise<RestaurantSettings> => parseSettings(await getRawSettings()));

export const getDeliveryPincodes = cache(async (): Promise<DeliveryPincode[]> => {
  const { data, error } = await createAdminClient()
    .from("delivery_pincodes")
    .select("pincode, area, active")
    .order("pincode");
  if (error) console.error("[settings] pincodes load failed:", error.message);
  return (data ?? []) as DeliveryPincode[];
});

export async function getActivePincodes(): Promise<string[]> {
  return (await getDeliveryPincodes()).filter((p) => p.active).map((p) => p.pincode);
}
