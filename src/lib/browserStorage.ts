let storageWarningShown = false;

function warnStorageUnavailable(error: unknown): void {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn(
    "Browser storage is unavailable; session preferences may not persist.",
    error
  );
}

export function getBrowserStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error: unknown) {
    warnStorageUnavailable(error);
    return null;
  }
}

export function setBrowserStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error: unknown) {
    warnStorageUnavailable(error);
  }
}

export function removeBrowserStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (error: unknown) {
    warnStorageUnavailable(error);
  }
}
