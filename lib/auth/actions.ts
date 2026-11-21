"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loginUser, registerUser } from "./service";
import { currentUser, endSession, setSessionCookie } from "./session";
import { credentialsSchema, registrationSchema, type AuthFormState } from "./validation";

const loginError = "Неверный email или пароль.";
const retryError = "Не удалось выполнить действие. Попробуйте ещё раз.";

export async function register(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (await currentUser()) redirect(form.get("next") === "booking" ? "/booking" : "/account");

  const parsed = registrationSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { fields: z.flattenError(parsed.error).fieldErrors };

  try {
    if (!(await registerUser(parsed.data))) {
      return { fields: { email: ["Аккаунт с таким email уже зарегистрирован."] } };
    }
  } catch {
    return { error: retryError };
  }
  redirect(form.get("next") === "booking" ? "/login?registered=1&next=booking" : "/login?registered=1");
}

export async function login(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (await currentUser()) redirect(form.get("next") === "booking" ? "/booking" : "/account");

  const parsed = credentialsSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: loginError };

  try {
    const session = await loginUser(parsed.data);
    if (!session) return { error: loginError };
    await setSessionCookie(session.token, session.expiresAt);
  } catch {
    return { error: retryError };
  }
  redirect(form.get("next") === "booking" ? "/booking" : "/account");
}

export async function logout(): Promise<AuthFormState> {
  try {
    await endSession();
  } catch {
    return { error: retryError };
  }
  redirect("/login");
}
