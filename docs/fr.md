# TRMNL

Amène dans Gladys les écrans e-ink [TRMNL](https://trmnl.com) de votre
compte, par l'API de compte officielle de TRMNL : batterie, Wi-Fi et mode
veille de chaque écran.

> **Jamais testé avec un vrai appareil.** Cette intégration a été écrite à
> partir du client Python `trmnl` (celui de l'intégration Home Assistant) et
> testée seulement contre une API TRMNL simulée. Non officielle, sans lien
> avec TRMNL.

## Ce que vous obtenez

Un appareil par écran (onglet Découverte), identifié par son numéro TRMNL :

- **Batterie** (%), et **tension de la batterie** (V) ;
- **Force du Wi-Fi** (0 à 100, comme TRMNL la note) et **signal Wi-Fi**
  (dBm) ;
- **Mode veille** (activé ou non) et **heures de veille** (par exemple
  `22:00-08:00`, à l'heure de votre compte TRMNL) ;
- en option, deux **boutons** : « Activer le mode veille » et « Désactiver
  le mode veille » (voir plus bas).

Ce que l'écran affiche (playlists, plugins) reste géré dans TRMNL. L'API ne
donne pas l'heure du dernier contact d'un écran : elle n'est pas affichée.

## Mise en route

1. Sur [trmnl.com](https://trmnl.com), ouvrez **Account** et copiez la
   **API key** de votre compte (elle commence par `user_`).
2. Dans Gladys, ouvrez cette intégration, collez la clé et enregistrez. La
   clé est gardée par Gladys dans sa base, jamais réaffichée, et envoyée
   seulement à trmnl.com, dans l'en-tête `Authorization` des requêtes.
3. Vos écrans apparaissent dans l'onglet Découverte : créez ceux que vous
   voulez.

## Rythme de lecture

- Une requête pour tous les écrans, à chaque intervalle de rafraîchissement
  (15 minutes par défaut, de 5 minutes à 1 heure). Un écran donne sa
  batterie et son signal quand il se réveille : lire plus souvent montre
  rarement plus.
- **Jamais plus vite que l'intervalle** : ni la reconnexion de Gladys, ni un
  enregistrement de la configuration sans changement, ni le bouton
  Découverte, ni « Tester la connexion », ni un redémarrage du conteneur
  (l'heure du dernier essai est gardée) n'ajoutent de lecture. Une nouvelle
  clé est essayée une minute au plus après le dernier essai.
- En cas d'erreur, nouvel essai après l'intervalle, puis le double, jusqu'à
  1 heure.
- 429 (TRMNL demande de ralentir) ou 5xx : pause de la durée demandée, sinon
  15 ou 5 minutes, entre 1 minute et 6 heures, gardée même après un
  redémarrage. Ni lecture ni commande pendant la pause.
- Après un redémarrage qui suit une lecture réussie, l'intégration est
  « connectée » tout de suite, jusqu'à la lecture suivante.
- Un 403 (il peut venir du réseau qui protège trmnl.com) n'est pas un refus
  de la clé : nouvel essai comme pour toute autre erreur.
- **Clé refusée** (401) : plus aucun essai automatique, même après un
  redémarrage. Collez une nouvelle clé (régénérée sur trmnl.com ;
  réenregistrer la même clé ne fait rien), ou appuyez sur « Tester la
  connexion » une fois l'intervalle écoulé : le refus n'est effacé qu'après une lecture
  réussie.

## Boutons du mode veille (désactivés par défaut)

Cochez « Autoriser le changement du mode veille des écrans » dans la
configuration. Chaque écran reçoit alors deux boutons (jamais un
interrupteur : ni assistant vocal ni « tout éteindre » ne peut les
atteindre). Chaque appui :

1. relit l'écran chez TRMNL (et vérifie que c'est le même écran : adresse
   MAC et identifiant) ; s'il est déjà dans le mode demandé, rien n'est
   envoyé ;
2. revérifie que l'option est toujours cochée, puis change le mode veille ;
3. relit l'écran : la commande n'est dite réussie que si TRMNL montre la
   nouvelle valeur. Sinon : « Commande envoyée, sans confirmation » (la
   prochaine lecture montrera le mode réel).

Rien n'est envoyé au-delà de 3,5 secondes après l'appui (Gladys attend 5
secondes), ni pendant une pause 429/5xx ; 6 commandes par minute au plus.

## Questions aux testeurs

Si vous avez un écran TRMNL, dites-nous (forum, ou un ticket sur GitHub) :
la batterie, la tension et le signal correspondent-ils à ce que montre
trmnl.com ? Les boutons du mode veille agissent-ils sur l'écran ?

## Données et vie privée

L'intégration ne parle qu'à trmnl.com. Elle garde dans son volume `/data` :
une clé aléatoire, l'empreinte (HMAC) d'une clé refusée (effacée au premier
succès ; jamais d'empreinte d'une clé qui marche), la fin d'une pause, l'heure
du dernier essai, et la liste des écrans (numéro, nom, identifiant, adresse
MAC). Elle ne lit pas votre profil (nom, e-mail).
