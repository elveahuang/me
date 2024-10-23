<?php
declare (strict_types=1);

namespace app\middleware;

use app\common\exceptions\AccessDeniedException;
use app\Request;
use Closure;
use think\facade\Log;
use think\Response;

class Auth
{

    /**
     * @param Request $request
     * @param Closure $next
     * @param array|string|null $authority
     * @return Response
     * @throws AccessDeniedException
     */
    public function handle(Request $request, Closure $next, array|string|null $authority = null): Response
    {
        $controller = $request->controller();
        $action = $request->action();
        Log::info('Auth check controller [' . $controller . '] action [' . $action . '] start.');

        // 检查用户是否已经通过登录认证
        if ($request->anonymous()) {
            Log::info('Auth check controller [' . $controller . '] action [' . $action . '] failed. anonymous.');
            throw new AccessDeniedException();
        }

        // 路由指定权限时，检查用户是否已有指定的权限
        // 当路由未指定权限，检查用户是否已经登录
        if (isset($authority)) {
            $authorities = is_array($authority) ? $authority : [$authority];
            $authorities = array_intersect(
                array_map('strtolower', $request->principal->authorities),
                array_map('strtolower', $authorities)
            );
            $result = count($authorities) > 0;
        } else {
            $result = $request->authenticated();
        }

        if ($result) {
            Log::info('Auth check controller [' . $controller . '] action [' . $action . '] passed.');
            return $next($request);
        } else {
            Log::info('Auth check controller [' . $controller . '] action [' . $action . '] failed.');
            throw new AccessDeniedException();
        }
    }

}
