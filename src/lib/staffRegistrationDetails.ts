export function staffRegistrationDetailsReady(name: string, email: string, contact: string, start: string, end: string): boolean {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return Boolean(name.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    Boolean(contact.trim()) && time.test(start) && time.test(end) && end > start;
}
