import { apiClient } from './client';
import type { CodexEstimatorAccountDetailPayload } from '@/types';

export const quotaEstimatorApi = {
  async getCodexDetail(authIndex: string): Promise<CodexEstimatorAccountDetailPayload> {
    return apiClient.get<CodexEstimatorAccountDetailPayload>(
      `/quota-estimator/codex/${encodeURIComponent(authIndex)}`
    );
  }
};
