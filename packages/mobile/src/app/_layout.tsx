import { Slot } from 'expo-router';
import { HeroUINativeProvider } from 'heroui-native';
import { JSX } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';

configureReanimatedLogger({
    level: ReanimatedLogLevel.warn,
    strict: false,
});

export default function Layout(): JSX.Element {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <HeroUINativeProvider>
                <KeyboardProvider>
                    <Slot />
                </KeyboardProvider>
            </HeroUINativeProvider>
        </GestureHandlerRootView>
    );
}
