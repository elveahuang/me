<?php
declare (strict_types=1);

use think\Response;

function success(array|string|bool|null $data = [], $msg = 'SUCCESS', int $code = 200): Response
{
    if (is_array($msg)) {
        $data = $msg;
        $msg = 'SUCCESS';
    }
    return Response::create(['data' => $data, 'msg' => $msg, 'code' => $code], 'json', $code);
}

function fail(array|string|bool|null $data = [], $msg = 'Fail', int $code = 200): Response
{
    if (is_array($msg)) {
        $data = $msg;
        $msg = 'SUCCESS';
    }
    return Response::create(['data' => $data, 'msg' => $msg, 'code' => $code], 'json', $code);
}

function error(array|string|bool|null $data = [], $msg = 'Error', int $code = 200): Response
{
    if (is_array($msg)) {
        $data = $msg;
        $msg = 'SUCCESS';
    }
    return Response::create(['data' => $data, 'msg' => $msg, 'code' => $code], 'json', $code);
}
