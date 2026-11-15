export const accountText = {
  waiting: "waiting\u2026",
  waitingForYou: "waiting for you\u2026",
  notLinked: "not linked",
  connected: "connected",
  syncing: "syncing your library\u2026",
  importing: "importing\u2026",
  loading: "bringing your music over",
  reading: "reading profile and playlists",
  unknownCount: "\u2014",
  finishSignIn: (provider: string) => `finish signing in over in the ${provider.toLowerCase()} window`,
  invitation: (provider: string) => `connect ${provider.toLowerCase()} to sync your library`,
};
