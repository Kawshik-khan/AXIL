import { NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { AUTH_COOKIE_NAME } from "@/lib/security";

export async function POST() {
  const response = apiSuccess({ message: "Successfully logged out." });

  // Clear session cookie
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
