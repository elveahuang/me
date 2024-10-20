<?php
declare (strict_types=1);

namespace app\common\service;

use app\common\Sequence;
use app\common\Service;
use Exception;
use think\App;

class IdService extends Service
{

    /**
     * @var Sequence
     */
    protected Sequence $sequence;

    /**
     * @param App $app
     */
    public function __construct(App $app)
    {
        parent::__construct($app);

        $this->sequence = new Sequence();
    }

    /**
     * @throws Exception
     */
    public function next(): int
    {
        return $this->sequence->nextId();
    }

}
