export function closeMediaSwapModalAndRefresh({
  contentId,
  onClose,
  onRefresh,
  onRefreshError,
}: {
  contentId: string;
  onClose: () => void;
  onRefresh: (contentId: string) => Promise<void>;
  onRefreshError?: (error: unknown) => void;
}) {
  onClose();

  try {
    return Promise.resolve(onRefresh(contentId)).catch((error) => {
      onRefreshError?.(error);
    });
  } catch (error) {
    onRefreshError?.(error);
    return Promise.resolve();
  }
}

