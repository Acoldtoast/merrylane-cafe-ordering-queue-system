import { requireAdmin } from "@/lib/auth";
import { scanStaffId } from "@/lib/staffIdOcr";
import { compareFacePlusPlus, facePlusPlusMode } from "@/lib/facepp";
import { isStaffIdentityScanVerified } from "@/lib/staffIdChecks";
import { createStaffIdentityVerificationToken } from "@/lib/staffIdentityRegistration";

const types = new Set(["philsys", "drivers_license", "passport", "postal", "voter", "philhealth", "other"]);

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > 4400000) return Response.json({ error: "Images are too large or request size is missing." }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("image");
    const type = form.get("type");
    const face = form.get("face");
    const name = form.get("name");
    if (!(file instanceof File) || file.size < 4 || file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type) || typeof type !== "string" || !types.has(type)) return Response.json({ error: "Choose a valid ID type and JPEG or PNG image under 2 MB." }, { status: 400 });
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    if ((file.type === "image/jpeg" && !jpeg) || (file.type === "image/png" && !png)) return Response.json({ error: "Invalid image format." }, { status: 400 });
    if (!(face instanceof File) || face.size < 4 || face.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(face.type) || typeof name !== "string" || !name.trim() || name.length > 80) return Response.json({ error: "Add the staff name and a front face photo before scanning." }, { status: 400 });
    const faceBytes = Buffer.from(await face.arrayBuffer());
    const faceJpeg = faceBytes[0] === 255 && faceBytes[1] === 216 && faceBytes[2] === 255;
    const facePng = faceBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((face.type === "image/jpeg" && !faceJpeg) || (face.type === "image/png" && !facePng)) return Response.json({ error: "Invalid face image format." }, { status: 400 });
    const idBytes = Buffer.from(await file.arrayBuffer());
    const [ocr, faceResult] = await Promise.all([
      scanStaffId(file, type, name.trim()),
      facePlusPlusMode() === "enabled"
        ? compareFacePlusPlus(`data:${file.type};base64,${idBytes.toString("base64")}`, `data:${face.type};base64,${faceBytes.toString("base64")}`)
        : Promise.resolve({ status: "unavailable" as const }),
    ]);
    const identity = {
      id_front: `data:${file.type};base64,${idBytes.toString("base64")}`,
      face_front: `data:${face.type};base64,${faceBytes.toString("base64")}`,
      id_type: type,
    };
    const verified = isStaffIdentityScanVerified(ocr.outcome, faceResult.status);
    const manualTypeReviewRequired =
      type === "other" &&
      ocr.outcome === "uncertain" &&
      faceResult.status === "matched";
    return Response.json({
      ...ocr,
      face_match: faceResult.status,
      ...(verified || manualTypeReviewRequired ? { verification_token: createStaffIdentityVerificationToken(identity, name.trim()) } : {}),
      success: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not scan the ID." }, { status: 503 });
  }
}
