-- =====================================================================================================================
-- 建库
-- =====================================================================================================================

DROP DATABASE IF EXISTS `api`;

CREATE DATABASE IF NOT EXISTS `api`
    DEFAULT CHARACTER SET `utf8mb4`
    DEFAULT COLLATE `utf8mb4_0900_ai_ci`;

USE `api`;

DROP DATABASE IF EXISTS `app`;

CREATE DATABASE IF NOT EXISTS `app`
    DEFAULT CHARACTER SET `utf8mb4`
    DEFAULT COLLATE `utf8mb4_0900_ai_ci`;

USE `app`;
