// -----------------------------------------------------------------------------
// The texts users read in Gladys (connection status, the configuration
// button, command errors), in English and French. None of them ever holds
// the API key nor an answer body.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

/** "14:05 UTC" for a time in ms. */
export const clock = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** "30 s", "5 min", "2 h". */
export function duration(ms) {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} s`;
  }
  const minutes = Math.round(ms / 60_000);
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export const T = {
  missing: both(
    'Paste the API key of your TRMNL account in the configuration (see the guide).',
    'Collez la clé d’API de votre compte TRMNL dans la configuration (voir le guide).',
  ),
  invalidKey: both(
    'The API key holds a space or an invisible character: paste it again, without anything around it.',
    'La clé d’API contient un espace ou un caractère invisible : collez-la de nouveau, sans rien autour.',
  ),
  refused: both(
    'TRMNL refused the API key (401): nothing is tried again on its own. Paste a new key (generated again on trmnl.com, Account), or press "Test the connection" once the refresh interval has passed.',
    'TRMNL a refusé la clé d’API (401) : rien n’est retenté seul. Collez une nouvelle clé (régénérée sur trmnl.com, Account), ou appuyez sur « Tester la connexion » une fois l’intervalle de rafraîchissement écoulé.',
  ),
  restored: (count, at, next) =>
    both(
      `Connected: ${count} display${count === 1 ? '' : 's'}, last successful reading at ${clock(at)}, next at ${clock(next)}.`,
      `Connecté : ${count} écran(s), dernière lecture réussie à ${clock(at)}, prochaine à ${clock(next)}.`,
    ),
  paused: (until, reason) =>
    reason === 'busy'
      ? both(
          `TRMNL asked to slow down (429): paused until ${clock(until)}.`,
          `TRMNL demande de ralentir (429) : en pause jusqu’à ${clock(until)}.`,
        )
      : both(
          `TRMNL is in trouble (${reason.replace('server:', '')}): paused until ${clock(until)}.`,
          `TRMNL est en difficulté (${reason.replace('server:', '')}) : en pause jusqu’à ${clock(until)}.`,
        ),
  waiting: (at) =>
    both(
      `Waiting: the first reading is at ${clock(at)} (never faster than the refresh interval, restarts included).`,
      `En attente : première lecture à ${clock(at)} (jamais plus vite que l’intervalle de rafraîchissement, redémarrages compris).`,
    ),
  offline: (error, at) =>
    both(
      `TRMNL cannot be reached (${error}): next try at ${clock(at)}.`,
      `TRMNL est injoignable (${error}) : prochain essai à ${clock(at)}.`,
    ),
  failing: (error, at) =>
    both(
      `TRMNL does not answer as expected (${error}): next try at ${clock(at)}.`,
      `TRMNL ne répond pas comme prévu (${error}) : prochain essai à ${clock(at)}.`,
    ),
  connected: (count, total, at) =>
    both(
      `Connected: ${count} display${count === 1 ? '' : 's'}${total > count ? ` (${total - count} left out, ${count} at most)` : ''}, read at ${clock(at)}.`,
      `Connecté : ${count} écran(s)${total > count ? ` (${total - count} laissé(s) de côté, ${count} au plus)` : ''}, lu(s) à ${clock(at)}.`,
    ),
  dataReset: both(
    'The saved data was unreadable and was reset.',
    'Les données enregistrées étaient illisibles et ont été réinitialisées.',
  ),
  tooSoon: (at) =>
    both(
      `TRMNL was read less than one refresh interval ago: no new reading before ${clock(at)}.`,
      `TRMNL a été lu il y a moins d’un intervalle de rafraîchissement : pas de nouvelle lecture avant ${clock(at)}.`,
    ),
  testOk: (count) =>
    both(
      `TRMNL answers: ${count} display${count === 1 ? '' : 's'} in the account.`,
      `TRMNL répond : ${count} écran(s) dans le compte.`,
    ),
};

/** Errors of the commands and of the button, in English (Gladys shows the error as is). */
export const E = {
  unknownDevice: 'This is not a TRMNL display of this integration: nothing sent',
  readOnly: 'This value is read only: nothing sent',
  invalidValue: 'A push button sends 1: nothing sent',
  disabled:
    'Changing the sleep mode is not allowed in the configuration of the integration: nothing sent',
  notConnected: 'TRMNL is not connected (no API key, or not read yet): nothing sent',
  keyRefused: 'TRMNL refused the API key: nothing sent',
  paused: 'TRMNL asked to slow down or is in trouble: nothing sent',
  tooMany: 'Too many commands in the last minute: nothing sent',
  tooSlow: 'No time left to send the command before Gladys gives up: nothing sent',
  configChanged: 'The configuration changed: nothing sent',
  otherDevice:
    'TRMNL answers for another display under this id (MAC address or friendly id differs): nothing sent',
  unreadable: 'The current sleep mode of the display is unreadable: nothing sent',
  notFound: 'TRMNL no longer knows this display: nothing sent',
  notSent: (detail) => `TRMNL could not be reached (${detail}): nothing sent`,
  refusedKey: 'TRMNL refused the API key for this change: nothing changed',
  refused: (detail) => `TRMNL refused the change (${detail}): nothing changed`,
  busy: 'TRMNL asked to slow down (429): nothing changed',
  unconfirmed: (detail) =>
    `Command sent, without confirmation (${detail}): the next reading shows the sleep mode`,
  testTooLong: 'TRMNL did not answer within 25 seconds',
};
