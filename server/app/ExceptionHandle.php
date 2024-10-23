<?php
declare (strict_types=1);

namespace app;

use app\common\exceptions\AccessDeniedException;
use think\db\exception\DataNotFoundException;
use think\db\exception\ModelNotFoundException;
use think\exception\Handle;
use think\exception\HttpException;
use think\exception\HttpResponseException;
use think\exception\ValidateException;
use think\Request as BaseRequest;
use think\Response;
use Throwable;

class ExceptionHandle extends Handle
{
    protected $ignoreReport = [
        HttpException::class,
        HttpResponseException::class,
        ModelNotFoundException::class,
        DataNotFoundException::class,
        ValidateException::class,
    ];

    /**
     * @access public
     * @param Throwable $exception
     * @return void
     */
    public function report(Throwable $exception): void
    {
        parent::report($exception);
    }

    /**
     * @access public
     * @param Request|BaseRequest $request
     * @param Throwable $e
     * @return Response
     */
    public function render(Request|BaseRequest $request, Throwable $e): Response
    {
        // 访问未授权
        if ($e instanceof AccessDeniedException) {
            return error([], "访问未授权", 403);
        }
        // 参数验证错误
        if ($e instanceof ValidateException) {
            return json($e->getError(), 422);
        }
        // 请求异常
        if ($e instanceof HttpException && $request->isAjax()) {
            return response($e->getMessage(), $e->getStatusCode());
        }
        // 其他错误交给系统处理
        return parent::render($request, $e);
    }

}
