import Schema, { ValidateError, ValidateFieldsError, Values } from 'async-validator';

export declare type ValidateErrors = ValidateError[] | null;

export declare type ValidateValues = ValidateFieldsError | Values;

export declare type ValidateResult = {
    errors: ValidateErrors;
    fields: ValidateValues;
};

export declare type FormValidateResult = {
    fields: Record<string, string>;
};

export async function validate(validator: Schema, values: Values): Promise<FormValidateResult> {
    const result = { fields: {} };
    await validator.validate(values).catch(({ errors }: ValidateResult): void => {
        if (errors) {
            // errors.forEach((error: ValidateError): void => {
            //     result.fields[error.field] = error.message;
            // });
        }
    });
    return result;
}
