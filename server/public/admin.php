<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 应用入口文件
// +----------------------------------------------------------------------
namespace think;

require __DIR__ . '/../vendor/autoload.php';

$http = (new App())->http;
$response = $http->name('admin')->run();
$response->send();
$http->end($response);
