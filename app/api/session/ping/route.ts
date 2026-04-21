export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
export async function POST() { return new NextResponse(null, { status: 204 }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }
