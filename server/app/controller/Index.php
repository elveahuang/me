<?php
declare (strict_types=1);

namespace app\controller;

use app\common\Constants;
use app\Controller;
use app\model\User;
use think\Response;

class Index extends Controller
{

    /**
     */
    public function initialize(): Response
    {
        $user = User::find(1);
        return success([
            'version' => Constants::$version,
            'user' => $user
        ]);
    }

    public function dashboard(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

    public function workbench(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

}
