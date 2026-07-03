-- ─── 051: logos dos home_links ──────────────────────────────────────────────
-- Arquivos em frontend/public/brands/, seguindo o mesmo default_position já
-- seedado na 050. Itens sem logo disponível (webmail, agenda, site-principal,
-- billboard, inteli-ro, e a maioria das consolidações regionais) mantêm o
-- fallback de círculo com a inicial no HomeHub.jsx.

ALTER TABLE home_links ADD COLUMN IF NOT EXISTS logo_filename TEXT;

UPDATE home_links SET logo_filename = 'grupo-inteli.png'          WHERE key = 'site-principal';
UPDATE home_links SET logo_filename = 'inteli-estruturas.png'     WHERE key = 'estruturas';
UPDATE home_links SET logo_filename = 'mls-led-brasil.png'        WHERE key = 'mls-leds';
UPDATE home_links SET logo_filename = 'higrow.png'                WHERE key = 'higrow';
UPDATE home_links SET logo_filename = 'hubix.png'                 WHERE key = 'hubix';
UPDATE home_links SET logo_filename = 'inteli-academy.png'        WHERE key = 'inteli-academy';
UPDATE home_links SET logo_filename = 'direct-midia.png'          WHERE key = 'paineis';
UPDATE home_links SET logo_filename = 'propaganda-indoor.png'     WHERE key = 'propaganda-indoor';
UPDATE home_links SET logo_filename = 'portal-outdoor.png'        WHERE key = 'portal-outdoor';
UPDATE home_links SET logo_filename = 'carro-de-som.png'          WHERE key = 'carro-de-som';
UPDATE home_links SET logo_filename = 'publicidad-espectacular.jpg' WHERE key = 'publicidad-esp';
UPDATE home_links SET logo_filename = 'inteli-py.svg'             WHERE key = 'inteli-py';

UPDATE home_links SET logo_filename = 'al-outdoor.png'            WHERE key = 'estado-al';
UPDATE home_links SET logo_filename = 'ba-outdoor.png'            WHERE key = 'estado-ba';
UPDATE home_links SET logo_filename = 'ce-outdoor.png'            WHERE key = 'estado-ce';
UPDATE home_links SET logo_filename = 'es-outdoor.png'            WHERE key = 'estado-es';
UPDATE home_links SET logo_filename = 'ma-outdoor.png'            WHERE key = 'estado-ma';
UPDATE home_links SET logo_filename = 'mt-outdoors.png'           WHERE key = 'estado-mt';
UPDATE home_links SET logo_filename = 'mg-outdoor.png'            WHERE key = 'estado-mg';
UPDATE home_links SET logo_filename = 'pa-outdoor.png'            WHERE key = 'estado-pa';
UPDATE home_links SET logo_filename = 'pr-outdoor.png'            WHERE key = 'estado-pr';
UPDATE home_links SET logo_filename = 'pe-outdoor.png'            WHERE key = 'estado-pe';
UPDATE home_links SET logo_filename = 'rj-outdoor.png'            WHERE key = 'estado-rj';
UPDATE home_links SET logo_filename = 'rn-outdoor.png'            WHERE key = 'estado-rn';
UPDATE home_links SET logo_filename = 'rg-outdoor.png'            WHERE key = 'estado-rs';
UPDATE home_links SET logo_filename = 'sc-outdoor.png'            WHERE key = 'estado-sc';
UPDATE home_links SET logo_filename = 'sp-outdoor.png'            WHERE key = 'estado-sp';
UPDATE home_links SET logo_filename = 'to-outdoor.png'            WHERE key = 'estado-to';
UPDATE home_links SET logo_filename = 'norte-outdoor.png'         WHERE key = 'estado-norte';
UPDATE home_links SET logo_filename = 'df-goias-outdoor.png'      WHERE key = 'estado-df-go-ms';
UPDATE home_links SET logo_filename = 'nordeste-outdoor.png'      WHERE key = 'estado-nordeste';
