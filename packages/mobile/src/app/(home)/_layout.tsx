import { Stack } from 'expo-router';
import { JSX } from 'react';
import { Platform } from 'react-native';

export default function Layout(): JSX.Element {
    return (
        <Stack
            screenOptions={{
                headerTitleAlign: 'center',
                headerTransparent: Platform.select({
                    ios: true,
                    android: false,
                }),
            }}
        >
            <Stack.Screen name='index' />
        </Stack>
    );
}
