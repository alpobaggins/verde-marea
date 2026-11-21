\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_constraint(statement text, expected_state text, expected_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    actual_name text;
BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'Expected constraint % to reject the statement', expected_name;
EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation THEN
    GET STACKED DIAGNOSTICS actual_name = CONSTRAINT_NAME;
    IF SQLSTATE <> expected_state OR actual_name <> expected_name THEN
        RAISE;
    END IF;
    RAISE NOTICE '%: passed', expected_name;
END;
$$;

DO $$
DECLARE
    owner_id uuid := gen_random_uuid();
    other_id uuid := gen_random_uuid();
    table_id uuid := gen_random_uuid();
    booking_id uuid := gen_random_uuid();
    start_at timestamptz := '2026-01-06T12:00:00+03:00';
    end_at timestamptz := start_at + INTERVAL '90 minutes';
BEGIN
    INSERT INTO "User" ("id", "email", "name", "passwordHash") VALUES
        (owner_id, owner_id || '@schema-check.invalid', 'Schema fixture', 'rollback-only'),
        (other_id, other_id || '@schema-check.invalid', 'Schema fixture', 'rollback-only');
    INSERT INTO "Table" ("id", "label", "capacity") VALUES (table_id, table_id::text, 4);
    INSERT INTO "Booking" ("id", "userId", "tableId", "startsAt", "endsAt", "guestCount", "updatedAt")
        VALUES (booking_id, owner_id, table_id, start_at, end_at, 3, now());
    INSERT INTO "Notification" ("id", "bookingId", "recipientId", "status")
        VALUES (gen_random_uuid(), booking_id, owner_id, 'pending');
    INSERT INTO "AuditLog" ("id", "actorId", "actorRole", "action", "targetType", "targetId")
        VALUES (gen_random_uuid(), owner_id, 'user', 'booking_created', 'booking', booking_id);

    IF NOT EXISTS (
        SELECT 1
        FROM "Booking" b
        JOIN "User" u ON u."id" = b."userId"
        JOIN "Table" t ON t."id" = b."tableId"
        JOIN "Notification" n ON n."bookingId" = b."id" AND n."recipientId" = u."id"
        JOIN "AuditLog" a ON a."targetId" = b."id" AND a."actorId" = u."id"
        WHERE b."id" = booking_id AND b."status" = 'pending' AND u."role" = 'user'
    ) THEN
        RAISE EXCEPTION 'Booking relations or defaults are incorrect';
    END IF;
    RAISE NOTICE 'Booking, user, table, notification and audit relations: passed';

    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Table" SET "capacity" = 0 WHERE "id" = %L', table_id
    ), '23514', 'Table_capacity_positive');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Booking" SET "guestCount" = 0 WHERE "id" = %L', booking_id
    ), '23514', 'Booking_guestCount_positive');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Booking" SET "endsAt" = "startsAt" WHERE "id" = %L', booking_id
    ), '23514', 'Booking_chronological_order');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Booking" SET "endsAt" = "startsAt" + interval ''89 minutes'' WHERE "id" = %L', booking_id
    ), '23514', 'Booking_duration_90_minutes');
    PERFORM pg_temp.expect_constraint(format(
        'INSERT INTO "AvailabilityClosure" ("id", "kind", "startsAt", "endsAt")
         VALUES (gen_random_uuid(), ''window'', %L, %L)', end_at, start_at
    ), '23514', 'AvailabilityClosure_endsAfterStart');

    PERFORM pg_temp.expect_constraint(format(
        'INSERT INTO "Booking" ("id", "userId", "tableId", "startsAt", "endsAt", "guestCount", "updatedAt")
         VALUES (gen_random_uuid(), gen_random_uuid(), %L, %L, %L, 1, now())', table_id, start_at, end_at
    ), '23503', 'Booking_userId_fkey');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Booking" SET "tableId" = gen_random_uuid() WHERE "id" = %L', booking_id
    ), '23503', 'Booking_tableId_fkey');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "Notification" SET "recipientId" = %L WHERE "bookingId" = %L', other_id, booking_id
    ), '23503', 'Notification_bookingId_recipientId_fkey');
    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "AuditLog" SET "actorId" = gen_random_uuid() WHERE "targetId" = %L', booking_id
    ), '23503', 'AuditLog_actorId_fkey');

    PERFORM pg_temp.expect_constraint(format(
        'UPDATE "User" SET "email" = %L WHERE "id" = %L', owner_id || '@schema-check.invalid', other_id
    ), '23505', 'User_email_key');
    PERFORM pg_temp.expect_constraint(format(
        'INSERT INTO "Table" ("id", "label", "capacity") VALUES (gen_random_uuid(), %L, 2)', table_id::text
    ), '23505', 'Table_label_key');
    PERFORM pg_temp.expect_constraint(format(
        'INSERT INTO "Notification" ("id", "bookingId", "recipientId", "status")
         VALUES (gen_random_uuid(), %L, %L, ''pending'')', booking_id, owner_id
    ), '23505', 'Notification_bookingId_status_key');

    INSERT INTO "AvailabilityClosure" ("id", "kind", "startsAt", "endsAt")
        VALUES (gen_random_uuid(), 'window', start_at + INTERVAL '7 days', end_at + INTERVAL '7 days');
    PERFORM pg_temp.expect_constraint(format(
        'INSERT INTO "AvailabilityClosure" ("id", "kind", "startsAt", "endsAt")
         VALUES (gen_random_uuid(), ''window'', %L, %L)', start_at + INTERVAL '7 days', end_at + INTERVAL '7 days'
    ), '23505', 'AvailabilityClosure_startsAt_endsAt_key');
END;
$$;

ROLLBACK;
