<?php
declare (strict_types=1);

namespace app\model;

use app\common\Model;
use think\model\relation\BelongsToMany;

class User extends Model
{

    protected $table = 'sys_user';

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'sys_user_role', 'role_id', 'user_id');
    }

}
