-- =====================================================================================================================
-- 基础数据
-- =====================================================================================================================

--
-- 角色
--

truncate sys_role;

insert into sys_role (`id`, `code`, `title`, `label`, `source`, `active`, `created_at`, `created_by`)
values (1, 'SYSTEM_ADMINISTRATOR', 'System Administrator', 'label_role_system_administrator', 1, 1, now(), 1),
       (2, 'ADMINISTRATOR', 'Administrator', 'label_role_administrator', 1, 1, now(), 1),
       (3, 'USER', 'Principal', 'label_role_user', 1, 1, now(), 1);

--
-- 内置用户
--

truncate sys_user;

insert into sys_user (`id`, `username`, `email`, `mobile_country_code`, `mobile_number`,
                      `display_name`, `active`, `created_at`, `password`)
values (1, 'admin', 'me@elvea.cn', '0086', '13500000000', 'Administrator', 1, now(),
        '$2a$10$MLkjYEPJkO6KNrfUUBld6eWVr1G09nugg5UpIQVUtsQ.3Z9U2lOSK');

--
-- 内置用户关联数据
--

truncate sys_user_role;

insert into sys_user_role (`id`, `user_id`, `role_id`, `created_at`)
values (1, 1, 1, now()),
       (2, 1, 2, now()),
       (3, 1, 3, now());

--
-- 语言类型
--

truncate sys_lang;

insert into sys_lang (`id`, `code`, `lang`, `country`, `label`, `description`, `default_ind`, `active`)
values (1, 'zh_cn', 'zh', 'cn', 'label_lang_zh_cn', '简体中文', 1, 1),
       (2, 'zh_tw', 'zh', 'tw', 'label_lang_zh_tw', '繁体中文', 0, 1),
       (3, 'en_us', 'en', 'us', 'label_lang_en_us', '美式英语', 0, 1);

--
-- 权限
--

truncate sys_authority;

insert into sys_authority (`id`, `parent_id`, `code`, `title`, `label`, `type`, `idx`, `active`)
values
    /* -------------------------------------------------------------------------------------------------------------- */
    /* 工作台 */
    /* -------------------------------------------------------------------------------------------------------------- */
    (1001000000, 0, 'workbench', '工作台', 'authority_workbench', 'CATALOG', 1, 1),
    /* -------------------------------------------------------------------------------------------------------------- */
    /* 站点管理 */
    /* -------------------------------------------------------------------------------------------------------------- */
    (1002000000, 0, 'site', '站点', 'authority_site', 'CATALOG', 2, 1),
    /* 公告管理 */
    (1002001000, 1002000000, 'site:announcement', '公告管理', 'authority_site_product', 'MENU', 1, 1),
    (1002001001, 1002001000, 'site:announcement:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1002001002, 1002001000, 'site:announcement:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1002001003, 1002001000, 'site:announcement:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1002001004, 1002001000, 'site:announcement:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* 产品管理 */
    (1002002000, 1002000000, 'site:product', '产品管理', 'authority_site_product', 'MENU', 1, 1),
    (1002002001, 1002002000, 'site:product:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1002002002, 1002002000, 'site:product:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1002002003, 1002002000, 'site:product:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1002002004, 1002002000, 'site:product:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* -------------------------------------------------------------------------------------------------------------- */
    /* 资源管理 */
    /* -------------------------------------------------------------------------------------------------------------- */
    (1003000000, 0, 'resource', '资源管理', 'authority_resource', 'CATALOG', 97, 1),
    /* 字典管理 */
    (1003001000, 1003000000, 'resource:dictionary', '字典管理', 'authority_resource_dictionary', 'MENU', 1, 1),
    (1003001001, 1003001000, 'resource:dictionary:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1003001002, 1003001000, 'resource:dictionary:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1003001003, 1003001000, 'resource:dictionary:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1003001004, 1003001000, 'resource:dictionary:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* 附件管理 */
    (1003002000, 1003000000, 'resource:attachment', '附件管理', 'authority_resource_attachment', 'MENU', 4, 1),
    (1003002001, 1003002000, 'resource:attachment:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1003002002, 1003002000, 'resource:attachment:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1003002003, 1003002000, 'resource:attachment:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1003002004, 1003002000, 'resource:attachment:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* -------------------------------------------------------------------------------------------------------------- */
    /* 组织架构 */
    /* -------------------------------------------------------------------------------------------------------------- */
    (1004000000, 0, 'organization', '组织架构', 'authority_organization', 'CATALOG', 96, 1),
    /* 用户管理 */
    (1004001000, 1004000000, 'organization:user', '用户管理', 'authority_organization_user', 'MENU', 3, 1),
    (1004001001, 1004001000, 'organization:user:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1004001002, 1004001000, 'organization:user:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1004001003, 1004001000, 'organization:user:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1004001004, 1004001000, 'organization:user:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    (1004001005, 1004001000, 'organization:user:import', '导入', 'authority_import', 'RESOURCE', 1, 1),
    (1004001006, 1004001000, 'organization:user:export', '导出', 'authority_export', 'RESOURCE', 1, 1),
    /* -------------------------------------------------------------------------------------------------------------- */
    /* 系统设置 */
    /* -------------------------------------------------------------------------------------------------------------- */
    (1005000000, 0, 'system', '系统', 'authority_system', 'CATALOG', 99, 1),
    /* 权限管理 */
    (1005001000, 1005000000, 'system:authority', '权限管理', 'authority_system_authority', 'MENU', 1, 1),
    (1005001001, 1005001000, 'system:authority:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1005001002, 1005001000, 'system:authority:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    /* 角色管理 */
    (1005002000, 1005000000, 'system:role', '角色管理', 'authority_system_role', 'MENU', 2, 1),
    (1005002001, 1005002000, 'system:role:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1005002002, 1005002000, 'system:role:add', '添加', 'authority_add', 'RESOURCE', 1, 1),
    (1005002003, 1005002000, 'system:role:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    (1005002004, 1005002000, 'system:role:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* 系统设置 */
    (1005003000, 1005000000, 'system:setting', '系统设置', 'authority_system_setting', 'MENU', 3, 1),
    (1005003001, 1005003000, 'system:setting:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1005003002, 1005003000, 'system:setting:edit', '编辑', 'authority_edit', 'RESOURCE', 1, 1),
    /* 在线用户 */
    (1005004000, 1005000000, 'system:user', '在线用户', 'authority_system_user', 'MENU', 4, 1),
    (1005004001, 1005004000, 'system:user:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1005004002, 1005004000, 'system:user:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1),
    /* 系统日志 */
    (1005005000, 1005000000, 'system:logging', '系统日志', 'authority_system_logging', 'MENU', 5, 1),
    (1005005001, 1005005000, 'system:logging:view', '查看', 'authority_view', 'RESOURCE', 1, 1),
    (1005005002, 1005005000, 'system:logging:delete', '删除', 'authority_delete', 'RESOURCE', 1, 1);

--
-- 角色权限关联
--

truncate sys_role_authority;

insert into sys_role_authority (`id`, `role_id`, `authority_id`, `created_at`)
select concat(rpad(sr.id, 3, 0), rpad(sa.id, 10, 0)), sr.id, sa.id, now()
from sys_role sr,
     sys_authority sa
where sr.id = 1;

--
-- 系统设置项
--

truncate sys_config;

insert into sys_config (`id`, `code`, `value`, `label`, `description`, `active`)
values (1, 'APP_TITLE', 'Application', 'label_config_site_title', '站点标题', 1),
       (2, 'APP_COPYRIGHT', 'Copyright@2023', 'label_config_site_copyright', '站点版权信息', 1),
       (3, 'LOGIN_CAPTCHA_ENABLED', 'true', 'label_config_login_captcha_enabled', '是否启用登录验证码', 1);

-- =====================================================================================================================
-- 多语言
-- =====================================================================================================================
truncate sys_label;

insert into sys_label (`id`, `code`, `zh_label`, `en_label`)
values (10010010001, 'label_lang_type__zh_cn', '简体中文', 'Simplified Chinese'),
       (10010010002, 'label_lang_type__zh_tw', '繁体中文', 'Traditional Chinese'),
       (10010010003, 'label_lang_type__en_us', '英文', 'English'),
       (10010020001, 'label_mobile_country_code__0085', '中国', 'China'),
       (10010020002, 'label_mobile_country_code__00852', '中国香港', 'Hong Kong'),
       (10010020003, 'label_mobile_country_code__00886', '中国台湾', 'Taiwan'),
       (10010020004, 'label_mobile_country_code__00853', '中国澳门', 'Macao'),
       (20010000001, 'label__ok', 'OK', 'OK'),
       (20010000002, 'label__delete', '删除', 'Delete'),
       (20010000003, 'label__save', '保存', 'Save'),
       (20010000004, 'label__reset', '重置', 'Reset'),
       (20010000005, 'label__submit', '提交', 'Submit'),
       (20010000006, 'label__add', '添加', 'Add'),
       (20010000007, 'label__edit', '编辑', 'Edit'),
       (20010000008, 'label__remove', '移除', 'Remove'),
       (20020000001, 'label__id', 'ID', 'ID'),
       (20020000002, 'label__code', '编号', 'Code'),
       (20020000003, 'label__title', '标题', 'Title'),
       (20020000004, 'label__name', '名称', 'Name'),
       (20020000005, 'label__description', '描述说明', 'Description'),
       (30010000001, 'label__x', '占位', '占位');
