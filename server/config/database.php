<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 数据库设置
// +----------------------------------------------------------------------
return [
    'default' => env('DB_DRIVER', 'mysql'),
    'time_query_rule' => [],
    'auto_timestamp' => true,
    'datetime_format' => 'Y-m-d H:i:s',
    'datetime_field' => '',
    'connections' => [
        'mysql' => [
            'type' => env('DB_TYPE', 'mysql'),
            'hostname' => env('DB_HOST', '127.0.0.1'),
            'database' => env('DB_NAME', 'cms'),
            'username' => env('DB_USER', 'root'),
            'password' => env('DB_PASS', 'root'),
            'hostport' => env('DB_PORT', '3306'),
            'params' => [],
            'charset' => env('DB_CHARSET', 'utf8'),
            'prefix' => env('DB_PREFIX', ''),
            'deploy' => 0,
            'rw_separate' => false,
            'master_num' => 1,
            'slave_no' => '',
            'fields_strict' => true,
            'break_reconnect' => false,
            'trigger_sql' => env('APP_DEBUG', true),
            'fields_cache' => false,
        ],
    ],
];
