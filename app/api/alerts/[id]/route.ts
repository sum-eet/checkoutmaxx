export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const { error } = await supabase
    .from("AlertLog")
    .update({ resolvedAt: new Date().toISOString(), resolvedBy: "merchant" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
