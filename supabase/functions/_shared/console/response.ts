const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// No body detail on error responses that cross the auth boundary — matches
// withConsoleAuth's own no-body-detail 401 posture (auth.ts).
export function errorResponse(status: number, message?: string): Response {
  if (status === 401 || status === 403) {
    return new Response(null, { status, headers: CORS_HEADERS });
  }
  return jsonResponse({ error: message ?? "error" }, status);
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
