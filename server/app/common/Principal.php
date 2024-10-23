<?php
declare (strict_types=1);

namespace app\common;

class Principal
{
    public string $sid;
    public int $uid;
    public string $username;
    public string $name;
    public array $roles;
    public array $authorities;
}
