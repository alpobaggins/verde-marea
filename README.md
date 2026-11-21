# Verde Marea

Локальная система бронирования столов ресторана для финального задания Яндекс Практикума.

Стек проекта — Next.js (App Router), React, TypeScript, Tailwind CSS v4, ESLint и npm. Окружение проверено на Node.js 24.22.2.

## Локальный запуск

```sh
npm ci
npm run dev -- --webpack
```

Приложение доступно по адресу http://localhost:3000.

## Проверки и production-запуск

```sh
npm run typecheck
npm run lint
npm run build -- --webpack
npm start
```

В проверенном окружении Turbopack завершает сборку с ошибкой
`binding to a port: Operation not permitted`. Команды выше используют Webpack.
