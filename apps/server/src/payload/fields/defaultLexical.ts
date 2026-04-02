import { BoldFeature, ItalicFeature, lexicalEditor, LinkFeature, type LinkFields, ParagraphFeature, UnderlineFeature } from '@payloadcms/richtext-lexical';
import type { TextFieldSingleValidation } from 'payload';

export const defaultLexical = lexicalEditor({
    features: [
        ParagraphFeature(),
        UnderlineFeature(),
        BoldFeature(),
        ItalicFeature(),
        LinkFeature({
            enabledCollections: ['pages', 'posts'],
            fields: ({ defaultFields }) => {
                const defaultFieldsWithoutUrl = defaultFields.filter((field) => {
                    return !('name' in field && field.name === 'url');
                });

                return [
                    ...defaultFieldsWithoutUrl,
                    {
                        name: 'url',
                        type: 'text',
                        admin: {
                            condition: (_data, siblingData) => siblingData?.linkType !== 'internal',
                        },
                        label: ({ t }) => t('fields:enterURL'),
                        required: true,
                        validate: ((value, options) => {
                            if ((options?.siblingData as LinkFields)?.linkType === 'internal') {
                                return true;
                            }
                            return value ? true : 'URL is required';
                        }) as TextFieldSingleValidation,
                    },
                ];
            },
        }),
    ],
});
