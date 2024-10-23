<?php
declare (strict_types=1);

namespace app\common;

use app\common\service\IdService;
use Exception;
use think\Model as BaseModel;

class Model extends BaseModel
{
    protected $convertNameToCamel = true;
    protected $pk = 'id';
    protected $createTime = 'createdAt';
    protected $updateTime = 'lastModifiedAt';

    /**
     * @throws Exception
     */
    public static function onBeforeInsert(BaseModel $model): void
    {
        $model->set($model->getPk(), IdService::instance()->next());
    }

}
