<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 应用设置
// +----------------------------------------------------------------------
return [
    'app_host' => env('APP_HOST', ''),
    'app_namespace' => '',
    'with_route' => true,
    'default_app' => 'app',
    'default_timezone' => 'Asia/Shanghai',
    'app_map' => [],
    'domain_bind' => [],
    'deny_app_list' => ['common'],
    'exception_tmpl' => app()->getThinkPath() . 'tpl/think_exception.tpl',
    'error_message' => '页面错误！请稍后再试～',
    'show_error_msg' => false,
];
