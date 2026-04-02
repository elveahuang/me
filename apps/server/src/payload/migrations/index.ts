import * as migration_20260131_034051 from './20260131_034051';
import * as migration_20260329_123840 from './20260329_123840';

export const migrations = [
    {
        up: migration_20260131_034051.up,
        down: migration_20260131_034051.down,
        name: '20260131_034051',
    },
    {
        up: migration_20260329_123840.up,
        down: migration_20260329_123840.down,
        name: '20260329_123840',
    },
];
