<?php
declare (strict_types=1);

namespace app\model;

use app\common\Model;
use think\model\relation\BelongsToMany;

class Role extends Model
{

    protected $table = 'sys_role';

    public function authorities(): BelongsToMany
    {
        return $this->belongsToMany(Authority::class, 'sys_role_authority', 'authority_id', 'role_id');
    }

}
