<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 路由设置
// +----------------------------------------------------------------------
if (is_file($_SERVER["DOCUMENT_ROOT"] . $_SERVER["SCRIPT_NAME"])) {
    return false;
} else {
    $_SERVER["SCRIPT_FILENAME"] = __DIR__ . '/index.php';
    require __DIR__ . "/index.php";
}
