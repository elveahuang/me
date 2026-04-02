import type { Block } from 'payload';

export const Media: Block = {
    slug: 'mediaBlock',
    interfaceName: 'MediaBlock',
    fields: [
        {
            name: 'media',
            type: 'upload',
            relationTo: 'media',
            required: true,
        },
    ],
};
