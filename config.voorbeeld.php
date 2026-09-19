<?php
// Sjabloon: kopieer naar config.php en vul je wachtwoord in.
// config.php zelf staat niet in git.
//
// Instellingen voor de gehoste versie (bijvoorbeeld bij Vimexx).
//
// 1. WACHTWOORD
// Zet hieronder een wachtwoord. Zolang dat leeg is, weigert de server alles:
// een kwartet met je eigen foto's hoort niet open en bloot op internet te
// staan. Iedereen die het wachtwoord heeft, kan het spel zien en bewerken.
//
// 2. DATAMAP
// Hierin komen spel.json en de foto's. Het veiligst is een map buiten de
// webmap (buiten public_html), want daar kan niemand rechtstreeks bij.
// Bij Vimexx (DirectAdmin) ziet dat er zo uit:
//
//   /home/GEBRUIKER/domains/JOUWDOMEIN.nl/public_html/kwartet/  <- de app
//   /home/GEBRUIKER/domains/JOUWDOMEIN.nl/kwartet-data/         <- de datamap
//
// Staat de app in public_html/kwartet/, dan klopt het voorbeeld hieronder met
// '/../../kwartet-data'. Staat de app direct in public_html, haal er dan één
// '/..' af. Blijf binnen de map van je domein: hoger mag PHP meestal niet
// komen (open_basedir).
//
// Weet je het pad niet? Zet tijdelijk een bestand pad.php naast api.php met:
//     <?php echo __DIR__;
// open het in je browser, noteer wat er staat en gooi het daarna weg.

return [
    'wachtwoord' => '',

    // Naast de app (eenvoudig, wordt afgeschermd met een .htaccess):
    'datamap' => __DIR__ . '/data',

    // Beter, buiten de webmap - haal het commentaarteken weg en pas het pad aan:
    // 'datamap' => __DIR__ . '/../../kwartet-data',
    // 'datamap' => '/home/GEBRUIKER/domains/JOUWDOMEIN.nl/kwartet-data',
];
