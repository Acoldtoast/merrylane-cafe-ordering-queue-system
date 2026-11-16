import { NextResponse, type NextRequest } from "next/server";
import { UserModel } from "@/lib/models";
import { verifyUserRecoveryCode } from "@/lib/authSecurity";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!username || !code) {
      return NextResponse.json(
        { error: "Username and code are required.", success: false },
        { status: 400 }
      );
    }

    const user = await UserModel.byUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: "The recovery code is invalid or expired.", success: false },
        { status: 400 }
      );
    }

    const result = await verifyUserRecoveryCode(user.id, code);
    if (result.status !== "verified") {
      return NextResponse.json(
        { error: "The recovery code is invalid or expired.", success: false },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Code verified. Choose a new password.",
    });
  } catch (error) {
    console.error("Could not verify recovery code.", error);
    return NextResponse.json(
      { error: "Could not verify the recovery code. Please try again.", success: false },
      { status: 500 }
    );
  }
}