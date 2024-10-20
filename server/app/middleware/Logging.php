<?php
declare (strict_types=1);

namespace app\middleware;

use app\Request;
use Closure;
use think\Response;

class Logging
{

    /**
     * @param Request $request
     * @param Closure $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);
    }

}
