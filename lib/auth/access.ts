import "server-only";

import { redirect } from "next/navigation";
import { canAccessAdministration } from "./permissions";
import { currentUser } from "./session";

type SignedInUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

type AdminAccess =
  | { allowed: true; user: SignedInUser }
  | { allowed: false; status: 401 | 403 };

export async function requireSignedInUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function checkAdminAccess(): Promise<AdminAccess> {
  const user = await currentUser();
  if (!user) return { allowed: false, status: 401 };
  if (!canAccessAdministration(user.role)) return { allowed: false, status: 403 };
  return { allowed: true, user };
}
