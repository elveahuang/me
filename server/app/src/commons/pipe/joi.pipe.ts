import { validate } from '@/commons/utils';
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { SchemaLike } from 'joi';

@Injectable()
export class JoiValidationPipe implements PipeTransform {
    constructor(private readonly schema: SchemaLike) {}

    transform(value: any, metadata: ArgumentMetadata) {
        validate(value, this.schema);
        return value;
    }
}
