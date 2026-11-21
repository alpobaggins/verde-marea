import { z } from "zod";

const password = z.string().min(1, "Введите пароль.").refine(
  (value) => Buffer.byteLength(value, "utf8") <= 72,
  "Пароль должен занимать не более 72 байт.",
);

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, "Проверьте email.").email("Введите корректный email."),
  password,
});

export const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(1, "Введите имя.").max(120, "Имя должно содержать не более 120 символов.")
    .refine((value) => !value.includes("\0"), "Проверьте имя."),
});

export type AuthFormState = {
  error?: string;
  fields?: Partial<Record<"name" | "email" | "password", string[]>>;
};
