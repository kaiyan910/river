import type { Permission } from '@river/auth';
import {
  type CreateParticipantInput,
  directorySchema,
  importParticipantsResultSchema,
  invitationSchema,
  type Participant,
  participantListSchema,
  participantSchema,
  roleDirectorySchema,
  roleListSchema,
  roleSchema,
} from '@river/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { meQueryOptions } from '@/lib/me';

export const participantsQueryOptions = queryOptions({
  queryKey: ['participants'],
  queryFn: () => api('/participants', { schema: participantListSchema }),
});

/** 挑選人員用的精簡名錄（例如 Designer 指派審批人）。 */
export const directoryQueryOptions = queryOptions({
  queryKey: ['participants', 'directory'],
  queryFn: () => api('/participants/directory', { schema: directorySchema }),
  staleTime: 60_000,
});

/** 挑選 Role 用的精簡清單（Designer 把人工步驟指派給 Role）。 */
export const roleDirectoryQueryOptions = queryOptions({
  queryKey: ['roles', 'directory'],
  queryFn: () => api('/roles/directory', { schema: roleDirectorySchema }),
  staleTime: 60_000,
});

export const rolesQueryOptions = queryOptions({
  queryKey: ['roles'],
  queryFn: () => api('/roles', { schema: roleListSchema }),
});

export const invitationQueryOptions = (token: string) =>
  queryOptions({
    queryKey: ['invitation', token],
    queryFn: () => api(`/invitations/${encodeURIComponent(token)}`, { schema: invitationSchema }),
    retry: false,
  });

/** 以伺服器回傳的最新資料取代清單中的那一筆。 */
function useReplaceParticipant() {
  const queryClient = useQueryClient();
  return (updated: Participant) =>
    queryClient.setQueryData<Participant[]>(participantsQueryOptions.queryKey, (list) =>
      list?.map((p) => (p.id === updated.id ? updated : p)),
    );
}

export function useCreateParticipant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateParticipantInput) =>
      api('/participants', { method: 'POST', body: input, schema: participantSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: participantsQueryOptions.queryKey }),
  });
}

/** CSV 匯入：回傳成功匯入的人與失敗的行（行號與原因）。 */
export function useImportParticipants() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) =>
      api('/participants/import', {
        method: 'POST',
        body: { csv },
        schema: importParticipantsResultSchema,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: participantsQueryOptions.queryKey }),
  });
}

export function useSetManager() {
  const replace = useReplaceParticipant();
  return useMutation({
    mutationFn: ({ id, managerId }: { id: string; managerId: string | null }) =>
      api(`/participants/${id}`, {
        method: 'PATCH',
        body: { managerId },
        schema: participantSchema,
      }),
    onSuccess: replace,
  });
}

export function useSetPermissions(meId: string) {
  const replace = useReplaceParticipant();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: Permission[] }) =>
      api(`/participants/${id}/permissions`, {
        method: 'PUT',
        body: { permissions },
        schema: participantSchema,
      }),
    onSuccess: async (updated) => {
      replace(updated);
      // 改到自己的 Permission 時，導覽列也要跟著更新。
      if (updated.id === meId)
        await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
    },
  });
}

export function useResendInvitation() {
  return useMutation({
    mutationFn: (id: string) => api(`/participants/${id}/invitation`, { method: 'POST' }),
  });
}

function useRoleMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: rolesQueryOptions.queryKey }),
        // 人員清單帶有每個人所屬的 Role。
        queryClient.invalidateQueries({ queryKey: participantsQueryOptions.queryKey }),
      ]),
  });
}

export function useCreateRole() {
  return useRoleMutation((name: string) =>
    api('/roles', { method: 'POST', body: { name }, schema: roleSchema }),
  );
}

export function useRenameRole() {
  return useRoleMutation(({ id, name }: { id: string; name: string }) =>
    api(`/roles/${id}`, { method: 'PATCH', body: { name }, schema: roleSchema }),
  );
}

export function useAddRoleMember() {
  return useRoleMutation(({ roleId, participantId }: { roleId: string; participantId: string }) =>
    api(`/roles/${roleId}/members/${participantId}`, { method: 'PUT' }),
  );
}

export function useRemoveRoleMember() {
  return useRoleMutation(({ roleId, participantId }: { roleId: string; participantId: string }) =>
    api(`/roles/${roleId}/members/${participantId}`, { method: 'DELETE' }),
  );
}
