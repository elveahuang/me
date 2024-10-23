<?php
declare (strict_types=1);

namespace app\service;

use app\common\Model;
use app\common\Principal;
use app\common\Service;
use app\common\utils\JwtUtils;
use app\model\User;
use DateInterval;
use DateTime;
use Exception;
use think\App;
use think\facade\Log;

class AuthService extends Service
{

    /**
     * @param App $app
     */
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    /**
     * @throws Exception
     */
    public function login(array $credentials): array|null
    {
        $user = User::where('username', $credentials['username'])->findOrEmpty();
        return self::generateToken($user);
    }

    /**
     * @throws Exception
     */
    public function refresh(array $credentials): array|null
    {
        $payload = JwtUtils::parseRefreshToken($credentials['refresh_token']);
        $sid = $payload['sid'];
        $user = User::where('username', $payload['username'])->findOrEmpty();
        if ($user->isEmpty()) {
            Log::info('Failed to save UserSession sid [' . $sid . ']');
        }
        return self::generateToken($user, $sid);
    }

    /**
     * @param array $payload
     * @return Principal
     */
    public function principal(array $payload): Principal
    {
        $user = User::where('username', $payload['username'])->findOrEmpty();

        $roles = [];
        $authorities = [];
        foreach ($user->roles as $r) {
            $roles[] = $r->code;
            foreach ($r->authorities as $authority) {
                $authorities[] = $authority->code;
            }
        }

        $principal = new Principal();
        $principal->uid = $user['id'];
        $principal->username = $user['username'];
        $principal->name = $user['displayName'];
        $principal->roles = $roles;
        $principal->authorities = $authorities;
        return $principal;
    }

    /**
     * @throws Exception
     */
    public function generateToken(array|Model|User $user, string|null $sid = null): array
    {
        // 凭证标识
        $sid = $sid ?? uniqid();
        $uid = $user['id'];
        $username = $user['username'];
        // 获取当前时间
        $now = new DateTime();
        // 访问凭证，1天有效期
        $accessTokenPayload['type'] = JwtUtils::$accessToken;
        $accessTokenPayload['sid'] = $sid;
        $accessTokenPayload['uid'] = $uid;
        $accessTokenPayload['username'] = $username;
        $accessTokenPayload['exp'] = $now->add(new DateInterval('P1D'))->getTimestamp();
        // 刷新凭证，28天有效期
        $refreshTokenPayload['type'] = JwtUtils::$refreshToken;
        $refreshTokenPayload['sid'] = $sid;
        $refreshTokenPayload['uid'] = $uid;
        $refreshTokenPayload['username'] = $username;
        $refreshTokenPayload['exp'] = $now->add(new DateInterval('P28D'))->getTimestamp();

        // 保存用户会话
        try {
            UserSessionService::instance()->save($sid, $uid, $username);
        } catch (Exception $e) {
            Log::info('Failed to save UserSession sid [' . $sid . ']');
        }

        return [
            'access_token' => JwtUtils::createJwtToken($accessTokenPayload),
            'refresh_token' => JwtUtils::createJwtToken($refreshTokenPayload),
        ];
    }

}
