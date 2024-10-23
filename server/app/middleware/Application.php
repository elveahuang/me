<?php
declare (strict_types=1);

namespace app\middleware;

use app\common\Context;
use app\Request;
use Closure;
use think\Response;

class Application
{

    /**
     * @param Request $request
     * @param Closure $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        $request->context = new Context();
        return $next($request);
    }

}
