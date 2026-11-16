export const MAX_AUTOMATIC_EMAIL_ATTEMPTS = 3;
export const FIRST_EMAIL_RETRY_DELAY_MINUTES = 5;

export function shouldRetryEmailAutomatically(
  attempts: number,
  transient: boolean
): boolean {
  return transient && attempts < MAX_AUTOMATIC_EMAIL_ATTEMPTS;
}
