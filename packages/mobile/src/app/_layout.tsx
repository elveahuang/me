import { Stack } from 'expo-router';
import { JSX } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { AuthProvider } from '@/lib/auth';

configureReanimatedLogger({
    level: ReanimatedLogLevel.warn,
    strict: false,
});

export default function Layout(): JSX.Element {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
                <KeyboardProvider>
                    <Stack
                        screenOptions={{
                            headerTitleAlign: 'center',
                        }}
                    >
                        <Stack.Screen name='index' options={{ headerShown: false }} />
                        <Stack.Screen name='login' options={{ title: '登录', headerShown: false }} />
                        <Stack.Screen name='register' options={{ title: '注册', headerShown: false }} />
                        <Stack.Screen name='agents' options={{ title: '智能体' }} />
                        <Stack.Screen name='chat/[agentId]' options={{ title: '对话' }} />
                    </Stack>
                </KeyboardProvider>
            </AuthProvider>
        </GestureHandlerRootView>
    );
}
