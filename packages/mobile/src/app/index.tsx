import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/lib/auth';

export default function Index() {
    const { token, loading } = useAuth();

    useEffect(() => {
        if (loading) return;
        router.replace(token ? '/agents' : '/login');
    }, [loading, token]);

    return (
        <View className='flex-1 items-center justify-center bg-white'>
            <ActivityIndicator size='large' />
        </View>
    );
}
