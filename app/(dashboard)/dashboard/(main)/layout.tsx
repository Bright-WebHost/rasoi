import { Fraunces, Inter } from "next/font/google";
import DashShell from "../DashShell";
import "../oceana.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });

// No server data here on purpose: the shell loads staff/settings in the browser
// so every dashboard route can be prefetched and switched to instantly.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashShell fontClass={`${inter.variable} ${fraunces.variable}`}>{children}</DashShell>;
}
