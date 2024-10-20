<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 日志设置
// +----------------------------------------------------------------------
return [
    'default' => 'file',
    'level' => [],
    'type_channel' => [],
    'close' => false,
    'processor' => null,
    'channels' => [
        'file' => [
            'type' => 'File',
            'path' => '',
            'single' => false,
            'apart_level' => [],
            'max_files' => 0,
            'json' => false,
            'processor' => null,
            'close' => false,
            'format' => '[%s][%s] %s',
            'realtime_write' => false,
        ],
    ],
];
