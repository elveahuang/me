<?php
declare (strict_types=1);

namespace app\middleware;

use app\common\utils\JwtUtils;
use app\Request;
use app\service\AuthService;
use Closure;
use Exception;
use think\facade\Log;
use think\Response;

class Jwt
{

    /**
     * @param Request $request
     * @param Closure $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        $authorization = $request->header('Authorization', '');
        if (strlen($authorization) > 0) {
            try {
                $accessToken = substr($authorization, 7);
                $payload = JwtUtils::parseAccessToken($accessToken);
                $principal = AuthService::instance()->principal($payload);
                $request->principal = $principal;
                Log::info('Jwt authorization [' . $authorization . '] user [' . $principal->username . '] auth successfully.');
            } catch (Exception $e) {
                Log::info('Jwt authorization [' . $authorization . '] auth failed.');
            }
        }
        return $next($request);
    }

}
