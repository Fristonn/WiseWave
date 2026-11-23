import { isMyGo } from "mygo-runtime";
import { SpotifyAccount, YouTubeAccount, events } from "../../../mygo";
import { preloadArtworkSource } from "../../../shared/ui/Artwork";

function accountCard<Account extends { image_url: string }, Sync>(readAccount: () => Promise<Account>, readSync: () => Promise<Sync>) {
  let account: Account | null = null;
  let sync: Sync | null = null;
  let accountVersion = 0;
  let syncVersion = 0;

  const refresh = () => {
    const request = ++accountVersion;
    const syncRequest = ++syncVersion;
    void readAccount().then((result) => {
      if (request !== accountVersion) return;
      account = result;
      if (result.image_url) preloadArtworkSource(result.image_url, 72);
    }).catch(() => {});
    void readSync().then((result) => {
      if (syncRequest === syncVersion) sync = result;
    }).catch(() => {});
  };

  return {
    getAccount: () => account,
    getSync: () => sync,
    refresh,
    accountChanged(connected: boolean) {
      if (!connected) {
        account = null;
        sync = null;
      }
      refresh();
    },
    syncChanged(result: Sync) {
      syncVersion++;
      sync = result;
    },
    cancelRefresh() {
      accountVersion++;
      syncVersion++;
    },
  };
}

export const spotifyCard = accountCard(SpotifyAccount.status, SpotifyAccount.syncStatus);
export const youtubeCard = accountCard(YouTubeAccount.status, YouTubeAccount.syncStatus);

export function watchAccountCards() {
  if (!isMyGo()) return;
  const unsubscribe = [
    events.spotifyAccountChanged.on(spotifyCard.accountChanged),
    events.spotifyLibrarySyncChanged.on(spotifyCard.syncChanged),
    events.youtubeAccountChanged.on(youtubeCard.accountChanged),
    events.youtubeLibrarySyncChanged.on(youtubeCard.syncChanged),
  ];
  spotifyCard.refresh();
  youtubeCard.refresh();
  return () => {
    unsubscribe.forEach((off) => off());
    spotifyCard.cancelRefresh();
    youtubeCard.cancelRefresh();
  };
}
