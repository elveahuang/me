<?php
declare (strict_types=1);

namespace app\common\utils;

use Exception;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * JwtUtils
 */
class JwtUtils
{

    public static string $accessToken = 'accessToken';

    public static string $refreshToken = 'refreshToken';

    public static string $key = 'application';

    public static string $alg = 'HS256';

    /**
     * 新建登陆凭证
     *
     * @param array $token 登陆凭证
     * @return string
     * @throws Exception
     */
    public static function createJwtToken(array $token): string
    {
        return JWT::encode($token, self::$key, self::$alg);
    }

    /**
     * 解析登陆凭证
     *
     * @param string $token
     * @return object
     */
    public static function parseJwtToken(string $token): object
    {
        return JWT::decode($token, new Key(self::$key, self::$alg));
    }

    /**
     * 解析访问凭证
     *
     * @param string $token
     * @return mixed
     */
    public static function parseAccessToken(string $token): array
    {
        $result = JwtUtils::parseJwtToken($token);
        return [
            'id' => $result->uid,
            'username' => $result->username
        ];
    }

    /**
     * 解析刷新凭证
     *
     * @param string $token
     * @return mixed
     */
    public static function parseRefreshToken(string $token): array
    {
        $result = JwtUtils::parseJwtToken($token);
        return [
            'sid' => $result->sid,
            'uid' => $result->uid,
            'username' => $result->username
        ];
    }

}
