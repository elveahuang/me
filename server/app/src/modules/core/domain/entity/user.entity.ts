import { BaseEntity } from '@/commons/entity/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_user')
export class UserEntity extends BaseEntity {
    @Column({ name: 'username', comment: '用户名' })
    username: string;

    @Column({ name: 'name', comment: '全名' })
    name: string;

    @Column({ name: 'display_name', comment: '昵称' })
    displayName: string;

    @Column({ name: 'email', comment: '邮箱' })
    email: string;

    @Column({ name: 'mobile_country_code', comment: '手机区号' })
    mobileCountryCode: string;

    @Column({ name: 'mobile_number', comment: '手机号码' })
    mobileNumber: string;

    @Column({ name: 'password', comment: '密码' })
    password: string;

    @Column({ name: 'id_card_type', comment: '证件类型' })
    idCardType: string;

    @Column({ name: 'id_card_no', comment: '证件号码' })
    idCardNo: string;

    @Column({ name: 'sex', comment: '性别' })
    sex: string;

    @Column({ name: 'birthday', comment: '生日' })
    birthday: Date;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'last_login_status', comment: '最后登录状态' })
    lastLoginStatus: number;

    @Column({ name: 'last_login_at', comment: '最后登录时间' })
    lastLoginAt: Date;

    @Column({ name: 'password_expire_at', comment: '密码过期时间' })
    passwordExpireAt: Date;

    @Column({ name: 'password_error_at', comment: '密码错误时间' })
    passwordErrorAt: Date;

    @Column({ name: 'password_error_count', comment: '密码错误次数' })
    passwordErrorCount: number;

    @Column({ name: 'status', comment: '状态' })
    status: number;

    @Column({ name: 'source', comment: '来源' })
    source: number;
}
