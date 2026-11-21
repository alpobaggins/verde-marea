"use client";

import { useActionState, useState } from "react";
import { login, logout, register } from "../lib/auth/actions";
import type { AuthFormState } from "../lib/auth/validation";

const fields = [
  { name: "name", label: "Имя", type: "text", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Пароль", type: "password", autoComplete: "current-password" },
] as const;

export function AuthForm({ registration = false, returnToBooking = false }: {
  registration?: boolean; returnToBooking?: boolean;
}) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    registration ? register : login,
    {},
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="auth-form">
      {returnToBooking && <input type="hidden" name="next" value="booking" />}
      {fields.filter((field) => registration || field.name !== "name").map((field) => {
        const errors = state.fields?.[field.name];
        const savedValue = field.name === "name"
          ? { value: name, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value) }
          : field.name === "email"
            ? { value: email, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value) }
            : {};

        return (
          <div key={field.name}>
            <label htmlFor={field.name}>{field.label}</label>
            <input
              id={field.name}
              name={field.name}
              type={field.type}
              autoComplete={registration && field.name === "password" ? "new-password" : field.autoComplete}
              required
              aria-invalid={errors ? true : undefined}
              aria-describedby={errors ? `${field.name}-error` : undefined}
              {...savedValue}
            />
            {errors && <p id={`${field.name}-error`} role="alert">{errors[0]}</p>}
          </div>
        );
      })}
      {state.error && <p role="alert">{state.error}</p>}
      <button disabled={pending}>{pending ? "Отправка…" : registration ? "Зарегистрироваться" : "Войти"}</button>
    </form>
  );
}

export function LogoutForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(logout, {});

  return (
    <form action={action} className="auth-form">
      {state.error && <p role="alert">{state.error}</p>}
      <button disabled={pending}>{pending ? "Выход…" : "Выйти"}</button>
    </form>
  );
}
