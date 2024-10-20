-- =====================================================================================================================
-- 核心基础表
-- =====================================================================================================================

--
-- 权限表
--

DROP TABLE IF EXISTS `sys_authority`;

CREATE TABLE `sys_authority`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `parent_id`        BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'Parent ID',
    `code`             VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '编码',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `type`             VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '类型',
    `idx`              INT UNSIGNED     NOT NULL DEFAULT 999 COMMENT '序号',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_authority` PRIMARY KEY (`id`),
    INDEX `ix_sys_authority__parent_id` (`parent_id`),
    INDEX `ix_sys_authority__code` (`code`)
) COMMENT '权限表';

--
-- 角色表
--

DROP TABLE IF EXISTS `sys_role`;

CREATE TABLE `sys_role`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `type`             VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '类型',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_role` PRIMARY KEY (`id`),
    INDEX `ix_sys_role__code` (`code`)
) COMMENT '角色表';

--
-- 用户表
--

DROP TABLE IF EXISTS `sys_user`;

CREATE TABLE `sys_user`
(
    `id`                   BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `username`             VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '用户名',
    `name`                 VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '姓名',
    `display_name`         VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '昵称',
    `email`                VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '电子邮箱',
    `mobile_country_code`  VARCHAR(10)      NOT NULL DEFAULT '' COMMENT '手机国家区号',
    `mobile_number`        VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '手机号码',
    `password`             VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '密码',
    `id_card_type`         VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '证件类型',
    `id_card_no`           VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '证件号码',
    `sex`                  VARCHAR(10)      NOT NULL DEFAULT '' COMMENT '性别',
    `birthday`             VARCHAR(10)      NOT NULL DEFAULT '' COMMENT '生日',
    `description`          VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `last_login_status`    VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '最后登录状态',
    `last_login_at`        DATETIME(3) COMMENT '最后登录时间',
    `password_expire_at`   DATETIME(3) COMMENT '密码过期时间',
    `password_error_at`    DATETIME(3) COMMENT '最后一次输入错误密码的时间',
    `password_error_count` INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '输入错误密码的次数',
    `status`               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态',
    `source`               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '来源',
    `active`               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`           BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`           DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by`     BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at`     DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`           BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`           DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_user` PRIMARY KEY (`id`),
    INDEX `ix_sys_user__active` (`active`),
    INDEX `ix_sys_user__username` (`username`),
    INDEX `ix_sys_user__email` (`email`),
    INDEX `ix_sys_user__mobile` (`mobile_country_code`, `mobile_number`)
) COMMENT '用户表';

--
-- 角色-权限关联表
--

DROP TABLE IF EXISTS `sys_role_authority`;

CREATE TABLE `sys_role_authority`
(
    `id`           BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'ID',
    `role_id`      BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '角色ID',
    `authority_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '权限ID',
    `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`   DATETIME(3)     NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_role_authority` PRIMARY KEY (`id`),
    INDEX `ix_sys_role_authority__role_id` (`role_id`),
    INDEX `ix_sys_role_authority__authority_id` (`authority_id`)
) COMMENT '角色-权限关联表';

--
-- 用户-角色关联表
--

DROP TABLE IF EXISTS `sys_user_role`;

CREATE TABLE `sys_user_role`
(
    `id`         BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'ID',
    `role_id`    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '角色ID',
    `user_id`    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '用户ID',
    `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at` DATETIME(3)     NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_user_role` PRIMARY KEY (`id`),
    INDEX `ix_sys_user_role__role_id` (`role_id`),
    INDEX `ix_sys_user_role__user_id` (`user_id`)
) COMMENT '用户-角色关联表';

--
-- 用户登录会话记录
--

DROP TABLE IF EXISTS `sys_user_session`;

CREATE TABLE `sys_user_session`
(
    `id`                   BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `user_id`              BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'User ID',
    `session_id`           VARCHAR(50)      NOT NULL DEFAULT '' COMMENT 'Session ID',
    `username`             VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '用户名',
    `ip`                   VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '用户登录主机',
    `ua`                   VARCHAR(255)     NOT NULL DEFAULT '' COMMENT 'User Agent',
    `client_id`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '客户端编号',
    `client_version`       VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '客户端版本',
    `start_datetime`       DATETIME(3) COMMENT '会话开始时间',
    `start_year`           INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始年',
    `start_month`          INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始月',
    `start_day`            INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始天',
    `start_hour`           INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始时',
    `start_minute`         INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始分',
    `last_access_datetime` DATETIME(3) COMMENT '最近访问时间',
    `last_access_year`     INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始年',
    `last_access_month`    INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始月',
    `last_access_day`      INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始天',
    `last_access_hour`     INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始时',
    `last_access_minute`   INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始分',
    `end_datetime`         DATETIME(3) COMMENT '会话结束时间',
    `end_year`             INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始年',
    `end_month`            INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始月',
    `end_day`              INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始天',
    `end_hour`             INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始时',
    `end_minute`           INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '会话开始分',
    `active`               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`           BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`           DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by`     BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at`     DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`           BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`           DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_user_session` PRIMARY KEY (`id`),
    INDEX `ix_sys_user_session__user_id` (`user_id`),
    INDEX `ix_sys_user_session__session_id` (`session_id`),
    INDEX `ix_sys_user_session__username` (`username`)
) COMMENT '用户登录会话记录';

--
-- 系统设置表
--

DROP TABLE IF EXISTS `sys_config`;

CREATE TABLE `sys_config`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '参数名',
    `title`            VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `value`            VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '参数值',
    `default_value`    VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '默认值',
    `description`      VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '备注',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '数据来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_config` PRIMARY KEY (`id`),
    INDEX `ix_sys_config__code` (`code`)
) COMMENT '系统设置表';

--
-- 语言表
--

DROP TABLE IF EXISTS `sys_lang`;

CREATE TABLE `sys_lang`
(
    `id`          BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`        VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '编号',
    `title`       VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`       VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '文本',
    `lang`        VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '语言编码',
    `country`     VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '地区编码',
    `description` VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '备注',
    `default_ind` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '默认语言',
    `status`      TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态',
    `active`      TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`  BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`  DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_lang` PRIMARY KEY (`id`),
    INDEX `ix_sys_lang__code` (`code`)
) COMMENT '语言表';

--
-- 多语言文本表
--

DROP TABLE IF EXISTS `sys_label`;

CREATE TABLE `sys_label`
(
    `id`                     BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `group`                  VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '分组',
    `code`                   VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '多语言标识',
    `zh_label`               VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '简体中文',
    `zh_label_static_ind`    TINYINT          NOT NULL DEFAULT 0 COMMENT '简体中文文本是否是静态文本，不自动翻译',
    `zh_tw_label`            VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '繁体中文',
    `zh_tw_label_static_ind` TINYINT          NOT NULL DEFAULT 0 COMMENT '简体中文文本是否是静态文本，不自动翻译',
    `en_label`               VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '英语',
    `en_label_static_ind`    TINYINT          NOT NULL DEFAULT 0 COMMENT '英语文本是否是静态文本，不自动翻译',
    `active`                 TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`             BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`             DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`             BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`             DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_label` PRIMARY KEY (`id`),
    INDEX `ix_sys_label__group` (`group`),
    INDEX `ix_sys_label__code` (`code`)
) COMMENT '多语言文本表';

--
-- 实体多语言文本表
--

DROP TABLE IF EXISTS `sys_entity_label`;

CREATE TABLE `sys_entity_label`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `class_name`       VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '分组',
    `property_name`    VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '多语言标识',
    `zh_cn_label`      VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '简体中文',
    `zh_tw_label`      VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '繁体中文',
    `en_us_label`      VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '英语',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_entity_label` PRIMARY KEY (`id`),
    INDEX `ix_sys_entity_label__code` (`class_name`, `property_name`)
) COMMENT '实体多语言文本表';

--
-- 目录类型表
--

DROP TABLE IF EXISTS `sys_catalog_type`;

CREATE TABLE `sys_catalog_type`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '名称',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '发布状态',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_catalog_type` PRIMARY KEY (`id`),
    INDEX `ix_sys_catalog_type__code` (`code`)
) COMMENT '目录类型表';

--
-- 目录表
--

DROP TABLE IF EXISTS `sys_catalog`;

CREATE TABLE `sys_catalog`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `type_id`          BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '分类类型ID',
    `code`             VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '简介',
    `root_ind`         TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否顶层',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '数据来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_catalog` PRIMARY KEY (`id`),
    INDEX `ix_sys_catalog__type_id` (`type_id`),
    INDEX `ix_sys_catalog__code` (`code`)
) COMMENT '目录表';

--
-- 目录分类关联表
--

DROP TABLE IF EXISTS `sys_catalog_relation`;

CREATE TABLE `sys_catalog_relation`
(
    `id`          BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `ancestor_id` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '祖先ID',
    `entity_id`   BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '实体ID',
    `parent_ind`  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否直接上级',
    `type`        VARCHAR(50)      NOT NULL DEFAULT '' COMMENT '关联类型',
    `path`        VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '关联路径',
    `idx`         VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '关联层级',
    `created_by`  BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`  DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_catalog_relation` PRIMARY KEY (`id`),
    INDEX `ix_sys_catalog_relation__type` (`type`),
    INDEX `ix_sys_catalog_relation__ancestor_id` (`ancestor_id`),
    INDEX `ix_sys_catalog_relation__entity_id` (`entity_id`)
) COMMENT '目录分类关联表';

--
-- 字典类型表
--

DROP TABLE IF EXISTS `sys_dict_type`;

CREATE TABLE `sys_dict_type`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '备注',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '数据来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_dict_type` PRIMARY KEY (`id`)
) COMMENT '字典类型表';

--
-- 字典明细表
--

DROP TABLE IF EXISTS `sys_dict_item`;

CREATE TABLE `sys_dict_item`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `type_id`          BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '类型ID',
    `idx`              INT UNSIGNED     NOT NULL DEFAULT 999 COMMENT '序号',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '数据来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_dict_item` PRIMARY KEY (`id`),
    INDEX `ix_sys_dict_item__type_id` (`type_id`)
) COMMENT '字典明细表';

--
-- 字典关联表
--

DROP TABLE IF EXISTS `sys_dict_relation`;

CREATE TABLE `sys_dict_relation`
(
    `id`          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'ID',
    `type_id`     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '类型ID',
    `item_id`     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '明细ID',
    `target_type` VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '目标类型',
    `target_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '目标实体',
    `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`  DATETIME(3)     NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_dict_relation` PRIMARY KEY (`id`),
    INDEX `ix_sys_dict_relation__type_id` (`type_id`),
    INDEX `ix_sys_dict_relation__item_id` (`item_id`),
    INDEX `ix_sys_dict_relation__target_type` (`target_type`),
    INDEX `ix_sys_dict_relation__target_id` (`target_id`)
) COMMENT '字典关联表';

--
-- 附件类型表
--

DROP TABLE IF EXISTS `sys_attachment_type`;

CREATE TABLE `sys_attachment_type`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `label`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '文本',
    `description`      VARCHAR(250)     NOT NULL DEFAULT '' COMMENT '备注',
    `source`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '数据来源',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_attachment_type` PRIMARY KEY (`id`),
    INDEX `ix_sys_attachment_type__code` (`code`)
) COMMENT '附件类型表';

--
-- 附件文件表
--

DROP TABLE IF EXISTS `sys_attachment_file`;

CREATE TABLE `sys_attachment_file`
(
    `id`                BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `type_id`           BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '类型ID',
    `original_filename` VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '原始文件名',
    `filename`          VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '文件名',
    `size`              BIGINT           NOT NULL DEFAULT 0 COMMENT '文件大小',
    `url`               VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '文件链接',
    `extra`             VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '附加信息',
    `file_key`          VARCHAR(2000)    NOT NULL DEFAULT '' COMMENT '文件标识',
    `storage_type`      VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '文件大小',
    `access_type`       VARCHAR(100)     NOT NULL DEFAULT '' COMMENT '文件访问类型',
    `active`            TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`        BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`        DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by`  BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at`  DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`        BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`        DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_attachment_file` PRIMARY KEY (`id`),
    INDEX `ix_sys_attachment_file__type_id` (`type_id`)
) COMMENT '附件文件表';

--
-- 附件关联表
--

DROP TABLE IF EXISTS `sys_attachment_relation`;

CREATE TABLE `sys_attachment_relation`
(
    `id`          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'ID',
    `type_id`     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '类型ID',
    `entity_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件ID',
    `target_type` VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '目标类型',
    `target_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '目标实体',
    `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`  DATETIME(3)     NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_attachment_relation` PRIMARY KEY (`id`),
    INDEX `ix_sys_attachment_relation__type_id` (`type_id`),
    INDEX `ix_sys_attachment_relation__entity_id` (`entity_id`),
    INDEX `ix_sys_attachment_relation__target_type` (`target_type`),
    INDEX `ix_sys_attachment_relation__target_id` (`target_id`)
) COMMENT '附件关联表';

--
-- 系统操作日志表
--

DROP TABLE IF EXISTS `sys_operation_log`;

CREATE TABLE `sys_operation_log`
(
    `id`                    BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `class_name`            VARCHAR(250) COMMENT '类名',
    `method_name`           VARCHAR(250) COMMENT '方法名',
    `request_ip`            VARCHAR(250) COMMENT '请求IP',
    `request_ua`            VARCHAR(250) COMMENT '请求UA',
    `request_uri`           TEXT COMMENT '请求地址',
    `http_method`           VARCHAR(250) COMMENT '请求类型',
    `request_params`        TEXT COMMENT '请求参数',
    `request_header_params` TEXT COMMENT '请求头',
    `annotation_params`     TEXT COMMENT '注解参数',
    `start_time`            DATETIME(3) COMMENT '开始时间',
    `end_time`              DATETIME(3) COMMENT '结束时间',
    `exec_time`             LONG COMMENT '执行时长',
    `details`               TEXT COMMENT '日志详情',
    `exception`             TEXT COMMENT '异常信息',
    `active`                TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`            BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`            DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    CONSTRAINT `pk_sys_operation_log` PRIMARY KEY (`id`)
) COMMENT '系统操作日志表';

--
-- 宣传栏
--

DROP TABLE IF EXISTS `sys_banner`;

CREATE TABLE `sys_banner`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `idx`              INT UNSIGNED     NOT NULL DEFAULT 999 COMMENT '序号',
    `start_datetime`   DATETIME(3) COMMENT '发布开始日期',
    `end_datetime`     DATETIME(3) COMMENT '发布结束日期',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '发布状态',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_banner` PRIMARY KEY (`id`)
) COMMENT '宣传栏';

--
-- 资讯表
--

DROP TABLE IF EXISTS `sys_announcement`;

CREATE TABLE `sys_announcement`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `content`          TEXT COMMENT '内容',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `start_datetime`   DATETIME(3) COMMENT '发布开启日期',
    `end_datetime`     DATETIME(3) COMMENT '发布结束日期',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '发布状态',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_announcement` PRIMARY KEY (`id`)
) COMMENT '资讯表';

--
-- 产品表
--

DROP TABLE IF EXISTS `sys_product`;

CREATE TABLE `sys_product`
(
    `id`               BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'ID',
    `code`             VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '编号',
    `title`            VARCHAR(150)     NOT NULL DEFAULT '' COMMENT '标题',
    `content`          TEXT COMMENT '内容',
    `description`      VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '备注',
    `idx`              INT UNSIGNED     NOT NULL DEFAULT 999 COMMENT '序号',
    `start_datetime`   DATETIME(3) COMMENT '发布开启日期',
    `end_datetime`     DATETIME(3) COMMENT '发布结束日期',
    `status`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '发布状态',
    `active`           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '启用状态',
    `created_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at`       DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '创建时间',
    `last_modified_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '最后修改人',
    `last_modified_at` DATETIME(3)      NOT NULL DEFAULT NOW(3) COMMENT '最后修改时间',
    `deleted_by`       BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '删除人',
    `deleted_at`       DATETIME(3)      NULL COMMENT '删除时间',
    CONSTRAINT `pk_sys_product` PRIMARY KEY (`id`)
) COMMENT '产品表';
