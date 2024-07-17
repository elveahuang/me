import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CredentialsDto {
    @ApiProperty({ description: '账号' })
    @IsString({ message: 'account 类型错误' })
    @IsNotEmpty({ message: '账号不能为空' })
    readonly grant_type: string;

    @ApiProperty({ description: '账号' })
    @IsString({ message: 'account 类型错误' })
    @IsNotEmpty({ message: '账号不能为空' })
    readonly username?: string;

    @ApiProperty({ description: '密码' })
    @IsString({ message: 'password 类型错误' })
    @IsNotEmpty({ message: '密码不能为空' })
    readonly password?: string;

    @ApiProperty({ description: '密码' })
    @IsString({ message: 'password 类型错误' })
    @IsNotEmpty({ message: '密码不能为空' })
    readonly refresh_token?: string;
}
