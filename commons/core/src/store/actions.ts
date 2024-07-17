import { initializeApi, InitializeApiResult } from '@commons/core/api';
import {
    loginApi,
    LoginApiParams,
    LoginApiResult,
    logoutApi,
    LogoutApiResult,
    refreshApi,
    RefreshApiResult,
    userInfoApi,
    UserInfoApiResult,
} from '@commons/core/api/auth';
import { initialize } from '@commons/core/store/app';
import { clear, setAccessToken, setRefreshToken, setUser } from '@commons/core/store/user';
import { R } from '@commons/core/types';
import { log } from '@commons/core/utils';
import type { Dispatch } from '@reduxjs/toolkit';
import { isEmpty } from 'lodash-es';

export const initializeAsync =
    () =>
    async (dispatch: Dispatch): Promise<InitializeApiResult> => {
        log(`Action initializeAsync.`);
        const response: R<InitializeApiResult> = await initializeApi();
        dispatch(initialize());
        return response.data;
    };

export const getUserInfoAsync =
    (accessToken: string) =>
    async (dispatch: Dispatch): Promise<UserInfoApiResult> => {
        log(`Action getUserInfoAsync.`);
        if (!isEmpty(accessToken)) {
            const response: R<UserInfoApiResult> = await userInfoApi();
            dispatch(setUser(response.data.user));
            return response.data;
        }
    };

export const loginAsync =
    (params: LoginApiParams) =>
    async (dispatch: Dispatch): Promise<LoginApiResult> => {
        log(`loginAsync...`);
        return new Promise<LoginApiResult>((resolve, reject): void => {
            loginApi(params)
                .then(async (result: LoginApiResult): Promise<void> => {
                    dispatch(setAccessToken(result.access_token));
                    dispatch(setRefreshToken(result.refresh_token));
                    resolve(result);
                })
                .catch((): void => {
                    reject();
                });
        });
    };

export const refreshAsync =
    () =>
    async (dispatch: Dispatch): Promise<LoginApiResult> => {
        log(`refreshAsync...`);
        return new Promise<LoginApiResult>((resolve, reject): void => {
            refreshApi()
                .then(async (result: RefreshApiResult): Promise<void> => {
                    dispatch(setAccessToken(result.access_token));
                    dispatch(setRefreshToken(result.refresh_token));
                    resolve(result);
                })
                .catch((): void => {
                    reject();
                });
        });
    };

export const logoutAsync =
    () =>
    async (dispatch: Dispatch): Promise<LogoutApiResult> => {
        log(`logoutAsync...`);
        return new Promise<LogoutApiResult>((resolve, reject): void => {
            logoutApi()
                .then(async (result: R<LogoutApiResult>): Promise<void> => {
                    dispatch(clear());
                    resolve(result);
                })
                .catch((): void => {
                    reject();
                });
        });
    };

export const clearUserAsync =
    () =>
    async (dispatch: Dispatch): Promise<void> => {
        log(`clearUserAsync...`);
        return new Promise<void>((resolve, reject): void => {
            try {
                dispatch(setAccessToken(null));
                dispatch(setRefreshToken(null));
                dispatch(setUser(null));
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    };
