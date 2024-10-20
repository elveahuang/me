<?php
declare (strict_types=1);

namespace app\service;

use app\common\Service;
use app\model\UserSession;
use DateTime;

class UserSessionService extends Service
{

    public function save($sid, $uid, $username): void
    {
        $now = new DateTime();
        $session = UserSession::where('session_id', $sid)->findOrEmpty();
        if ($session->isEmpty()) {
            $session = new UserSession();
            $session['userId'] = $uid;
            $session['sessionId'] = $sid;
            $session['username'] = $username;
            $session['startDatetime'] = $now;
        }
        $session['lastAccessDatetime'] = $now;
        $session['host'] = request()->host();
        $session['ua'] = request()->header('user-agent');
        $session->save();
    }

}
