import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";

export async function GET() {
  try {
    // Verify database connectivity
    const tenants = db.getTenants();
    const isDbConnected = Array.isArray(tenants);

    if (!isDbConnected) {
      return NextResponse.json(
        {
          status: "not_ready",
          reason: "Database connection failed",
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: "ready",
        services: {
          database: "connected",
          storage: "ready",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "not_ready",
        reason: "Readiness verification failure",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
