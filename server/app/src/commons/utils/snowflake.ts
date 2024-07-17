export declare type SnowflakeOptions = {
    epoch?: bigint;
    workerId?: number;
    datacenterId?: number;
};

export class Snowflake {
    epoch: bigint = BigInt(1672502400000);
    workerId: number = 1;
    datacenterId: number = 1;
    workerIdBits: number = 5;
    maxWorkerId: number = ~(-1 << this.workerIdBits);
    datacenterIdBits: number = 5;
    maxDatacenterId: number = ~(-1 << this.datacenterIdBits);
    sequenceBits: number = 12;
    maxSequence: number = ~(-1 << this.sequenceBits);
    workerIdLeftShift: number = this.sequenceBits;
    datacenterIdLeftShift: number = this.sequenceBits + this.workerIdBits;
    timestampLeftShift: number = this.sequenceBits + this.workerIdBits + this.datacenterIdBits;
    sequence: number = 0;
    lastTimestamp: bigint = BigInt(0);

    /**
     * 构造函数
     */
    constructor(options: SnowflakeOptions) {
        if (options.epoch && options.epoch > 0) {
            this.epoch = options.epoch;
        }
        if (options.workerId && options.workerId > 0) {
            this.workerId = options.workerId;
        }
        if (options.datacenterId && options.datacenterId > 0) {
            this.datacenterId = options.datacenterId;
        }
    }

    nextId(): bigint {
        let timestamp: bigint = this.currentTimestamp();
        if (this.lastTimestamp === timestamp) {
            this.sequence = (this.sequence + 1) & this.maxSequence;
            if (this.sequence == 0) {
                timestamp = this.tilNextMillis(this.lastTimestamp);
            }
        } else {
            this.sequence = 1;
            this.lastTimestamp = timestamp;
        }
        this.lastTimestamp = timestamp;

        // 时间戳部分 | 数据中心部分 | 机器标识部分 | 序列号部分
        return BigInt(
            BigInt((timestamp - this.epoch) << BigInt(this.timestampLeftShift)) |
                BigInt(this.datacenterId << this.datacenterIdLeftShift) |
                BigInt(this.workerId << this.workerIdLeftShift) |
                BigInt(this.sequence),
        );
    }

    tilNextMillis(lastTimestamp: bigint): bigint {
        let timestamp: bigint = this.currentTimestamp();
        while (timestamp <= lastTimestamp) {
            timestamp = this.currentTimestamp();
        }
        return timestamp;
    }

    currentTimestamp(): bigint {
        return BigInt(Date.now());
    }
}
