<?php
declare (strict_types=1);

namespace app;

use app\common\Context;
use app\common\Principal;

class Request extends \think\Request
{

    public Context $context;

    public Principal|null $principal = null;

    public function __construct()
    {
        parent::__construct();
        $this->principal = null;
    }

    public function context(): Context
    {
        return $this->context;
    }

    public function principal(): Principal|null
    {
        return $this->principal;
    }

    public function anonymous(): bool
    {
        return !isset($this->principal);
    }

    public function authenticated(): bool
    {
        return isset($this->principal);
    }

}
