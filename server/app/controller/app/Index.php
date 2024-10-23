<?php
declare (strict_types=1);

namespace app\controller\app;

use app\common\Constants;
use app\Controller;
use app\model\User;
use think\db\exception\DataNotFoundException;
use think\db\exception\DbException;
use think\db\exception\ModelNotFoundException;
use think\Response;

class Index extends Controller
{

    /**
     * @throws ModelNotFoundException
     * @throws DataNotFoundException
     * @throws DbException
     */
    public function initialize(): Response
    {
        $user = User::find(1);
        return success([
            'version' => Constants::$version,
            'user' => $user
        ]);
    }

    public function home(): Response
    {
        return success([
            'version' => Constants::$version,
        ]);
    }

}
