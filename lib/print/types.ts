export interface BillData {
  orderNumber: string;
  createdAt: string;
  orderType: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string;
  scheduledFor: string | null;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  itemsSubtotal: number;
  deliveryFee: number;
  total: number;
  restaurant: {
    name: string;
    tagline: string;
    address: string;
    phone: string;
    gstin: string;
    gstPercent: number;
    logoUrl: string;
    googleReviewUrl: string;
  };
}
