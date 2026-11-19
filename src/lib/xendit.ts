const XENDIT_API_BASE = "https://api.xendit.co";

function getSecretKey(): string {
  const key = process.env.XENDIT_TEST_SECRET_KEY?.trim();
  if (!key) throw new Error("XENDIT_TEST_SECRET_KEY is not configured.");
  return key;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${getSecretKey()}:`).toString("base64")}`;
}

export interface XenditPaymentRequest {
  payment_request_id: string;
  status: string;
  redirect_url: string | null;
}

export async function createGcashPaymentRequest(input: {
  referenceId: string;
  amount: number;
  successReturnUrl: string;
  failureReturnUrl: string;
  description?: string;
}): Promise<XenditPaymentRequest> {
  const response = await fetch(`${XENDIT_API_BASE}/v3/payment_requests`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      "api-version": "2024-11-11",
    },
    body: JSON.stringify({
      reference_id: input.referenceId,
      type: "PAY",
      country: "PH",
      currency: "PHP",
      request_amount: input.amount,
      capture_method: "AUTOMATIC",
      channel_code: "GCASH",
      channel_properties: {
        success_return_url: input.successReturnUrl,
        failure_return_url: input.failureReturnUrl,
      },
      description: input.description || "Merrylane Cafe order",
    }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : `Xendit payment request failed (${response.status}).`
    );
  }
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const redirect = actions.find(
    (action) =>
      action &&
      typeof action === "object" &&
      (action as { type?: unknown }).type === "REDIRECT_CUSTOMER"
  ) as { value?: unknown } | undefined;
  return {
    payment_request_id: String(data.payment_request_id || ""),
    status: String(data.status || ""),
    redirect_url: typeof redirect?.value === "string" ? redirect.value : null,
  };
}

export async function getGcashPaymentRequest(
  paymentRequestId: string
): Promise<{ status: string }> {
  const response = await fetch(
    `${XENDIT_API_BASE}/v3/payment_requests/${encodeURIComponent(paymentRequestId)}`,
    {
      headers: {
        Authorization: authHeader(),
        "api-version": "2024-11-11",
      },
    }
  );
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : `Xendit payment lookup failed (${response.status}).`
    );
  }
  return { status: String(data.status || "") };
}
