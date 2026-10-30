"use server";

import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createExpense(input: { expense_date: string; category: string; amount: number; note: string }) {
  const staff = await authorize("view_financials");
  const expenseDate = String(input?.expense_date || "");
  const category = String(input?.category || "").trim();
  const amount = Number(input?.amount);
  const note = String(input?.note || "");
  const validDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(expenseDate);
  const dateParts = validDateFormat ? expenseDate.split("-").map(Number) : [];
  const parsedDate = validDateFormat ? new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2])) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== expenseDate) {
    return { success: false, error: "Choose a valid expense date." };
  }
  if (!category || category.length > 80) return { success: false, error: "Add an expense category under 80 characters." };
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Enter an amount greater than zero." };
  if (note.length > 500) return { success: false, error: "Keep expense notes under 500 characters." };

  const { error } = await createAdminClient().from("expenses").insert({
    expense_date: expenseDate,
    category,
    amount,
    note: note.trim() || null,
    recorded_by: staff.email.split("@")[0],
  });
  if (error) {
    const missingTable = error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message);
    return { success: false, error: missingTable ? "Apply the stock and P&L migration before recording expenses." : "Could not save the expense." };
  }
  return { success: true };
}

export async function deleteExpense(id: string) {
  await authorize("view_financials");
  const { error } = await createAdminClient().from("expenses").delete().eq("id", id);
  return error ? { success: false, error: "Could not delete the expense." } : { success: true };
}
