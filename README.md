# Verde Marea

Verde Marea — локальный проект системы бронирования столов средиземноморского ресторана для финального задания Яндекс Практикума. В приложении пока доступна стартовая страница. Сценарии гостей и сотрудников описаны в документации этапа 1.

Стек проекта — Next.js (App Router), React, TypeScript, Tailwind CSS v4, ESLint и npm. Окружение проверено на Node.js 24.22.2.

## Документация

- [spec.md](spec.md) — легенда, роли, правила бронирования и границы MVP.
- [design.md](design.md) — дизайн-система и визуальные критерии приёмки.
- [Plan.md](Plan.md) — этапы, зависимости и результаты проверок.
- [AGENTS.md](AGENTS.md) — правила работы с проектом.

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
