import { router } from 'expo-router';
import { JSX, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth';

export default function Register(): JSX.Element {
    const { signUp } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleRegister = async () => {
        setError(null);
        setLoading(true);
        try {
            await signUp(name.trim() || email.split('@')[0] || '用户', email.trim(), password);
            router.replace('/agents');
        } catch (e) {
            setError(e instanceof Error ? e.message : '注册失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View className='flex-1 justify-center bg-white px-6'>
            <Text className='text-3xl font-bold text-gray-900'>注册</Text>
            <Text className='mt-1 text-sm text-gray-500'>创建账号，开始与智能体对话。</Text>

            <TextInput
                className='mt-8 rounded-xl border border-gray-300 px-4 py-3 text-base'
                placeholder='昵称（可选）'
                value={name}
                onChangeText={setName}
            />
            <TextInput
                className='mt-3 rounded-xl border border-gray-300 px-4 py-3 text-base'
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
                onPress={handleRegister}
                disabled={loading}
            >
                {loading ? <ActivityIndicator color='white' /> : <Text className='text-base font-semibold text-white'>注册</Text>}
            </Pressable>

            <Pressable className='mt-4 items-center py-2' onPress={() => router.back()}>
                <Text className='text-sm text-gray-500'>
                    已有账号？<Text className='font-semibold text-blue-600'>直接登录</Text>
                </Text>
            </Pressable>
        </View>
    );
}
