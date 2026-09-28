import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
  nativeOwnerKey?: string;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const binding = env as unknown as Record<string, unknown>;
  // Independent backend mode is explicitly selected by its separate launcher.
  // Never trust browser-supplied Site identity headers in that mode. The paired
  // gateway strips them and alone holds the memory-only internal binding.
  if (binding.SPT_BACKEND_MODE !== undefined) {
    const token = binding.SPT_BACKEND_SESSION_TOKEN;
    const ownerKey = binding.SPT_BACKEND_OWNER_KEY;
    const supplied = requestHeaders.get("x-spt-backend-token");
    if (binding.SPT_BACKEND_MODE !== "paired-local" || typeof token !== "string" || token.length < 32 || typeof ownerKey !== "string" || !/^native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownerKey) || !supplied) return null;
    const bytes = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", bytes.encode(token), {name:"HMAC",hash:"SHA-256"}, false, ["sign","verify"]);
    const expected = await crypto.subtle.sign("HMAC", key, bytes.encode(token));
    if (!await crypto.subtle.verify("HMAC", key, expected, bytes.encode(supplied))) return null;
    return {displayName:"SPT 교사",email:"",fullName:null,nativeOwnerKey:ownerKey};
  }
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
