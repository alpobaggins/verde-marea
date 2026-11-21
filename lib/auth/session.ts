import { cookies } from "next/headers";
import { findSessionUser, revokeSession } from "./service";

const secure = process.env.NODE_ENV === "production";
const cookieName = secure ? "__Host-verde_session" : "verde_session";
const cookieOptions = { httpOnly: true, sameSite: "lax", secure, path: "/" } as const;

export async function currentSessionToken() {
  return (await cookies()).get(cookieName)?.value;
}

export async function currentUser() {
  const token = await currentSessionToken();
  try {
    return await findSessionUser(token);
  } catch {
    throw new Error("Не удалось проверить сессию.");
  }
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(cookieName, token, { ...cookieOptions, expires });
}

export async function endSession() {
  const cookieStore = await cookies();
  await revokeSession(cookieStore.get(cookieName)?.value);
  cookieStore.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
}
