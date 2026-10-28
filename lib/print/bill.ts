import { getOrderBill } from "@/lib/orders/actions";
import { gstBreakup } from "@/lib/settings";
import type { BillData } from "./types";
import { formatPickupTime } from "@/lib/orders/format";

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const rs = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function orderTypeLabel(bill: BillData) {
  if (bill.orderType === "dine-in") return bill.tableNumber ? `Dine-in · Table ${bill.tableNumber}` : "Dine-in";
  if (bill.orderType === "delivery") return "Delivery";
  return "Takeaway";
}

/** 80 mm thermal-printer friendly bill. Every dynamic value is escaped. */
export function renderBillHtml(bill: BillData) {
  const r = bill.restaurant;
  const date = new Date(bill.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const gst = gstBreakup(bill.itemsSubtotal, r.gstPercent);

  const rows = bill.items
    .map((item) => `<tr><td>${esc(item.quantity)} × ${esc(item.name)}</td><td class="r">${rs(item.unitPrice * item.quantity)}</td></tr>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(bill.orderNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  h1 { font-size: 17px; margin: 4px 0 2px; } p { margin: 1px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: inherit; } td { padding: 2px 0; vertical-align: top; }
  .nowrap { white-space: nowrap; }
  .tot td { font-size: 15px; font-weight: 700; padding-top: 4px; }
  .muted { font-size: 10.5px; }
  img.logo { max-width: 34mm; max-height: 22mm; display: block; margin: 0 auto 2px; }
</style></head><body>
  <div class="c">
    ${r.logoUrl ? `<img class="logo" src="${esc(r.logoUrl)}" alt="">` : ""}
    <h1>${esc(r.name)}</h1>
    ${r.tagline ? `<p class="muted">${esc(r.tagline)}</p>` : ""}
    ${r.address ? `<p class="muted">${esc(r.address)}</p>` : ""}
    ${r.phone ? `<p class="muted">Ph: ${esc(r.phone)}</p>` : ""}
    ${r.gstin ? `<p class="muted">GSTIN: ${esc(r.gstin)}</p>` : ""}
  </div>
  <hr>
  <table>
    <tr><td class="nowrap"><b>${esc(bill.orderNumber)}</b></td><td class="r">${esc(date)}</td></tr>
    <tr><td colspan="2">${esc(orderTypeLabel(bill))}</td></tr>
    ${formatPickupTime(bill.scheduledFor) ? `<tr><td colspan="2"><b>PICKUP AT ${esc(formatPickupTime(bill.scheduledFor))}</b></td></tr>` : ""}
    ${bill.customerName || bill.customerPhone ? `<tr><td colspan="2">${esc([bill.customerName, bill.customerPhone].filter(Boolean).join(" · "))}</td></tr>` : ""}
    ${bill.orderType === "delivery" && bill.address ? `<tr><td colspan="2" class="muted">${esc(bill.address)}</td></tr>` : ""}
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>Item total</td><td class="r">${rs(bill.itemsSubtotal)}</td></tr>
    ${bill.deliveryFee > 0 ? `<tr><td>Delivery fee</td><td class="r">${rs(bill.deliveryFee)}</td></tr>` : ""}
    <tr class="tot"><td>TOTAL</td><td class="r">${rs(bill.total)}</td></tr>
  </table>
  ${
    gst
      ? `<hr><table class="muted">
    <tr><td>Taxable value</td><td class="r">${rs(gst.taxable)}</td></tr>
    <tr><td>CGST @ ${esc(gst.halfRate)}%</td><td class="r">${rs(gst.cgst)}</td></tr>
    <tr><td>SGST @ ${esc(gst.halfRate)}%</td><td class="r">${rs(gst.sgst)}</td></tr>
    <tr><td colspan="2">Prices are inclusive of GST</td></tr>
  </table>`
      : ""
  }
  <hr>
  <p class="c"><b>Thank you! Visit again.</b></p>
  ${r.googleReviewUrl ? `<p class="c muted">Loved it? Review us on Google</p>` : ""}
</body></html>`;
}

/**
 * Prints through a hidden iframe instead of window.open, so it isn't caught by
 * popup blockers when it fires automatically (auto-print on accept).
 */
export async function printBillHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; window.setTimeout(resolve, 2500); })
    )
  );

  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(() => iframe.isConnected && iframe.remove(), 120000);
  win.focus();
  win.print();
}

/** Fetches the bill and prints it. With `auto`, prints only if Auto-print is on and the order wasn't printed before. */
export async function printOrderBill(orderId: string, options: { auto?: boolean } = {}) {
  const result = await getOrderBill(orderId, options);
  if (!result.success) {
    if (!options.auto) alert(result.error);
    return false;
  }
  if (!result.bill) return false;
  await printBillHtml(renderBillHtml(result.bill));
  return true;
}
