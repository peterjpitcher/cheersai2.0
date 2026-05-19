'use client';

/**
 * Editor data hook for the link-in-bio page.
 * Wraps React Query for profile + tiles fetching and provides mutation wrappers
 * for upsert, tile CRUD, and reorder operations.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getLinkInBioProfileWithTiles,
  upsertLinkInBioProfile,
  createLinkInBioTile,
  updateLinkInBioTile,
  deleteLinkInBioTile,
  reorderLinkInBioTiles,
} from '@/lib/link-in-bio/profile';
import type {
  LinkInBioProfile,
  LinkInBioTile,
  UpdateLinkInBioProfileInput,
  UpsertLinkInBioTileInput,
} from '@/lib/link-in-bio/types';

const QUERY_KEY = ['link-in-bio', 'editor'] as const;

interface UseLinkInBioEditorReturn {
  profile: LinkInBioProfile | null;
  tiles: LinkInBioTile[];
  isLoading: boolean;
  updateProfile: (input: UpdateLinkInBioProfileInput) => Promise<void>;
  addTile: (input: UpsertLinkInBioTileInput) => Promise<void>;
  updateTile: (tileId: string, input: UpsertLinkInBioTileInput) => Promise<void>;
  removeTile: (tileId: string) => Promise<void>;
  reorderTiles: (tileIdsInOrder: string[]) => Promise<void>;
}

export function useLinkInBioEditor(): UseLinkInBioEditorReturn {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getLinkInBioProfileWithTiles,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  const profileMutation = useMutation({
    mutationFn: (input: UpdateLinkInBioProfileInput) => upsertLinkInBioProfile(input),
    onSuccess: invalidate,
  });

  const addTileMutation = useMutation({
    mutationFn: (input: UpsertLinkInBioTileInput) => createLinkInBioTile(input),
    onSuccess: invalidate,
  });

  const updateTileMutation = useMutation({
    mutationFn: ({ tileId, input }: { tileId: string; input: UpsertLinkInBioTileInput }) =>
      updateLinkInBioTile(tileId, input),
    onSuccess: invalidate,
  });

  const removeTileMutation = useMutation({
    mutationFn: (tileId: string) => deleteLinkInBioTile(tileId),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (tileIdsInOrder: string[]) =>
      reorderLinkInBioTiles({ tileIdsInOrder }),
    onSuccess: invalidate,
  });

  const updateProfile = useCallback(
    async (input: UpdateLinkInBioProfileInput) => {
      await profileMutation.mutateAsync(input);
    },
    [profileMutation],
  );

  const addTile = useCallback(
    async (input: UpsertLinkInBioTileInput) => {
      await addTileMutation.mutateAsync(input);
    },
    [addTileMutation],
  );

  const updateTile = useCallback(
    async (tileId: string, input: UpsertLinkInBioTileInput) => {
      await updateTileMutation.mutateAsync({ tileId, input });
    },
    [updateTileMutation],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      await removeTileMutation.mutateAsync(tileId);
    },
    [removeTileMutation],
  );

  const reorderTiles = useCallback(
    async (tileIdsInOrder: string[]) => {
      await reorderMutation.mutateAsync(tileIdsInOrder);
    },
    [reorderMutation],
  );

  return {
    profile: data?.profile ?? null,
    tiles: data?.tiles ?? [],
    isLoading,
    updateProfile,
    addTile,
    updateTile,
    removeTile,
    reorderTiles,
  };
}
