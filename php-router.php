<?php
// Alleen voor start-php.command: de app lokaal draaien zoals op de server.
// De app (index.html, css, js) komt uit deze map, api.php uit vimexx/ - net
// als op Vimexx, waar ze naast elkaar staan.
$pad = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($pad === '/api.php') {
    require __DIR__ . '/vimexx/api.php';
    return true;
}
// De serverbestanden zelf (met config.php) en eventuele data niet uitserveren.
if (preg_match('#^/(vimexx|data|kwartet-data)(/|$)#', $pad) || str_ends_with($pad, '.php')) {
    http_response_code(404);
    echo 'Niet gevonden';
    return true;
}
return false;
