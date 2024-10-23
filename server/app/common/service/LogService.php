<?php
declare (strict_types=1);

namespace app\common\service;

use app\common\Service;
use think\App;
use think\facade\Log;

class LogService extends Service
{

    /**
     * @param App $app
     */
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function log($user): void
    {
        Log::info('Current controller - ' . request()->controller() . ' , action - ' . request()->action());
    }

}
