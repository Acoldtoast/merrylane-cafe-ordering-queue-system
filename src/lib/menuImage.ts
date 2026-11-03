const MAX_MENU_IMAGE_BYTES = 1_000_000;
const MAX_MENU_IMAGE_URL_LENGTH = 1_500_000;
const MENU_IMAGE_DATA_URL =
  /^data:image\/(jpeg|png|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4}))$/;

export function menuImageValidationError(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    return "Menu image must be a secure image URL or an uploaded JPEG, PNG, or WebP.";
  }
  if (value.length > MAX_MENU_IMAGE_URL_LENGTH) {
    return "Menu image must be smaller than 1 MB.";
  }

  if (value.startsWith("data:")) {
    const match = MENU_IMAGE_DATA_URL.exec(value);
    if (!match) {
      return "Menu images must be JPEG, PNG, or WebP.";
    }

    const base64Length = match[2].length;
    const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
    if ((base64Length * 3) / 4 - padding > MAX_MENU_IMAGE_BYTES) {
      return "Menu image must be smaller than 1 MB.";
    }
    return null;
  }

  if (
    value.length > 2048 ||
    (!value.startsWith("https://") &&
      !(value.startsWith("/") && !value.startsWith("//")))
  ) {
    return "Menu image must be a secure image URL or an uploaded JPEG, PNG, or WebP.";
  }
  return null;
}
