<?php
declare (strict_types=1);

namespace app\model;

use think\model\Pivot;

class UserRole extends Pivot
{

    protected $table = 'sys_user_role';

}
