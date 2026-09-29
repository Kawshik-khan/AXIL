import { NextResponse } from "next/server";
import { withStore } from "@/lib/store-unit";

async function handleGET() {
  return NextResponse.json(
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    { status: 200 }
  );
}

export const GET = withStore("GET", handleGET);
