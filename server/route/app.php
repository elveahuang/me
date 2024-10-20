<?php
declare (strict_types=1);
// +----------------------------------------------------------------------
// | 路由设置
// +----------------------------------------------------------------------
use think\facade\Request;
use think\facade\Route;

// 首页
Route::rule('/', function () {
    if (Request::isMobile()) {
        return redirect('/mobile/');
    } else {
        return redirect('/webapp/');
    }
});
// 管理端
Route::rule('admin/:any', function () {
    return view(app()->getRootPath() . 'public/admin/index.html');
})->pattern(['any' => '\w+']);
// 移动端
Route::rule('mobile/:any', function () {
    return view(app()->getRootPath() . 'public/mobile/index.html');
})->pattern(['any' => '\w+']);
// 电脑端
Route::rule('webapp/:any', function () {
    return view(app()->getRootPath() . 'public/webapp/index.html');
})->pattern(['any' => '\w+']);
// 微信公众号
Route::any('MP_verify_<name>.txt', function ($name) {
    echo $name;
});
//
Route::rule('/auth/token', 'Auth/token');
Route::rule('/auth/logout', 'Auth/logout');
//
Route::group(function () {
    Route::get('/api/initialize', 'Index/initialize');
    Route::get('/api/user', 'User/user');
    Route::post('/api/register', 'User/register');
})->completeMatch();
//
Route::group(function () {
    Route::get('/api/home', 'home.Index/home');
})->completeMatch();
//
Route::group(function () {
    Route::get('/api/admin/workbench', 'admin.Index/workbench');
    Route::get('/api/admin/dashboard', 'admin.Index/dashboard');
})->completeMatch();
