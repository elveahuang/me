import type { CollectionConfig } from 'payload';

export const Users: CollectionConfig = {
    slug: 'users',
    admin: {
        useAsTitle: 'email',
    },
    fields: [
        {
            name: 'email',
            type: 'text',
            required: true,
            unique: true,
        },
        {
            name: 'username',
            type: 'text',
            required: false,
            unique: true,
        },
        {
            name: 'name',
            type: 'text',
            required: false,
        },
        {
            name: 'displayUsername',
            type: 'text',
            required: false,
        },
        {
            name: 'emailVerified',
            type: 'checkbox',
            required: false,
            defaultValue: false,
        },
        {
            name: 'image',
            type: 'text',
            required: false,
        },
        {
            name: 'role',
            type: 'text',
            required: false,
        },
        {
            name: 'banned',
            type: 'checkbox',
            required: false,
            defaultValue: false,
        },
        {
            name: 'banReason',
            type: 'text',
            required: false,
        },
        {
            name: 'banExpires',
            type: 'date',
            required: false,
        },
    ],
};
