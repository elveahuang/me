<?php
declare (strict_types=1);

use app\ExceptionHandle;
use app\Request;

return [
    'think\Request' => Request::class,
    'think\exception\Handle' => ExceptionHandle::class,
];
