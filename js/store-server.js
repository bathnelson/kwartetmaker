// Opslag op de server (api.php). Zelfde functies als store-local.js, zodat de
// app niet hoeft te weten waar het spel staat.
const API = 'api.php';

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Webhosts remmen af als er veel verzoeken vlak achter elkaar komen (429 "Too
// Many Requests", soms 503), bijvoorbeeld bij een back-up of printvellen met
// tientallen foto's. Dan even wachten en opnieuw proberen: eerst 1 s, dan 2, 4,
// 8 en 15 s - of zo lang als de server zelf aangeeft (Retry-After).
export async function vraag(url, options = {}, pogingen = 6) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    if ((res.status !== 429 && res.status !== 503) || i >= pogingen - 1) return res;
    const opgegeven = Number(res.headers.get('Retry-After'));
    await wacht(opgegeven > 0 ? opgegeven * 1000 : Math.min(1000 * 2 ** i, 15000) + Math.random() * 300);
  }
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.fout || `Server gaf ${res.status}`);
  return data;
}

/** Draait hier een api.php? Zo ja: is er al ingelogd? */
export async function status() {
  try {
    const res = await vraag(`${API}?actie=ping`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.server ? data : null;
  } catch (e) {
    return null;                       // geen php (bijv. de lokale python-server)
  }
}

export async function login(wachtwoord) {
  const res = await vraag(`${API}?actie=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wachtwoord }),
  });
  return json(res);
}

export async function logout() {
  await vraag(`${API}?actie=logout`, { method: 'POST' });
}

/** Het spel plus het versienummer dat de server erbij bijhoudt. */
export async function loadGame() {
  const data = await json(await vraag(`${API}?actie=spel`));
  return { game: data.spel || undefined, rev: data.rev || 0 };
}

/**
 * Slaat op als niemand anders intussen iets heeft veranderd (rev klopt nog).
 * Anders: { conflict: true, game, rev } met de actuele versie van de server.
 */
export async function saveGame(game, rev, force = false) {
  const res = await vraag(`${API}?actie=spel&rev=${rev}${force ? '&force=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game),
  });
  if (res.status === 409) {
    const data = await res.json();
    return { conflict: true, game: data.spel || undefined, rev: data.rev };
  }
  const data = await json(res);
  return { ok: true, rev: data.rev };
}

export async function getRev() {
  const data = await json(await vraag(`${API}?actie=rev`));
  return data.rev || 0;
}

export async function getPhoto(id) {
  const res = await vraag(`${API}?actie=foto&id=${encodeURIComponent(id)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Foto ophalen mislukte (${res.status})`);
  return res.blob();
}

export async function putPhoto(id, blob) {
  await json(await vraag(`${API}?actie=foto&id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  }));
}

// Bewust niets: een andere computer kan de foto nog in beeld hebben. De server
// ruimt foto's die niet meer in het spel staan zelf op zodra ze een dag oud zijn.
export async function deletePhoto() {}

export async function photoIds() {
  const data = await json(await vraag(`${API}?actie=fotos`));
  return data.ids || [];
}

/* Bekijk-link: alleen-lezen toegang voor wie de geheime code heeft. */
export async function shareToken() {
  return (await json(await vraag(`${API}?actie=deel`))).token || null;
}
export async function newShareToken() {
  return (await json(await vraag(`${API}?actie=deel`, { method: 'POST' }))).token;
}
export async function stopSharing() {
  await json(await vraag(`${API}?actie=deel`, { method: 'DELETE' }));
}
