<?php
/**
 * Kwartetmaker - opslag op de server.
 *
 * Eén bestand, geen database: het spel staat in spel.json en elke foto als
 * losse jpg in de datamap. Bedoeld voor gewone webhosting (Vimexx e.d.).
 */
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
$wachtwoord = (string)($config['wachtwoord'] ?? '');
$datamap    = (string)($config['datamap'] ?? __DIR__ . '/data');
$fotomap    = $datamap . '/fotos';

// Ophogen als de app (js/) iets nieuws van deze server nodig heeft; de app
// meldt dan dat api.php opnieuw geüpload moet worden.
const API_VERSIE = 3;                 // 2 = versienummers, samenwerken, deel-link
                                      // 3 = back-up als zip in één verzoek

const MAX_FOTO = 8 * 1024 * 1024;     // 8 MB per foto
const MAX_SPEL = 4 * 1024 * 1024;     // 4 MB json

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
session_start();

function antwoord(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function lees_body(int $max): string
{
    $body = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($body === false) {
        antwoord(['fout' => 'Kon de verzonden gegevens niet lezen.'], 400);
    }
    if (strlen($body) > $max) {
        antwoord(['fout' => 'Te groot.'], 413);
    }
    return $body;
}

function geldig_id(string $id): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{8,64}$/', $id);
}

function zorg_voor_map(string $map): void
{
    if (!is_dir($map) && !mkdir($map, 0775, true) && !is_dir($map)) {
        antwoord(['fout' => "Kan de map $map niet maken. Controleer de rechten."], 500);
    }
}

function lees_deeltoken(string $pad): string
{
    if (!is_file($pad)) {
        return '';
    }
    $data = json_decode((string)file_get_contents($pad), true);
    return is_array($data) ? (string)($data['token'] ?? '') : '';
}

function lees_rev(string $pad): int
{
    return is_file($pad) ? (int)trim((string)file_get_contents($pad)) : 0;
}

/**
 * Ruimt foto's op die niet meer in het spel voorkomen. Alleen als ze ouder
 * dan een dag zijn: een andere computer kan een foto net hebben geüpload
 * terwijl zijn spel nog niet is opgeslagen, of hem nog even in beeld hebben.
 */
function ruim_fotos_op(string $json, string $fotomap): void
{
    if (random_int(1, 10) !== 1) {
        return;                                      // niet bij elke opslag
    }
    preg_match_all('/"photoId"\s*:\s*"([A-Za-z0-9_-]{8,64})"/', $json, $m);
    $gebruikt = array_flip($m[1]);
    $grens = time() - 86400;
    foreach (glob($fotomap . '/*.jpg') ?: [] as $pad) {
        if (!isset($gebruikt[basename($pad, '.jpg')]) && filemtime($pad) < $grens) {
            @unlink($pad);
        }
    }
}

/**
 * Stuurt een zip (zonder compressie; foto's zijn al gecomprimeerd) direct naar
 * de browser. Bestanden worden één voor één gelezen, dus weinig geheugen nodig.
 *
 * @param array<string,string> $teksten naam in de zip => inhoud
 * @param string[]             $fotos   paden; komen in de zip als fotos/<naam>
 */
function stuur_zip(array $teksten, array $fotos): void
{
    $nu = getdate();
    $tijd = ($nu['hours'] << 11) | ($nu['minutes'] << 5) | intdiv($nu['seconds'], 2);
    $datum = (($nu['year'] - 1980) << 9) | ($nu['mon'] << 5) | $nu['mday'];
    $centraal = '';
    $offset = 0;
    $aantal = 0;

    $voegToe = function (string $naam, string $inhoud) use (&$centraal, &$offset, &$aantal, $tijd, $datum): void {
        $crc = crc32($inhoud);
        $len = strlen($inhoud);
        $nl = strlen($naam);
        $lokaal = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, $tijd, $datum, $crc, $len, $len, $nl, 0) . $naam;
        echo $lokaal, $inhoud;
        flush();
        $centraal .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, $tijd, $datum,
                          $crc, $len, $len, $nl, 0, 0, 0, 0, 0, $offset) . $naam;
        $offset += strlen($lokaal) + $len;
        $aantal++;
    };

    foreach ($teksten as $naam => $inhoud) {
        $voegToe($naam, $inhoud);
    }
    foreach ($fotos as $pad) {
        if (is_file($pad)) {
            $voegToe('fotos/' . basename($pad), (string)file_get_contents($pad));
        }
    }
    echo $centraal, pack('VvvvvVVv', 0x06054b50, 0, 0, $aantal, $aantal, strlen($centraal), $offset, 0);
}

/** Schrijft eerst naar een tijdelijk bestand en hernoemt: nooit een half bestand. */
function schrijf_bestand(string $pad, string $inhoud): void
{
    $tijdelijk = $pad . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tijdelijk, $inhoud, LOCK_EX) === false || !rename($tijdelijk, $pad)) {
        @unlink($tijdelijk);
        antwoord(['fout' => 'Opslaan mislukt. Heeft de webserver schrijfrechten op de datamap?'], 500);
    }
}

$actie      = (string)($_GET['actie'] ?? '');
$ingelogd   = !empty($_SESSION['kwartet_ok']);
$beveiligd  = $wachtwoord !== '';

/* ---- altijd toegankelijk ---- */

if ($actie === 'ping') {
    antwoord(['ok' => true, 'server' => true, 'api' => API_VERSIE, 'beveiligd' => $beveiligd, 'ingelogd' => $ingelogd]);
}

if ($actie === 'login') {
    if (!$beveiligd) {
        antwoord(['fout' => 'Er is nog geen wachtwoord ingesteld in config.php.'], 403);
    }
    $body = json_decode(lees_body(4096), true);
    $gegeven = is_array($body) ? (string)($body['wachtwoord'] ?? '') : '';
    if (hash_equals($wachtwoord, $gegeven)) {
        session_regenerate_id(true);
        $_SESSION['kwartet_ok'] = true;
        antwoord(['ok' => true]);
    }
    usleep(700000);                                  // rem op raden
    antwoord(['fout' => 'Wachtwoord klopt niet.'], 401);
}

if ($actie === 'logout') {
    $_SESSION = [];
    session_destroy();
    antwoord(['ok' => true]);
}

/* ---- bekijk-link: alleen lezen, zonder wachtwoord ---- */
// Wie de geheime code uit de deel-link heeft, mag het spel en de foto's
// ophalen - en verder niets: niet opslaan, niet verwijderen, geen link beheren.

$deelbestand = $datamap . '/deel.json';
$gast = false;
$code = (string)($_GET['t'] ?? '');
if ($code !== '' && !$ingelogd) {
    $geldig = lees_deeltoken($deelbestand);
    if ($geldig === '' || !hash_equals($geldig, $code)) {
        usleep(300000);
        antwoord(['fout' => 'Deze link werkt niet (meer).'], 403);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET' || !in_array($actie, ['rev', 'spel', 'foto'], true)) {
        antwoord(['fout' => 'Met deze link kun je alleen kijken.'], 403);
    }
    $gast = true;
}

/* ---- vanaf hier: ingelogd (of gast met alleen-lezen) ---- */

if (!$gast) {
    if (!$beveiligd) {
        antwoord(['fout' => 'Stel eerst een wachtwoord in in config.php.'], 403);
    }
    if (!$ingelogd) {
        antwoord(['fout' => 'Niet ingelogd.'], 401);
    }
}

zorg_voor_map($datamap);
zorg_voor_map($fotomap);

// Datamap afschermen voor het geval hij in de webmap staat.
$htaccess = $datamap . '/.htaccess';
if (!file_exists($htaccess)) {
    @file_put_contents($htaccess, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
}

$spelbestand = $datamap . '/spel.json';
$revbestand  = $datamap . '/spel.rev';

switch ($actie) {
    case 'rev':
        // Heel klein, zodat elke computer vaak kan kijken of er iets nieuws is.
        antwoord(['rev' => lees_rev($revbestand)]);

    case 'spel':
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $json = lees_body(MAX_SPEL);
            if (json_decode($json) === null && json_last_error() !== JSON_ERROR_NONE) {
                antwoord(['fout' => 'Ongeldige gegevens.'], 400);
            }
            // Eén opslag tegelijk: lezen, vergelijken en schrijven in één slot.
            $slot = fopen($datamap . '/.slot', 'c');
            flock($slot, LOCK_EX);
            $huidig = lees_rev($revbestand);
            $basis  = isset($_GET['rev']) ? (int)$_GET['rev'] : -1;
            if (empty($_GET['force']) && $basis !== $huidig) {
                // Iemand anders was eerder: stuur de actuele versie terug, dan
                // voegt de app de wijzigingen samen en probeert het opnieuw.
                $actueel = is_file($spelbestand) ? file_get_contents($spelbestand) : 'null';
                flock($slot, LOCK_UN);
                http_response_code(409);
                header('Content-Type: application/json; charset=utf-8');
                header('Cache-Control: no-store');
                echo '{"conflict":true,"rev":' . $huidig . ',"spel":' . $actueel . '}';
                exit;
            }
            schrijf_bestand($spelbestand, $json);
            schrijf_bestand($revbestand, (string)($huidig + 1));
            flock($slot, LOCK_UN);
            ruim_fotos_op($json, $fotomap);
            antwoord(['ok' => true, 'rev' => $huidig + 1]);
        }
        $rev = lees_rev($revbestand);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo '{"rev":' . $rev . ',"spel":' . (is_file($spelbestand) ? file_get_contents($spelbestand) : 'null') . '}';
        exit;

    case 'deel':
        // Bekijk-link beheren: opvragen, nieuwe maken (oude vervalt), uitzetten.
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $nieuw = bin2hex(random_bytes(24));
            schrijf_bestand($deelbestand, (string)json_encode(['token' => $nieuw, 'sinds' => date('c')]));
            antwoord(['token' => $nieuw]);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
            @unlink($deelbestand);
            antwoord(['token' => null]);
        }
        $huidig = lees_deeltoken($deelbestand);
        antwoord(['token' => $huidig !== '' ? $huidig : null]);

    case 'backup':
        // Het hele spel met foto's als één zip, in één verzoek. Losse verzoeken
        // per foto lopen bij sommige hosts tegen een limiet aan (429).
        $spel = is_file($spelbestand) ? (string)file_get_contents($spelbestand) : 'null';
        $data = json_decode($spel, true);
        $titel = is_array($data) && is_string($data['title'] ?? null) && trim($data['title']) !== ''
            ? trim($data['title']) : 'Kwartet';
        preg_match_all('/"photoId"\s*:\s*"([A-Za-z0-9_-]{8,64})"/', $spel, $m);

        @set_time_limit(300);
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        $naam = preg_replace('/[\/\\\\:*?"<>|\r\n]+/', '-', $titel) . ' - back-up.zip';
        header('Content-Type: application/zip');
        header('Cache-Control: no-store');
        header('Content-Disposition: attachment; filename="kwartet-back-up.zip"; filename*=UTF-8\'\'' . rawurlencode($naam));

        stuur_zip(
            ['spel.json' => '{"app":"kwartetmaker","versie":1,"spel":' . $spel . '}'],
            array_map(fn ($id) => $fotomap . '/' . $id . '.jpg', array_unique($m[1]))
        );
        exit;

    case 'fotos':
        $ids = [];
        foreach (glob($fotomap . '/*.jpg') ?: [] as $pad) {
            $ids[] = basename($pad, '.jpg');
        }
        antwoord(['ids' => $ids]);

    case 'foto':
        $id = (string)($_GET['id'] ?? '');
        if (!geldig_id($id)) {
            antwoord(['fout' => 'Ongeldige naam.'], 400);
        }
        $pad = $fotomap . '/' . $id . '.jpg';

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $bytes = lees_body(MAX_FOTO);
            if (strncmp($bytes, "\xFF\xD8\xFF", 3) !== 0) {
                antwoord(['fout' => 'Alleen jpeg-afbeeldingen.'], 415);
            }
            schrijf_bestand($pad, $bytes);
            antwoord(['ok' => true]);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
            @unlink($pad);
            antwoord(['ok' => true]);
        }
        if (!is_file($pad)) {
            antwoord(['fout' => 'Niet gevonden.'], 404);
        }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($pad));
        header('Cache-Control: private, max-age=31536000, immutable');
        readfile($pad);
        exit;
}

antwoord(['fout' => 'Onbekende actie.'], 400);
