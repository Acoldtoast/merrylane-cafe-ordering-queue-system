import { detectCardType } from "./staffIdCardType";
import { extractStaffIdSuggestions } from "./staffIdExtract";

/** OCR output is untrusted evidence, not proof that a document is genuine. */
export async function scanStaffId(image: Blob, selectedType: string, expectedName = "") {
  const key = process.env.OCR_SPACE_API_KEY?.trim();
  if (!key) throw new Error("OCR.space is not configured.");
  const form = new FormData();
  form.append("file", image, image.type === "image/png" ? "id.png" : "id.jpg");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");
  let response: Response;
  try {
    response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST", headers: { apikey: key }, body: form,
      cache: "no-store", signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error("Could not reach OCR.space. Please try again.");
  }
  if (!response.ok) throw new Error("OCR.space could not process the image. Check the service configuration and quota.");
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("OCR.space returned an invalid response.");
  const payload = data as Record<string, unknown>;
  const results = payload.ParsedResults;
  if (payload.IsErroredOnProcessing === true || !Array.isArray(results) || !results[0] || typeof results[0].ParsedText !== "string") throw new Error("OCR.space could not read the ID image.");
  const text = results[0].ParsedText.slice(0, 30000);
  const detected = detectCardType(text);
  const words = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const nameWords = words(expectedName).filter((word) => word.length > 1);
  const textWords = new Set(words(text));
  // OCR text can include addresses and other names; this is evidence only,
  // not a reliable extracted-name match or a reason to approve an account.
  const name_evidence = nameWords.length >= 2 && nameWords.every((word) => textWords.has(word)) ? "found" : "uncertain";
  const expected = selectedType === "drivers_license" ? "lto_license" : selectedType === "voter" ? "voters" : selectedType;
  const outcome = detected.confidence === "high" && detected.type
    ? detected.type === expected ? "match" : "mismatch"
    : "uncertain";
  return { outcome, detected_type: detected.confidence === "high" ? detected.type : null, name_evidence, suggestions: extractStaffIdSuggestions(text) };
}
