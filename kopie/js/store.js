// Kiest waar het spel wordt bewaard: op de server als er een api.php draait
// (de gehoste versie), anders in de browser zelf (de lokale versie).
import * as lokaal from './store-local.js';
import * as server from './store-server.js';

let impl = lokaal;
export let opServer = false;

/**
 * @returns {Promise<{server: boolean, inloggenNodig: boolean, melding?: string}>}
 */
export async function connect() {
  const info = await server.status();
  if (!info) return { server: false, inloggenNodig: false };
  impl = server;
  opServer = true;
  if (!info.beveiligd) {
    return { server: true, inloggenNodig: true, melding: 'Stel eerst een wachtwoord in in config.php.' };
  }
  return { server: true, inloggenNodig: !info.ingelogd };
}

export async function login(wachtwoord) {
  await server.login(wachtwoord);
}

export async function logout() {
  await server.logout();
}

/** @returns {Promise<{game: object|undefined, rev: number}>} */
export async function loadGame() {
  if (opServer) return server.loadGame();
  return { game: await lokaal.getMeta('game'), rev: 0 };
}

/** @returns {Promise<{ok?: true, conflict?: true, game?: object, rev: number}>} */
export async function saveGame(game, rev, force = false) {
  if (opServer) return server.saveGame(game, rev, force);
  await lokaal.setMeta('game', game);
  return { ok: true, rev: 0 };
}

export async function getRev() {
  return opServer ? server.getRev() : 0;
}
export const getPhoto = (id) => impl.getPhoto(id);
export const putPhoto = (id, blob) => impl.putPhoto(id, blob);
export const deletePhoto = (id) => impl.deletePhoto(id);
export const photoIds = () => impl.photoIds();

// Bekijk-link: bestaat alleen bij opslag op de server.
export const shareToken = () => server.shareToken();
export const newShareToken = () => server.newShareToken();
export const stopSharing = () => server.stopSharing();
