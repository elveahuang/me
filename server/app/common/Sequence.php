<?php
declare (strict_types=1);

namespace app\common;

use Exception;

class Sequence
{
    /**
     * 开始时间截
     * @var int
     */
    private int $epoch;
    /**
     * 机器标识所占位数
     * @var int
     */
    private int $workerIdBits;
    /**
     * 数据标识所占位数
     * @var int
     */
    private int $datacenterIdBits;
    /**
     * 机器标识最大值
     * @var int
     */
    private int $maxWorkerId;
    /**
     * 数据标识最大值
     * @var int
     */
    private int $maxDatacenterId;
    /**
     * 序列所在位数
     * @var int
     */
    private int $sequenceBits;
    /**
     * 机器标识向左移12位
     * @var int
     */
    private int $workerIdShift;
    /**
     * 数据标识向左移17位
     * @var int
     */
    private int $datacenterIdShift;
    /**
     * 时间戳左移22位
     * @var int
     */
    private int $timestampLeftShift;
    /**
     * 生成序列的掩码
     * @var int
     */
    private int $sequenceMask;
    /**
     * 机器标识
     * @var int
     */
    private int $workerId;
    /**
     * 数据标识
     * @var int
     */
    private int $datacenterId;
    /**
     * 毫秒内序列
     * @var int
     */
    private int $sequence;
    /**
     * 上次生成ID的时间截
     * @var int
     */
    private int $lastTimestamp;

    /**
     * 构造函数
     *
     * @param int $workerId 机器标识ID
     * @param int $datacenterId 数据标识ID
     * @throws Exception 异常
     */
    public function __construct(int $workerId = 1, int $datacenterId = 1)
    {
        $this->epoch = 1420041600000;
        // 机器标识所占位数
        $this->workerIdBits = 5;
        // 数据标识所占位数
        $this->datacenterIdBits = 5;
        // 根据机器标识所占位数移位计算出机器标识的最大值
        $this->maxWorkerId = -1 ^ (-1 << $this->workerIdBits);
        // 根据数据标识所占位数移位计算出数据标识的最大值
        $this->maxDatacenterId = -1 ^ (-1 << $this->datacenterIdBits);
        // 序列所占位数
        $this->sequenceBits = 12;
        // 机器标识向左移12位
        $this->workerIdShift = $this->sequenceBits;
        // 数据标识向左移17位
        $this->datacenterIdShift = $this->sequenceBits + $this->workerIdBits;
        // 时间戳左移22位
        $this->timestampLeftShift = $this->sequenceBits + $this->workerIdBits + $this->datacenterIdBits;
        // 生成序列掩码
        $this->sequenceMask = -1 ^ (-1 << $this->sequenceBits);
        // 毫秒内序列
        $this->sequence = 0;
        // 上次时间截
        $this->lastTimestamp = -1;
        if ($workerId > $this->maxWorkerId || $workerId < 0) {
            throw new Exception(sprintf("Worker Id can't be greater than %d or less than 0", $this->maxWorkerId));
        }
        if ($datacenterId > $this->maxDatacenterId || $datacenterId < 0) {
            throw new Exception(sprintf("Datacenter Id can't be greater than %d or less than 0", $this->maxDatacenterId));
        }
        $this->workerId = $workerId;
        $this->datacenterId = $datacenterId;
    }

    /**
     * 获得下一个ID
     * @throws Exception 错误
     */
    public function nextId(): int
    {
        // 获取当前时间戳
        $timestamp = $this->timeGen();
        // 如果当前时间小于上一次ID生成的时间戳，说明系统时钟回退过这个时候应当抛出异常。
        if ($timestamp < $this->lastTimestamp) {
            throw new Exception("Clock moved backwards.");
        }
        // 如果是同一时间生成的，则进行毫秒内序列。
        if ($this->lastTimestamp == $timestamp) {
            $this->sequence = ($this->sequence + 1) & $this->sequenceMask;
            // 毫秒内序列溢出
            if ($this->sequence == 0) {
                // 阻塞到下一个毫秒,获得新的时间戳
                $timestamp = $this->tilNextMillis($this->lastTimestamp);
            }
        } else {
            // 时间戳改变，毫秒内序列重置
            $this->sequence = 0;
        }
        // 上次生成ID的时间截
        $this->lastTimestamp = $timestamp;
        // 移位并通过或运算拼到一起组成64位的ID
        // 时间戳部分 | 数据中心部分 | 机器标识部分 | 序列号部分
        return (($timestamp - $this->epoch) << $this->timestampLeftShift)
            | ($this->datacenterId << $this->datacenterIdShift)
            | ($this->workerId << $this->workerIdShift)
            | $this->sequence;
    }

    /**
     * 阻塞到下一个毫秒，直到获得新的时间戳
     *
     * @param int $lastTimestamp 上次生成ID的时间截
     * @return int 当前时间戳
     */
    private function tilNextMillis(int $lastTimestamp): int
    {
        $timestamp = $this->timeGen();
        while ($timestamp <= $lastTimestamp) {
            $timestamp = $this->timeGen();
        }
        return $timestamp;
    }

    /**
     * 获取当前时间戳
     *
     * @return int 当前时间戳
     */
    private function timeGen(): int
    {
        return intval(microtime(true) * 1000);
    }

}
