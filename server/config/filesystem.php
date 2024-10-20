<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 文件系统设置
// +----------------------------------------------------------------------
return [
    'default' => 'local',
    'disks' => [
        'local' => [
            'type' => 'local',
            'root' => app()->getRuntimePath() . 'storage',
        ],
        'public' => [
            'type' => 'local',
            'root' => app()->getRootPath() . 'public/storage',
            'url' => '/storage',
            'visibility' => 'public',
        ],
    ],
];
