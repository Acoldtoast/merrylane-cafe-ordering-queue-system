import { UserModel } from "@/lib/models";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";

const JWT_SECRET =
  process.env.JWT_SECRET || "merrylane-secret-change-me-in-production";

function staffSessionSecondsUntilMidnight(): number {
  const manilaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const nextMidnightUtc =
    Date.UTC(
      manilaNow.getUTCFullYear(),
      manilaNow.getUTCMonth(),
      manilaNow.getUTCDate() + 1
    ) -
    8 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((nextMidnightUtc - Date.now()) / 1000));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, remember } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required.", success: false },
        { status: 400 }
      );
    }

    const user = UserModel.byEmail(String(email));
    if (!user || user.password_hash !== `sha256_${password}`) {
      return NextResponse.json(
        { error: "Those credentials don't match our records.", success: false },
        { status: 401 }
      );
    }

    const rememberForToday = user.role === "staff" && remember === true;
    const maxAge =
      user.role === "admin"
        ? 5 * 60
        : rememberForToday
          ? staffSessionSecondsUntilMidnight()
          : 12 * 60 * 60;
    const token = await new SignJWT({
      userId: user.id,
      role: user.role,
      rememberForToday,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
      .sign(new TextEncoder().encode(JWT_SECRET));

    logActivity(user, {
      area: "Access",
      action: "auth.login",
      summary: `Signed in as ${
        user.role === "admin" ? "administrator" : "staff"
      }`,
      entity_type: "user",
      entity_id: user.id,
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      remember_for_today: rememberForToday,
      success: true,
    });
    response.cookies.set(`auth-${user.role}-token`, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge,
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not sign in.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const area = new URL(request.url).searchParams.get("area");
  const response = NextResponse.json({ success: true });
  if (area === "admin" || area === "staff") {
    response.cookies.set(`auth-${area}-token`, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/",
    });
  }
  response.cookies.set("auth-token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
