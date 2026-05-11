import { Stack } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

export default function Layout() {
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

const styles = StyleSheet.create({
    logo: {
        width: 80,
        height: 24,
    },
});
