'use client';

/**
 * Main link-in-bio editor with side-by-side layout (D-02).
 * Desktop: form 60% left, phone preview 40% right.
 * Mobile: form only (stacked, full-width).
 * Uses useLinkInBioEditor for data and useAutoSave with 2s debounce (D-06).
 */

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LinkInBioProfile, UpdateLinkInBioProfileInput } from '@/lib/link-in-bio/types';
import { useAutoSave, type SaveState } from '../editor/hooks/use-auto-save';
import { useLinkInBioEditor } from '../editor/hooks/use-link-in-bio-editor';
import { publishPage, unpublishPage, saveProfile, saveTile, deleteTile, reorderTiles } from '@/app/actions/link-in-bio';
import { ProfileForm } from './profile-form';
import { TileList } from './tile-list';
import { PhonePreview } from './phone-preview';

const SAVE_STATE_LABELS: Record<SaveState, string | null> = {
  idle: null,
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
};

export function LinkInBioEditor() {
  const { profile, tiles, isLoading, addTile, updateTile, removeTile, reorderTiles: reorderTilesHook } = useLinkInBioEditor();
  const [activeTab, setActiveTab] = useState('profile');
  const [isPublishing, setIsPublishing] = useState(false);

  // Draft state for real-time preview updates before auto-save fires
  const [draftProfile, setDraftProfile] = useState<UpdateLinkInBioProfileInput | null>(null);

  const handleProfileChange = useCallback((data: UpdateLinkInBioProfileInput) => {
    setDraftProfile(data);
  }, []);

  // Auto-save profile changes with 2s debounce (D-06)
  const { saveState } = useAutoSave(
    draftProfile,
    async (data) => {
      if (!data || !data.slug) return;
      await saveProfile(data);
    },
    2000,
  );

  // Build a preview-friendly profile by merging draft state onto the loaded profile
  const previewProfile = useMemo((): LinkInBioProfile => {
    const base = profile ?? {
      accountId: '',
      slug: '',
      displayName: null,
      bio: null,
      heroMediaId: null,
      theme: {},
      phoneNumber: null,
      whatsappNumber: null,
      bookingUrl: null,
      menuUrl: null,
      parkingUrl: null,
      directionsUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      template: 'classic' as const,
      fontFamily: 'inter' as const,
      isPublished: false,
      createdAt: '',
      updatedAt: '',
    };

    if (!draftProfile) return base;

    return {
      ...base,
      slug: draftProfile.slug ?? base.slug,
      displayName: draftProfile.displayName ?? base.displayName,
      bio: draftProfile.bio ?? base.bio,
      theme: draftProfile.theme ?? base.theme,
      phoneNumber: draftProfile.phoneNumber ?? base.phoneNumber,
      whatsappNumber: draftProfile.whatsappNumber ?? base.whatsappNumber,
      bookingUrl: draftProfile.bookingUrl ?? base.bookingUrl,
      menuUrl: draftProfile.menuUrl ?? base.menuUrl,
      parkingUrl: draftProfile.parkingUrl ?? base.parkingUrl,
      directionsUrl: draftProfile.directionsUrl ?? base.directionsUrl,
      facebookUrl: draftProfile.facebookUrl ?? base.facebookUrl,
      instagramUrl: draftProfile.instagramUrl ?? base.instagramUrl,
      websiteUrl: draftProfile.websiteUrl ?? base.websiteUrl,
      template: draftProfile.template ?? base.template,
      fontFamily: draftProfile.fontFamily ?? base.fontFamily,
    };
  }, [profile, draftProfile]);

  const handlePublish = useCallback(async () => {
    const slug = previewProfile.slug;
    if (!slug) {
      toast.error('Please set a page slug before publishing');
      return;
    }
    setIsPublishing(true);
    try {
      if (profile?.isPublished) {
        const result = await unpublishPage(slug);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Page unpublished');
        }
      } else {
        const result = await publishPage(slug);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Page published');
        }
      }
    } catch {
      toast.error('Failed to update publish status');
    } finally {
      setIsPublishing(false);
    }
  }, [previewProfile.slug, profile?.isPublished]);

  const handleSaveTile = useCallback(async (input: Parameters<typeof saveTile>[0]) => {
    const result = await saveTile(input);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(input.id ? 'Tile updated' : 'Tile added');
    }
  }, []);

  const handleDeleteTile = useCallback(async (tileId: string) => {
    const result = await deleteTile(tileId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('Tile deleted');
    }
  }, []);

  const handleReorderTiles = useCallback(async (tileIdsInOrder: string[]) => {
    const result = await reorderTiles(tileIdsInOrder);
    if (result.error) {
      toast.error(result.error);
    }
  }, []);

  const saveLabel = SAVE_STATE_LABELS[saveState];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar with save status + publish */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Link-in-Bio Editor</h1>
          {saveLabel ? (
            <span className={`text-xs ${saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {saveLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handlePublish}
          disabled={isPublishing || !previewProfile.slug}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            profile?.isPublished
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isPublishing ? 'Processing...' : (profile?.isPublished ? 'Unpublish' : 'Publish')}
        </button>
      </div>

      {/* Side-by-side layout */}
      <div className="flex gap-6">
        {/* Form section: 60% on desktop, full-width on mobile */}
        <div className="w-full lg:w-3/5">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
              <TabsTrigger value="tiles" className="flex-1">Tiles</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-4">
              <ProfileForm
                profile={profile}
                onProfileChange={handleProfileChange}
              />
            </TabsContent>

            <TabsContent value="tiles" className="mt-4">
              <TileList
                tiles={tiles}
                onReorder={handleReorderTiles}
                onSaveTile={handleSaveTile}
                onDeleteTile={handleDeleteTile}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Phone preview: 40% on desktop, hidden on mobile */}
        <div className="hidden lg:block lg:w-2/5 sticky top-4">
          <PhonePreview
            profile={previewProfile}
            tiles={tiles}
          />
        </div>
      </div>
    </div>
  );
}
