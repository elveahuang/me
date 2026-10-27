/** 知识库页面共享类型。 */
export interface KnowledgeBaseItem {
    id: string;
    spaceId: string | null;
    spaceName?: string | null;
    name: string;
    description: string;
    embeddingModel: string;
    embeddingProviderId?: string | null;
    providerName?: string | null;
    documentCount: number;
    chunkCount: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface KnowledgeDocumentItem {
    id: string;
    kbId: string;
    title: string;
    chunkCount: number;
    status: string;
    createdAt: string;
}

export interface KnowledgeSearchHit {
    score: number;
    content: string;
}

/** `GET/POST /api/settings/knowledge-bases/{id}/reindex` 的任务快照（P3-3 后台重建）。 */
export interface KnowledgeReindexJob {
    kbId: string;
    kbName: string;
    status: 'running' | 'completed' | 'failed';
    ok: boolean;
    total: number;
    processed: number;
    updated: number;
    failed: number;
    lastError: string | null;
    provider: string | null;
    startedAt: string;
    finishedAt: string | null;
}
