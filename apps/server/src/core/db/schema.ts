import { numeric, uuid, varchar } from '@payloadcms/db-postgres/drizzle/pg-core';
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username'),
    displayUsername: varchar('display_username'),
    name: varchar('name'),
    email: varchar('email'),
    emailVerified: numeric('email_verified', { mode: 'number' }),
    image: varchar('image'),
    role: varchar('role'),
    banned: boolean('banned'),
    banReason: varchar('ban_reason'),
    banExpires: timestamp('ban_expires'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
});

export const accounts = pgTable('accounts', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id'),
    providerId: text('provider_id'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: text('access_token_expires_at'),
    refreshTokenExpiresAt: text('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const sessions = pgTable('sessions', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id'),
    token: text('token'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const verifications = pgTable('verifications', {
    id: uuid('id').defaultRandom().primaryKey(),
    identifier: text('identifier'),
    value: text('value'),
    expiresAt: timestamp('expires_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const jwks = pgTable('jwks', {
    id: uuid('id').defaultRandom().primaryKey(),
    publicKey: text('public_key'),
    privateKey: text('private_key'),
    expiresAt: timestamp('expires_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});
