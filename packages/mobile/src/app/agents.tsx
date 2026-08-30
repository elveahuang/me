import { router } from 'expo-router';
import { JSX, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Agent {
    id: number;
    name: string;
    emoji: string;
    description: string;
    model: string;
}

export default function Agents(): JSX.Element {
    const { token, user, signOut } = useAuth();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const list = await api<Agent[]>('/api/agents', token);
                setAgents(list);
            } catch (e) {
                setError(e instanceof Error ? e.message : '加载失败');
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    const filtered = agents.filter((a) => a.name.includes(search.trim()));

    return (
        <View className='flex-1 bg-gray-50'>
            <View className='bg-white px-4 pt-2 pb-3'>
                <View className='flex-row items-center justify-between'>
                    <View>
                        <Text className='text-xl font-bold text-gray-900'>你好，{user?.name ?? '朋友'}</Text>
                        <Text className='text-xs text-gray-400'>选择一个智能体开始对话</Text>
                    </View>
                    <Pressable onPress={() => void signOut()} className='rounded-lg border border-gray-200 px-3 py-1.5'>
                        <Text className='text-sm text-gray-600'>退出</Text>
                    </Pressable>
                </View>
                <TextInput
                    className='mt-3 rounded-xl border border-gray-300 px-4 py-2.5 text-sm'
                    placeholder='搜索智能体'
                    value={search}
                    onChangeText={setSearch}
                />
            </View>

            {loading ? (
                <View className='flex-1 items-center justify-center'>
                    <ActivityIndicator size='large' />
                </View>
            ) : error ? (
                <View className='flex-1 items-center justify-center px-6'>
                    <Text className='text-center text-sm text-red-600'>{error}</Text>
                </View>
            ) : (
                <FlatList
                    data={filtered}
                    keyExtractor={(item) => String(item.id)}
                    contentContainerClassName='p-4 gap-3'
                    renderItem={({ item }) => (
                        <Pressable
                            className='flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-100'
                            onPress={() => router.push(`/chat/${item.id}`)}
                        >
                            <Text className='text-3xl'>{item.emoji}</Text>
                            <View className='flex-1'>
                                <Text className='text-base font-semibold text-gray-900'>{item.name}</Text>
                                <Text className='mt-0.5 text-xs text-gray-500' numberOfLines={2}>
                                    {item.description}
                                </Text>
                            </View>
                            <Text className='text-gray-300'>›</Text>
                        </Pressable>
                    )}
                    ListEmptyComponent={
                        <View className='items-center py-16'>
                            <Text className='text-sm text-gray-400'>暂无可用智能体</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}
