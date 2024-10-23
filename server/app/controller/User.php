<?php
declare (strict_types=1);

namespace app\controller;

use app\common\Constants;
use app\common\service\IdService;
use app\Controller;
use Exception;
use think\Response;

class User extends Controller
{

    /**
     * @throws Exception
     */
    public function user(): Response
    {
        $principal = $this->request->principal();
        return success([
            'id' => IdService::instance()->next(),
            'user' => $principal,
        ]);
    }

    public function register(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

    public function profile(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

}
