# Verde Marea

Verde Marea — локальный проект системы бронирования столов средиземноморского ресторана для финального задания Яндекс Практикума. В приложении пока доступна стартовая страница. Сценарии гостей и сотрудников описаны в документации этапа 1.

Стек проекта — Next.js (App Router), React, TypeScript, Tailwind CSS v4, ESLint и npm. Окружение проверено на Node.js 24.22.2.

## Документация

- [spec.md](spec.md) — легенда, роли, правила бронирования и границы MVP.
- [design.md](design.md) — дизайн-система и визуальные критерии приёмки.
- [Plan.md](Plan.md) — этапы, зависимости и результаты проверок.
- [AGENTS.md](AGENTS.md) — правила работы с проектом.
- [prisma/README.md](prisma/README.md) — модель данных, команды миграции, seed и проверки.

## Локальный запуск

```sh
npm ci
npm run dev -- --webpack
```

Приложение доступно по адресу http://localhost:3000.

## Локальная база данных

Для миграций и демонстрационных данных нужен PostgreSQL 16 и отдельная база Verde Marea. Подставь имя своей локальной роли вместо `YOUR_DB_USER`. Если роль не может создать базу, её создаёт локальный администратор с этой ролью в качестве владельца.

```sh
createdb -h 127.0.0.1 -U YOUR_DB_USER verde_marea_dev
cp -i .env.example .env
```

Заполни `DATABASE_URL` и три переменные `SEED_*_PASSWORD` в локальном `.env`. Для пароля в URL используй percent-encoding. После установки зависимостей через `npm ci` выполни из папки проекта:

```sh
npm exec -- prisma migrate deploy
npm exec -- prisma generate
npm exec -- prisma db seed
npm exec -- prisma migrate status
```

Демонстрационные аккаунты предназначены для локальной базы. Проверка на отдельной тестовой базе описана в [документации Prisma](prisma/README.md#проверка-на-отдельной-базе).

## Проверки и production-запуск

```sh
npm run typecheck
npm run lint
npm run build -- --webpack
npm start
```

В проверенном окружении Turbopack завершает сборку с ошибкой
`binding to a port: Operation not permitted`. Команды выше используют Webpack.
