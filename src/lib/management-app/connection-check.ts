import {
  getManagementEventArtwork,
  getManagementEventDetail,
  listManagementEventBookingConversions,
  listManagementEvents,
  listManagementMenuSpecials,
  type ManagementApiConfig,
} from './client';

/** Validate read capabilities without creating links, importing media or sending anything. */
export async function checkManagementConnection(config: ManagementApiConfig): Promise<string> {
  const events = await listManagementEvents(config, { limit: 1 });
  const event = events[0];
  await listManagementMenuSpecials(config);
  // A nil UUID exercises the conversion query even when there are no current events.
  await listManagementEventBookingConversions(config, {
    eventIds: [event?.id ?? '00000000-0000-0000-0000-000000000000'],
  });
  if (!event) {
    return 'Events, menu specials and booking conversions passed. Event detail and artwork could not be checked because there are no events. Advertising link creation was not tested.';
  }
  await getManagementEventDetail(config, event.id);
  const artwork = await getManagementEventArtwork(config, event.id);
  if (artwork.status !== 'ok') {
    throw new Error(artwork.status === 'unavailable' && artwork.reason === 'forbidden'
      ? 'Event artwork access failed. The API key needs read:events:artwork permission.'
      : 'Event artwork could not be checked. Check the management artwork API.');
  }
  return 'Events, event detail, artwork, menu specials and booking conversions passed. Advertising link creation was not tested.';
}
