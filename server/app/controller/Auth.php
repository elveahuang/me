<?php
declare (strict_types=1);

namespace app\controller;

use app\common\Constants;
use app\Controller;
use app\service\AuthService;
use Exception;
use think\Response;

class Auth extends Controller
{

    /**
     * @throws Exception
     */
    public function token(): Response
    {
        $grantType = $this->request->param('grant_type');
        switch ($grantType) {
            case 'password':
                $credentials = $this->request->only([
                    'username',
                    'password',
                ]);
                return success(AuthService::instance()->login($credentials));
            case 'refresh_token':
                $credentials = $this->request->only([
                    'refresh_token',
                ]);
                return success(AuthService::instance()->refresh($credentials));
        }
        return success([
            'version' => Constants::$version,
        ]);
    }

    public function logout(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

}
