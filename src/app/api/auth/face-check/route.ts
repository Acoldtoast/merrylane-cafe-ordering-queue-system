import { getUserAuthStatus } from "@/lib/auth";
import { facePlusPlusMode, verifyFacePlusPlusLogin } from "@/lib/facepp";
import { recordStaffFaceCheck, staffFaceAccess } from "@/lib/staffFaceAccess";
import { decryptStaffIdentityData, parseStaffIdentityImages } from "@/lib/staffIdentityRegistration";

export const runtime = "nodejs";

const attempts = new Map<number, { at: number; busy: boolean }>();
const MAX_BODY_BYTES = 20 * 1024 * 1024;

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
    text += decoder.decode(value, { stream: true });
  }
}

export async function GET(request: Request) {
  const { user, reason } = await getUserAuthStatus(request, "staff", true, true);
  if (!user) return Response.json({ error: "Please sign in.", reason, success: false }, { status: 401 });
  const account = await (await import("@/lib/models")).UserModel.byId(user.id);
  if (account?.must_change_password === 1) {
    return Response.json({ success: true, password_change_required: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const access = await staffFaceAccess(user.id);
  return Response.json({ success: true, required: access.required, enrolled: access.enrolled }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user, reason } = await getUserAuthStatus(request, "staff", true);
  if (!user) return Response.json({ error: "Please sign in.", reason, success: false }, { status: 401 });
  const previous = attempts.get(user.id);
  if (previous && (previous.busy || Date.now() - previous.at < 5000)) {
    return Response.json({ error: "Please wait before trying again.", success: false }, { status: 429 });
  }
  attempts.set(user.id, { at: Date.now(), busy: true });
  try {
    const access = await staffFaceAccess(user.id);
    if (!access.required) return Response.json({ success: true });
    if (!access.identity || !access.hash) {
      return Response.json({ error: "Your face is not registered. Ask an administrator to register it.", success: false }, { status: 403 });
    }
    if (facePlusPlusMode() !== "enabled") {
      return Response.json({ error: "Face verification is unavailable. Contact an administrator.", success: false }, { status: 503 });
    }
    const text = await readBody(request);
    if (text === null) return Response.json({ error: "Images are too large.", success: false }, { status: 413 });
    const body = JSON.parse(text) as Record<string, unknown>;
    const images = parseStaffIdentityImages({ id_front: body.front, face_front: body.front, face_left: body.left, face_right: body.right });
    const blink = parseStaffIdentityImages({ id_front: body.front, face_front: body.front, face_left: body.closed, face_right: body.open });
    const secondBlink = parseStaffIdentityImages({ id_front: body.front, face_front: body.front, face_left: body.closedAgain, face_right: body.openAgain });
    const registered = parseStaffIdentityImages(decryptStaffIdentityData(access.identity));
    if (!images || !blink || !secondBlink || !registered) {
      return Response.json({ error: "The captured images are invalid. Please try again.", success: false }, { status: 400 });
    }
    const result = await verifyFacePlusPlusLogin({
      referenceImage: registered.face_front,
      frontImage: images.face_front,
      leftImage: images.face_left,
      rightImage: images.face_right,
      blinkEvidence: { before: images.face_front, closed: blink.face_left, after: blink.face_right, closedAgain: secondBlink.face_left, afterAgain: secondBlink.face_right },
      requireDoubleBlink: true,
    });
    if (result.status !== "matched") {
      return Response.json({
        error: result.status === "unavailable" ? "Face verification is unavailable. Please try again later." : "Face or blink could not be verified. Please try again.",
        success: false,
      }, { status: result.status === "unavailable" ? 503 : 403 });
    }
    const current = await staffFaceAccess(user.id);
    if (!current.required) return Response.json({ success: true });
    const session = await getUserAuthStatus(request, "staff", true);
    if (session.reason === "face_reset") {
      return Response.json({ error: "An administrator reset your face check. Sign in again.", reason: "face_reset", success: false }, { status: 401 });
    }
    if (current.hash !== access.hash || !session.user) {
      return Response.json({ error: "Your session or registration changed. Please try again.", success: false }, { status: 409 });
    }
    if (!(await recordStaffFaceCheck(user.id, access.hash, access.resetToken ?? ""))) {
      return Response.json({ error: "Face verification was reset. Please try again.", success: false }, { status: 409 });
    }
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Could not complete face verification. Please try again.", success: false }, { status: 500 });
  } finally {
    attempts.set(user.id, { at: Date.now(), busy: false });
  }
}
