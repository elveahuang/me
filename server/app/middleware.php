<?php
declare (strict_types=1);

use app\middleware\Application;
use app\middleware\Jwt;
use app\middleware\Logging;
use think\middleware\LoadLangPack;

return [
    Application::class,
    LoadLangPack::class,
    Logging::class,
    Jwt::class,
];
