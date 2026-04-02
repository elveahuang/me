import { CollectionConfig } from 'payload';
import { Accounts } from './Accounts.ts';
import { Admins } from './Admins.ts';
import { Categories } from './Categories';
import { ChatMemory } from './ChatMemory.ts';
import { Jwks } from './Jwks.ts';
import { Media } from './Media.ts';
import { Pages } from './Pages';
import { Posts } from './Posts';
import { Product } from './Product.ts';
import { Sessions } from './Sessions.ts';
import { Tags } from './Tags';
import { Users } from './Users.ts';
import { Verifications } from './Verifications.ts';

export const collections: CollectionConfig[] = [
    ChatMemory,
    Media,
    Product,
    Users,
    Admins,
    Sessions,
    Accounts,
    Verifications,
    Jwks,
    Categories,
    Tags,
    Pages,
    Posts,
];

export default collections;
