import { router } from 'expo-router';
import { JSX, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth';

export default function Login(): JSX.Element {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            await signIn(email.trim(), password);
            router.replace('/agents');
        } catch (e) {
            setError(e instanceof Error ? e.message : '登录失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View className='flex-1 justify-center bg-white px-6'>
            <Text className='text-3xl font-bold text-gray-900'>登录</Text>
            <Text className='mt-1 text-sm text-gray-500'>与智能体对话，从这里开始。</Text>

            <TextInput
                className='mt-8 rounded-xl border border-gray-300 px-4 py-3 text-base'
                placeholder='邮箱'
                autoCapitalize='none'
                keyboardType='email-address'
                value={email}
                onChangeText={setEmail}
            />
            <TextInput
                className='mt-3 rounded-xl border border-gray-300 px-4 py-3 text-base'
                placeholder='密码（至少 8 位）'
                secureTextEntry
                value={password}
                onChangeText={setPassword}
            />

            {error ? <Text className='mt-3 text-sm text-red-600'>{error}</Text> : null}

            <Pressable
                className='mt-6 items-center rounded-xl bg-blue-600 py-3.5 active:bg-blue-700'
                onPress={handleLogin}
                disabled={loading}
            >
                {loading ? <ActivityIndicator color='white' /> : <Text className='text-base font-semibold text-white'>登录</Text>}
            </Pressable>

            <Pressable className='mt-4 items-center py-2' onPress={() => router.push('/register')}>
                <Text className='text-sm text-gray-500'>
                    还没有账号？<Text className='font-semibold text-blue-600'>立即注册</Text>
                </Text>
            </Pressable>
        </View>
    );
}
