import { Fraunces, Inter } from "next/font/google";
import "../oceana.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={`oc ${inter.variable} ${fraunces.variable}`}>{children}</div>;
}
