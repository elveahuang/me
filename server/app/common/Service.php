<?php
declare (strict_types=1);

namespace app\common;

use think\App;
use think\Container;

abstract class Service
{

    /**
     * 应用实例
     * @var App
     */
    protected App $app;

    /**
     * Service constructor.
     * @param App $app
     */
    public function __construct(App $app)
    {
        $this->app = $app;
        $this->initialize();
    }

    /**
     * 初始化服务
     */
    protected function initialize(): void
    {
    }

    /**
     * 静态实例对象
     *
     * @param array $args
     * @return static
     */
    public static function instance(...$args): static
    {
        return Container::getInstance()->make(static::class, $args);
    }

}
