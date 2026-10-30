import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The customer app's "Back to WhatsApp" link needs the business number in the
  // browser; fall back to the YCloud sender number when no public one is set.
  env: {
    NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || process.env.YCLOUD_PHONE_NUMBER || "",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
