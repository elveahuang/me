<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 多语言设置
// +----------------------------------------------------------------------
return [
    'default_lang' => env('DEFAULT_LANG', 'zh-cn'),
    'allow_lang_list' => [],
    'detect_var' => 'lang',
    'use_cookie' => true,
    'cookie_var' => 'think_lang',
    'header_var' => 'think-lang',
    'extend_list' => [],
    'accept_language' => [
        'zh-hans-cn' => 'zh-cn',
    ],
    'allow_group' => false,
];
