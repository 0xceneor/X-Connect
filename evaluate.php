<?php
/**
 * evaluate.php — X Account Evaluator
 * POST → store evaluation pushed from x-evaluate.js
 * GET  → display evaluation UI at aptum.fun/evaluate
 */

define('PUSH_SECRET',  getenv('FEED_PUSH_SECRET') ?: '68b68e6fc9c5bb4203c4352c491903836bb639690fb8df19');
define('EVAL_DIR',     __DIR__ . '/evaluations/');
define('MAX_EVALS',    200);

if (!is_dir(EVAL_DIR)) mkdir(EVAL_DIR, 0755, true);

// ── Image proxy (same-origin for html2canvas) ─────────────────────────────────
if (($_GET['proxy'] ?? '') === '1') {
    $raw = $_GET['imgurl'] ?? '';
    // Only allow twitter/x avatar hosts
    if (!preg_match('#^https://[a-z0-9.\-]*(twimg\.com|unavatar\.io|abs\.twimg\.com|pbs\.twimg\.com)/#i', $raw)) {
        http_response_code(403); exit;
    }
    $img = @file_get_contents($raw, false, stream_context_create([
        'http' => ['timeout' => 6, 'header' => "User-Agent: Mozilla/5.0\r\n"]
    ]));
    if (!$img) { http_response_code(502); exit; }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->buffer($img) ?: 'image/jpeg';
    header("Content-Type: $mime");
    header('Cache-Control: public, max-age=3600');
    echo $img; exit;
}

// ── POST: receive evaluation from x-evaluate.js ──────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data || ($data['secret'] ?? '') !== PUSH_SECRET) {
        http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
    }
    unset($data['secret']);
    $username = preg_replace('/[^a-zA-Z0-9_]/', '', $data['username'] ?? '');
    if (!$username) { http_response_code(400); echo json_encode(['error' => 'No username']); exit; }
    $file = EVAL_DIR . strtolower($username) . '.json';
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));
    echo json_encode(['ok' => true, 'username' => $username]); exit;
}

// ── PUT: receive screenshot pushed from VPS evaluate-server ──────────────────
if ($_SERVER['REQUEST_METHOD'] === 'PUT' && ($_GET['action'] ?? '') === 'store_screenshot') {
    $auth = trim(str_replace('Bearer ', '', $_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    if ($auth !== PUSH_SECRET) { http_response_code(403); exit; }
    $u = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['u'] ?? '');
    if (!$u) { http_response_code(400); exit; }
    $png = file_get_contents('php://input');
    if (!$png || substr($png, 0, 4) !== "\x89PNG") { http_response_code(400); echo 'Not a PNG'; exit; }
    file_put_contents(EVAL_DIR . strtolower($u) . '.png', $png);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'username' => $u, 'bytes' => strlen($png)]); exit;
}

// ── Screenshot: serve stored PNG (pushed by VPS after evaluation) ─────────────
if (($_GET['screenshot'] ?? '') === '1') {
    $u = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['u'] ?? '');
    if (!$u) { http_response_code(400); exit; }
    $pngFile = EVAL_DIR . strtolower($u) . '.png';
    if (!file_exists($pngFile)) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Card image not ready. Please wait a moment and try again.';
        exit;
    }
    header('Content-Type: image/png');
    header('Content-Disposition: attachment; filename="aptum-@' . $u . '.png"');
    header('Cache-Control: public, max-age=300');
    readfile($pngFile); exit;
}

// ── GET: display ─────────────────────────────────────────────────────────────
$query    = trim($_GET['u'] ?? '');
$query    = preg_replace('/[^a-zA-Z0-9_]/', '', ltrim($query, '@'));
$evalData = null;
$error    = null;
$pending  = false;
$triggered = false;

if ($query) {
    $file = EVAL_DIR . strtolower($query) . '.json';
    if (file_exists($file)) {
        $evalData = json_decode(file_get_contents($file), true);
        $pendingFile = EVAL_DIR . strtolower($query) . '.pending';
        if (file_exists($pendingFile)) @unlink($pendingFile);
    } else {
        $pendingFile = EVAL_DIR . strtolower($query) . '.pending';
        if (file_exists($pendingFile) && (time() - filemtime($pendingFile)) < 300) {
            $pending = true;
        } else {
            $ctx = stream_context_create(['http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nAuthorization: Bearer " . PUSH_SECRET . "\r\n",
                'content' => json_encode(['action' => 'queue', 'username' => $query, 'secret' => PUSH_SECRET]),
                'timeout' => 5,
                'ignore_errors' => true,
            ]]);
            $resp = @file_get_contents('https://aptum.fun/evaluate-queue.php', false, $ctx);
            $json = $resp ? json_decode($resp, true) : null;
            if ($json && ($json['ok'] ?? false)) {
                file_put_contents($pendingFile, json_encode(['job_id' => $json['job_id'] ?? '', 'ts' => time()]));
                $pending   = true;
                $triggered = true;
            } else {
                $error = "Evaluation service unavailable. Try again shortly.";
            }
        }
    }
}

// list recent evaluations (exclude queue.json and .pending)
$recent = [];
foreach (glob(EVAL_DIR . '*.json') as $f) {
    if (basename($f) === 'queue.json') continue;
    $d = json_decode(file_get_contents($f), true);
    if ($d && isset($d['evaluation'])) $recent[] = [
        'username' => $d['username'] ?? basename($f, '.json'),
        'scannedAt' => $d['scannedAt'] ?? null,
        'overall'   => $d['evaluation']['overall'] ?? null,
        'grade'     => $d['evaluation']['grade'] ?? null,
        'niche'     => $d['evaluation']['niche'] ?? null,
    ];
}
usort($recent, fn($a, $b) => strcmp($b['scannedAt'] ?? '', $a['scannedAt'] ?? ''));
$recent = array_slice($recent, 0, 12);

// ── Background selection ─────────────────────────────────────────────────────
function nicheToBgStyle(string $niche, float $score): string {
    $n = strtolower($niche);
    if ($score >= 8.5)                                                          return 'gold';
    if (preg_match('/nft|collect|holder|pfp|holo|iridescen/', $n))             return 'iridescent';
    if (preg_match('/meme|viral|chaos|troll|funny|satire/', $n))               return 'glitch';
    if (preg_match('/game|gaming|gamefi|play|guild|esport/', $n))              return 'neon';
    if (preg_match('/art|visual|design|creat|generative|photo/', $n))          return 'liquid';
    if (preg_match('/music|audio|sound|film|cinema|record/', $n))              return 'analog';
    if (preg_match('/writ|think|essay|opinion|philosoph|media|journal/', $n))  return 'minimal';
    if (preg_match('/nature|eco|organic|sustain|green|biopunk|bio/', $n))      return 'nature';
    if (preg_match('/ai|tech|build|dev|code|engineer|software/', $n))         return 'cosmic';
    if (preg_match('/lifestyle|fashion|travel|food|personal|life/', $n))       return 'iridescent';
    if (preg_match('/alpha|signal|call|trade|market|insight|hunter/', $n))     return 'fire';
    if (preg_match('/manga|anime|pop|japan|cartoon|weeb/', $n))                return 'manga';
    // crypto/defi/web3 default → cyber
    return 'cyber';
}

function pickBg(string $style, string $username): string {
    static $manifest = null;
    if ($manifest === null) {
        $mf = __DIR__ . '/backgrounds/manifest.json';
        $manifest = file_exists($mf) ? (json_decode(file_get_contents($mf), true) ?? []) : [];
    }
    $pool = $manifest[$style] ?? [];
    if (empty($pool)) return '';
    // Deterministic per-user pick so the same user always gets the same card
    $idx = abs(crc32($username)) % count($pool);
    return '/backgrounds/' . $pool[$idx];
}

// Accent colors per style
function styleAccent(string $style): string {
    return match($style) {
        'cyber'      => '#00FF94',
        'neon'       => '#FF3CAC',
        'iridescent' => '#B8A9FF',
        'glitch'     => '#FF4040',
        'cosmic'     => '#00C8FF',
        'analog'     => '#FF8C00',
        'minimal'    => '#0A0C10',
        'liquid'     => '#00C8FF',
        'fire'       => '#FF6B00',
        'nature'     => '#39D353',
        'gold'       => '#FFD700',
        'manga'      => '#FF3CAC',
        default      => '#00FF94',
    };
}

// Card rarity helpers
function cardRarity(string $followers, float $score): string {
    $f = strtoupper(trim($followers));
    $n = 0;
    if (preg_match('/^([\d,.]+)([KkMm]?)$/', $f, $m)) {
        $n = (float)str_replace(',', '', $m[1]);
        if (strtolower($m[2]) === 'k') $n *= 1000;
        if (strtolower($m[2]) === 'm') $n *= 1000000;
    }
    if ($score >= 8.5 || $n >= 100000) return 'legendary';
    if ($score >= 7.5 || $n >= 10000)  return 'epic';
    if ($score >= 6.0 || $n >= 1000)   return 'rare';
    if ($score >= 4.5 || $n >= 200)    return 'uncommon';
    return 'common';
}
function rarityColor(string $rarity): string {
    return match($rarity) {
        'legendary' => '#FFD700',
        'epic'      => '#B47FFF',
        'rare'      => '#00C8FF',
        'uncommon'  => '#39D353',
        default     => '#8A8FA8',
    };
}
function rarityGlow(string $rarity): string {
    return match($rarity) {
        'legendary' => '0 0 0 2px #FFD700,0 0 60px 14px rgba(255,215,0,.40)',
        'epic'      => '0 0 0 2px #B47FFF,0 0 50px 10px rgba(180,127,255,.32)',
        'rare'      => '0 0 0 2px #00C8FF,0 0 40px 8px rgba(0,200,255,.25)',
        'uncommon'  => '0 0 0 2px #39D353,0 0 28px 6px rgba(57,211,83,.20)',
        default     => '0 0 0 1px rgba(138,143,168,.25)',
    };
}
// ── Effect Engine ─────────────────────────────────────────────────────────────
// Per-style visual profile: image filter, halftone dot colors, frost base,
// color wash (mix-blend-mode:screen), film grain opacity, vignette.
function cardStyleProfile(string $style): array {
    $profiles = [
        'cyber' => [
            'img_filter'    => 'grayscale(0.45) brightness(0.82) contrast(1.22) saturate(1.3)',
            'dot1'          => 'rgba(0,230,100,.46)',
            'dot2'          => 'rgba(0,230,100,.17)',
            'frost_from'    => 'rgba(0,14,6,.58)',
            'frost_to'      => 'rgba(0,8,4,.64)',
            'wash'          => 'rgba(0,255,120,.07)',
            'grain_opacity' => '.085',
        ],
        'neon' => [
            'img_filter'    => 'brightness(0.76) contrast(1.25) saturate(1.6) hue-rotate(8deg)',
            'dot1'          => 'rgba(220,70,255,.44)',
            'dot2'          => 'rgba(220,70,255,.16)',
            'frost_from'    => 'rgba(14,0,16,.58)',
            'frost_to'      => 'rgba(8,0,12,.65)',
            'wash'          => 'rgba(255,60,200,.07)',
            'grain_opacity' => '.075',
        ],
        'glitch' => [
            'img_filter'    => 'grayscale(0.25) brightness(0.78) contrast(1.35) saturate(1.5)',
            'dot1'          => 'rgba(255,50,50,.46)',
            'dot2'          => 'rgba(255,50,50,.17)',
            'frost_from'    => 'rgba(16,0,0,.60)',
            'frost_to'      => 'rgba(10,0,0,.66)',
            'wash'          => 'rgba(255,30,30,.07)',
            'grain_opacity' => '.095',
        ],
        'cosmic' => [
            'img_filter'    => 'brightness(0.78) contrast(1.22) saturate(1.4)',
            'dot1'          => 'rgba(0,180,255,.44)',
            'dot2'          => 'rgba(0,180,255,.16)',
            'frost_from'    => 'rgba(0,6,16,.58)',
            'frost_to'      => 'rgba(0,3,10,.65)',
            'wash'          => 'rgba(0,200,255,.07)',
            'grain_opacity' => '.065',
        ],
        'analog' => [
            'img_filter'    => 'sepia(0.45) brightness(0.84) contrast(1.12) saturate(1.25)',
            'dot1'          => 'rgba(255,150,30,.44)',
            'dot2'          => 'rgba(255,150,30,.16)',
            'frost_from'    => 'rgba(16,8,0,.58)',
            'frost_to'      => 'rgba(10,4,0,.65)',
            'wash'          => 'rgba(255,120,0,.06)',
            'grain_opacity' => '.090',
        ],
        'fire' => [
            'img_filter'    => 'brightness(0.80) contrast(1.25) saturate(1.5) hue-rotate(-8deg)',
            'dot1'          => 'rgba(255,110,0,.46)',
            'dot2'          => 'rgba(255,110,0,.17)',
            'frost_from'    => 'rgba(16,4,0,.60)',
            'frost_to'      => 'rgba(10,2,0,.66)',
            'wash'          => 'rgba(255,80,0,.07)',
            'grain_opacity' => '.075',
        ],
        'gold' => [
            'img_filter'    => 'sepia(0.35) brightness(0.82) contrast(1.18) saturate(1.4)',
            'dot1'          => 'rgba(255,205,50,.44)',
            'dot2'          => 'rgba(255,205,50,.16)',
            'frost_from'    => 'rgba(14,10,0,.58)',
            'frost_to'      => 'rgba(8,6,0,.64)',
            'wash'          => 'rgba(255,200,0,.06)',
            'grain_opacity' => '.065',
        ],
        'iridescent' => [
            'img_filter'    => 'brightness(0.80) contrast(1.18) saturate(1.3)',
            'dot1'          => 'rgba(180,155,255,.44)',
            'dot2'          => 'rgba(180,155,255,.16)',
            'frost_from'    => 'rgba(8,4,16,.58)',
            'frost_to'      => 'rgba(4,2,12,.64)',
            'wash'          => 'rgba(160,140,255,.06)',
            'grain_opacity' => '.065',
        ],
        'liquid' => [
            'img_filter'    => 'brightness(0.80) contrast(1.20) saturate(1.35)',
            'dot1'          => 'rgba(0,200,255,.44)',
            'dot2'          => 'rgba(0,200,255,.16)',
            'frost_from'    => 'rgba(0,8,16,.58)',
            'frost_to'      => 'rgba(0,4,10,.65)',
            'wash'          => 'rgba(0,200,255,.06)',
            'grain_opacity' => '.065',
        ],
        'nature' => [
            'img_filter'    => 'brightness(0.82) contrast(1.15) saturate(1.4)',
            'dot1'          => 'rgba(57,211,83,.44)',
            'dot2'          => 'rgba(57,211,83,.16)',
            'frost_from'    => 'rgba(0,10,4,.58)',
            'frost_to'      => 'rgba(0,6,2,.64)',
            'wash'          => 'rgba(40,200,60,.06)',
            'grain_opacity' => '.065',
        ],
        'minimal' => [
            'img_filter'    => 'grayscale(0.7) brightness(0.85) contrast(1.22)',
            'dot1'          => 'rgba(210,210,228,.42)',
            'dot2'          => 'rgba(210,210,228,.16)',
            'frost_from'    => 'rgba(8,8,12,.62)',
            'frost_to'      => 'rgba(4,4,8,.68)',
            'wash'          => 'rgba(200,200,220,.05)',
            'grain_opacity' => '.055',
        ],
        'manga' => [
            'img_filter'    => 'brightness(0.76) contrast(1.28) saturate(1.5)',
            'dot1'          => 'rgba(255,60,172,.44)',
            'dot2'          => 'rgba(255,60,172,.16)',
            'frost_from'    => 'rgba(14,0,12,.60)',
            'frost_to'      => 'rgba(8,0,8,.66)',
            'wash'          => 'rgba(255,60,172,.06)',
            'grain_opacity' => '.075',
        ],
    ];
    return $profiles[$style] ?? $profiles['cyber'];
}

function relTime(?string $iso): string {
    if (!$iso) return '';
    $d = time() - strtotime($iso);
    if ($d < 60)    return $d . 's ago';
    if ($d < 3600)  return floor($d/60) . 'm ago';
    if ($d < 86400) return floor($d/3600) . 'h ago';
    return floor($d/86400) . 'd ago';
}
function scoreColor(float $s): string {
    if ($s >= 7) return '#0B7A42';
    if ($s >= 5) return 'rgba(10,12,18,0.55)';
    return '#B91C1C';
}
function scoreBg(float $s): string {
    if ($s >= 7) return 'rgba(11,122,66,0.07)';
    if ($s >= 5) return 'transparent';
    return 'rgba(185,28,28,0.06)';
}
function barPct(float $s): int { return (int)(($s / 10) * 100); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<?php if ($evalData): $ev2 = $evalData['evaluation']; ?>
<title>@<?= htmlspecialchars($evalData['username']) ?> — <?= number_format((float)($ev2['overall']??0),1) ?>/10 — aptum_</title>
<meta property="og:title" content="@<?= htmlspecialchars($evalData['username']) ?> scored <?= number_format((float)($ev2['overall']??0),1) ?>/10">
<meta property="og:description" content="<?= htmlspecialchars(substr($ev2['summary']??'',0,160)) ?>">
<?php else: ?>
<title>Evaluate — aptum_</title>
<meta property="og:title" content="X Account Evaluator — aptum_">
<meta property="og:description" content="AI-powered X account analysis. Score any account across 5 dimensions.">
<?php endif; ?>
<meta property="og:image" content="https://aptum.fun/feed-preview.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@aptum_">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:   #F4F5F8;--bg1:  #ECEEF3;--bg2:  #FFFFFF;--bg3:  #F8F9FB;
  --bdr:  rgba(9,11,16,0.12);--bdr2: rgba(9,11,16,0.22);--bdr3: rgba(9,11,16,0.30);
  --ink:  #0A0C12;--ink2: rgba(10,12,18,0.80);--ink3: rgba(10,12,18,0.62);
  --ink4: rgba(10,12,18,0.45);--ink5: rgba(10,12,18,0.20);
  --green:#0B7A42;--green-bg:rgba(11,122,66,0.08);--red:#B91C1C;
  --mono:'IBM Plex Mono',monospace;--disp:'Syne',sans-serif;
}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}

html,body{height:100%;scrollbar-width:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}
body{background:var(--bg);color:var(--ink);font-family:var(--mono);-webkit-font-smoothing:antialiased;}
body::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(9,11,16,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(9,11,16,.05) 1px,transparent 1px);
  background-size:48px 48px;}

/* TOP BAR */
.topbar{position:fixed;top:0;left:0;right:0;z-index:300;height:32px;background:var(--ink);display:flex;align-items:center;}
.tb-item{display:flex;align-items:center;gap:6px;padding:0 16px;height:32px;border-right:1px solid rgba(255,255,255,.07);font-size:9.5px;letter-spacing:.1em;color:rgba(255,255,255,.35);}
.tb-val{font-weight:700;color:rgba(255,255,255,.80);}
.tb-live-dot{width:5px;height:5px;border-radius:50%;background:#34D399;animation:blink 2.5s infinite;flex-shrink:0;}
#tb-clock{font-size:9.5px;color:rgba(255,255,255,.22);letter-spacing:.1em;margin-left:auto;padding-right:16px;}

/* NAVBAR */
.navbar{position:fixed;top:32px;left:0;right:0;z-index:200;height:52px;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1.5px solid var(--bdr2);display:flex;align-items:stretch;}
.brand{display:flex;align-items:center;gap:10px;padding:0 24px;border-right:1px solid var(--bdr2);text-decoration:none;}
.brand-name{font-family:var(--disp);font-size:15px;font-weight:800;letter-spacing:.16em;color:var(--ink);}
.brand-pill{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:2px 9px;background:var(--ink);color:#fff;}
.nav-end{margin-left:auto;display:flex;align-items:center;padding:0 24px;gap:22px;}
.nav-a{font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);text-decoration:none;transition:color .12s;}
.nav-a:hover{color:var(--ink);}
.nav-a.active{color:var(--ink);}

/* PAGE */
.page{position:relative;z-index:10;max-width:880px;margin:0 auto;padding:104px 18px 80px;}

/* HERO SEARCH */
.hero{text-align:center;margin-bottom:40px;animation:fadeUp .4s both;}
.hero-eyebrow{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ink4);margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:8px;}
.hero-line{width:28px;height:1px;background:var(--bdr2);}
.hero-title{font-family:var(--disp);font-size:clamp(22px,3.5vw,32px);font-weight:800;letter-spacing:-.01em;color:var(--ink);margin-bottom:6px;}
.hero-sub{font-size:11px;color:var(--ink4);letter-spacing:.04em;margin-bottom:26px;font-weight:500;}
.search-form{display:flex;max-width:460px;margin:0 auto;border:1.5px solid var(--bdr3);background:var(--bg2);}
.search-at{display:flex;align-items:center;padding:0 14px;background:var(--ink);color:rgba(255,255,255,.55);font-size:14px;font-weight:700;border-right:none;flex-shrink:0;}
.search-input{flex:1;padding:13px 16px;font-family:var(--mono);font-size:13px;font-weight:500;border:none;background:transparent;color:var(--ink);outline:none;letter-spacing:.02em;min-width:0;}
.search-input::placeholder{color:var(--ink4);}
.search-btn{padding:13px 22px;background:var(--ink);color:#fff;border:none;border-left:1px solid rgba(0,0,0,.12);font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:background .13s;white-space:nowrap;flex-shrink:0;}
.search-btn:hover{background:#1e2130;}

/* ERROR */
.error-box{border:1px solid rgba(185,28,28,.28);background:rgba(185,28,28,.05);padding:11px 16px;margin-bottom:20px;font-size:11px;color:var(--red);letter-spacing:.03em;animation:fadeUp .3s both;}

/* PENDING */
.pending-box{border:1.5px solid var(--bdr2);background:var(--bg2);padding:20px;margin-bottom:20px;display:flex;align-items:center;gap:16px;animation:fadeUp .3s both;}
.pending-spinner{width:18px;height:18px;border:2px solid var(--ink5);border-top-color:var(--ink);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0;}
.pending-text{font-size:12px;font-weight:600;color:var(--ink);letter-spacing:.01em;}
.pending-sub{font-size:10px;color:var(--ink4);margin-top:4px;letter-spacing:.03em;}

/* SECTION HEADER (aptum pattern) */
.sec-hd{padding:9px 18px;border-bottom:1px solid var(--bdr2);display:flex;align-items:center;gap:10px;background:var(--bg1);}
.sec-num{font-size:8px;color:var(--ink4);letter-spacing:.1em;font-weight:700;border:1px solid var(--bdr);padding:2px 6px;background:var(--bg3);}
.sec-pipe{color:var(--bdr2);}
.sec-title{font-size:10.5px;color:var(--ink);letter-spacing:.12em;text-transform:uppercase;font-weight:700;}
.sec-sub{font-size:10px;color:var(--ink4);flex:1;font-weight:500;}
.sec-status{font-size:8.5px;color:var(--ink4);margin-left:auto;letter-spacing:.08em;font-weight:600;white-space:nowrap;}
.sec-status.ok{color:var(--green);}

/* PANEL */
.panel{background:var(--bg2);border:1px solid var(--bdr2);margin-bottom:10px;animation:fadeUp .4s both;}

/* PROFILE */
.profile-banner{height:110px;overflow:hidden;background-size:cover;background-position:center;}
.profile-body{padding:0 22px 22px;display:flex;align-items:flex-start;gap:18px;margin-top:-40px;}
.profile-pfp{width:88px;height:88px;border-radius:50%;border:3px solid var(--bg2);object-fit:cover;flex-shrink:0;background:var(--bg3);}
.profile-info{flex:1;min-width:0;padding-top:48px;}
.profile-handle{font-size:17px;font-weight:700;color:var(--ink);margin-bottom:2px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.profile-dn{font-weight:400;color:var(--ink3);font-size:12.5px;}
.profile-bio{font-size:11px;color:var(--ink3);line-height:1.65;margin:7px 0 11px;}
.profile-stats{display:flex;gap:0;flex-wrap:wrap;border:1px solid var(--bdr);width:fit-content;}
.pstat{padding:7px 14px;border-right:1px solid var(--bdr);display:flex;flex-direction:column;gap:2px;}
.pstat:last-child{border-right:none;}
.pstat-val{font-size:13px;font-weight:700;color:var(--ink);line-height:1;}
.pstat-lbl{font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);font-weight:600;}
.profile-right{text-align:right;flex-shrink:0;padding-top:48px;display:flex;flex-direction:column;align-items:flex-end;gap:5px;}
.score-big{font-family:var(--disp);font-size:52px;font-weight:800;line-height:1;letter-spacing:-.02em;}
.score-grade-lbl{font-size:10px;font-weight:700;letter-spacing:.2em;color:var(--ink4);text-transform:uppercase;}
.niche-tag{font-size:8px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:3px 10px;border:1px solid var(--bdr2);background:var(--bg3);color:var(--ink3);display:inline-block;margin-top:2px;}

/* STATS GRID (dimension scores) */
.dim-scores-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--bdr);border:1px solid var(--bdr);}
@media(max-width:600px){.dim-scores-grid{grid-template-columns:repeat(3,1fr);}}
.dim-score-cell{background:var(--bg2);padding:14px 16px;display:flex;flex-direction:column;gap:4px;transition:background .12s;}
.dim-score-cell:hover{background:var(--bg3);}
.dim-score-val{font-size:22px;font-weight:700;color:var(--ink);line-height:1;font-variant-numeric:tabular-nums;}
.dim-score-lbl{font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);font-weight:600;}
.dim-score-bar{height:2px;background:var(--bdr);margin-top:4px;}
.dim-score-bar-fill{height:100%;}

/* DIM DETAIL ROWS */
.dim-rows{display:flex;flex-direction:column;}
.dim-row{border-bottom:1px solid var(--bdr);padding:13px 18px;transition:background .1s;}
.dim-row:last-child{border-bottom:none;}
.dim-row:hover{background:var(--bg3);}
.dim-row-head{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.dim-row-label{font-size:11px;font-weight:700;color:var(--ink);flex:1;letter-spacing:.01em;}
.dim-row-score{font-size:11.5px;font-weight:700;}
.dim-row-bar-wrap{height:2px;background:var(--bdr);margin-bottom:10px;}
.dim-row-bar-fill{height:100%;}
.dim-row-lists{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:480px){.dim-row-lists{grid-template-columns:1fr;}}
.dim-list-lbl{font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);margin-bottom:5px;}
.dim-list{list-style:none;display:flex;flex-direction:column;gap:4px;}
.dim-list li{font-size:11px;color:var(--ink2);line-height:1.55;padding-left:14px;position:relative;}
.dim-list.good li::before{content:'✓';position:absolute;left:0;color:var(--green);font-weight:700;font-size:10px;}
.dim-list.fix li::before{content:'→';position:absolute;left:0;color:var(--ink3);}

/* CALLOUT */
.callout{padding:13px 18px;display:flex;gap:12px;align-items:flex-start;border-left:2px solid var(--bdr3);}
.callout-pre{font-size:8px;color:var(--ink4);letter-spacing:.12em;white-space:nowrap;padding-top:2px;font-weight:700;}
.callout-text{font-size:11.5px;color:var(--ink2);line-height:1.7;font-weight:500;}
.callout.green{border-left-color:var(--green);background:var(--green-bg);}
.callout.red{border-left-color:var(--red);background:rgba(185,28,28,0.05);}

/* LOG ROWS */
.log-rows{display:flex;flex-direction:column;}
.log-row{display:grid;grid-template-columns:22px 1fr auto;align-items:flex-start;border-bottom:1px solid var(--bdr);padding:11px 18px;font-size:11px;gap:12px;transition:background .1s;}
.log-row:last-child{border-bottom:none;}
.log-row:hover{background:var(--bg3);}
.log-idx{font-size:8.5px;color:var(--ink4);font-weight:700;letter-spacing:.06em;padding-top:1px;}
.log-msg{color:var(--ink2);font-weight:500;line-height:1.55;}
.log-tag{font-size:8px;color:var(--ink4);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;padding-top:2px;font-weight:600;}

/* KPI GRID */
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--bdr);border:1px solid var(--bdr);}
@media(max-width:480px){.kpi-grid{grid-template-columns:1fr;}}
.kpi-cell{background:var(--bg2);padding:12px 16px;}
.kpi-num{font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink4);margin-bottom:3px;font-weight:700;}
.kpi-val{font-size:12px;color:var(--ink);line-height:1.5;font-weight:500;}

/* RISK GRID */
.risk-row{display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--bdr);}
.risk-row:last-child{border-bottom:none;}
.risk-flag-dot{width:5px;height:5px;border-radius:50%;background:var(--red);flex-shrink:0;}
.risk-flag-text{font-size:11px;color:var(--ink2);font-weight:500;}
.risk-score-bar{display:flex;align-items:center;gap:10px;}
.risk-score-num{font-size:22px;font-weight:700;line-height:1;}
.risk-bar-track{flex:1;height:4px;background:var(--bdr);min-width:80px;}
.risk-bar-fill{height:100%;background:var(--red);}

/* TOP ACTIONS */
.actions-panel{background:var(--ink);color:#fff;}
.actions-panel .sec-hd{background:rgba(255,255,255,.06);border-bottom-color:rgba(255,255,255,.10);}
.actions-panel .sec-num{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:rgba(255,255,255,.40);}
.actions-panel .sec-title{color:rgba(255,255,255,.82);}
.act-row{display:grid;grid-template-columns:24px 1fr;gap:12px;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.06);align-items:flex-start;}
.act-row:last-child{border-bottom:none;}
.act-num{font-size:8.5px;font-weight:700;color:rgba(255,255,255,.28);letter-spacing:.1em;padding-top:2px;}
.act-text{font-size:12px;color:rgba(255,255,255,.88);font-weight:500;line-height:1.55;}

/* RECENT */
.section-lbl{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--ink4);margin-bottom:10px;}
.recent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:1px;background:var(--bdr);border:1px solid var(--bdr);margin-bottom:32px;animation:fadeUp .35s both;}
.recent-card{background:var(--bg2);padding:12px 14px;text-decoration:none;display:block;transition:background .12s;}
.recent-card:hover{background:var(--bg3);}
.rc-handle{font-size:11px;font-weight:700;color:var(--ink);letter-spacing:.01em;margin-bottom:4px;}
.rc-meta{display:flex;align-items:center;gap:8px;}
.rc-grade{font-size:10px;font-weight:700;}
.rc-niche{font-size:8.5px;color:var(--ink4);letter-spacing:.04em;text-transform:uppercase;}
.rc-time{font-size:8.5px;color:var(--ink4);margin-left:auto;}

/* EVAL WRAP */
.eval-wrap{animation:fadeUp .4s both;}

/* FOOTER + DOWNLOAD */
.eval-footer{font-size:9.5px;color:var(--ink4);text-align:center;padding:12px 0 4px;letter-spacing:.04em;}
.dl-wrap{padding:16px 18px;border-top:1px solid var(--bdr2);display:flex;align-items:center;justify-content:space-between;gap:14px;background:var(--bg1);}
.dl-btn{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:11px 24px;background:var(--ink);color:#fff;border:none;cursor:pointer;transition:background .13s;white-space:nowrap;}
.dl-btn:hover{background:#1e2130;}
.dl-btn:disabled{opacity:.4;cursor:default;}
.dl-status{font-size:10px;color:var(--ink4);letter-spacing:.04em;}
</style>
</head>
<body>

<div class="topbar">
  <div class="tb-item"><span class="tb-live-dot"></span><span>EVALUATE</span><span class="tb-val">X ACCOUNTS</span></div>
  <div class="tb-item"><span>EVALS</span><span class="tb-val"><?= count($recent) ?></span></div>
  <span id="tb-clock"></span>
</div>

<div class="navbar">
  <a class="brand" href="/feed">
    <span class="brand-name">APTUM</span>
    <span class="brand-pill">EVAL</span>
  </a>
  <div class="nav-end">
    <a href="/feed" class="nav-a">Feed</a>
    <a href="/evaluate" class="nav-a active">Evaluate</a>
    <a href="https://x.com/aptum_" target="_blank" class="nav-a">@aptum_</a>
  </div>
</div>

<div class="page">

  <div class="hero">
    <div class="hero-eyebrow"><span class="hero-line"></span>AI-POWERED ANALYSIS<span class="hero-line"></span></div>
    <div class="hero-title">X Account Evaluator</div>
    <div class="hero-sub">Score any account across 5 dimensions. Get specific, actionable intelligence.</div>
    <form class="search-form" method="GET" action="/evaluate">
      <div class="search-at">@</div>
      <input class="search-input" type="text" name="u" placeholder="username" value="<?= htmlspecialchars($query) ?>" autocomplete="off" autocorrect="off" spellcheck="false">
      <button class="search-btn" type="submit">Evaluate →</button>
    </form>
  </div>

  <?php if ($pending): ?>
  <div class="pending-box">
    <div class="pending-spinner"></div>
    <div>
      <div class="pending-text"><strong>@<?= htmlspecialchars($query) ?></strong> is being evaluated<?= $triggered ? ' — just kicked off' : ' — in progress' ?></div>
      <div class="pending-sub">Scraping profile · Running AI analysis · Usually 30–90 seconds</div>
    </div>
  </div>
  <script>setTimeout(()=>location.reload(),8000);</script>
  <?php elseif ($error): ?>
  <div class="error-box"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <?php if ($evalData): $ev = $evalData['evaluation']; $pr = $evalData['profile'];
    $overall  = (float)($ev['overall'] ?? 0);
    $sc       = scoreColor($overall);
    $dims5    = array_slice(array_values($ev['dimensions'] ?? []), 0, 5);
    $report   = $ev['report'] ?? [];
    $bannerUrl = $pr['bannerUrl'] ?? '';
  ?>
  <div class="eval-wrap">

    <!-- ── PROFILE ── -->
    <div class="panel" style="margin-bottom:10px;">
      <div class="profile-banner" style="<?= $bannerUrl ? 'background:url(' . htmlspecialchars($bannerUrl) . ') center/cover no-repeat;' : 'background:linear-gradient(135deg,var(--bg1) 0%,var(--bg3) 100%);border-bottom:1px solid var(--bdr2);' ?>"></div>
      <div class="profile-body">
        <img class="profile-pfp" src="<?= htmlspecialchars($pr['pfpUrl'] ?? 'https://unavatar.io/x/' . urlencode($evalData['username'])) ?>" alt="" onerror="this.src='https://unavatar.io/x/<?= urlencode($evalData['username']) ?>';this.onerror=function(){this.style.opacity='.2'}">
        <div class="profile-info">
          <div class="profile-handle">
            @<?= htmlspecialchars($evalData['username']) ?>
            <?php if ($pr['displayName'] ?? ''): ?><span class="profile-dn"><?= htmlspecialchars($pr['displayName']) ?></span><?php endif; ?>
          </div>
          <?php if ($pr['bio'] ?? ''): ?><div class="profile-bio"><?= htmlspecialchars(substr($pr['bio'], 0, 180)) ?></div><?php endif; ?>
          <div class="profile-stats">
            <?php if ($pr['followers'] ?? ''): ?><div class="pstat"><span class="pstat-val"><?= htmlspecialchars($pr['followers']) ?></span><span class="pstat-lbl">Followers</span></div><?php endif; ?>
            <?php if ($pr['following'] ?? ''): ?><div class="pstat"><span class="pstat-val"><?= htmlspecialchars($pr['following']) ?></span><span class="pstat-lbl">Following</span></div><?php endif; ?>
            <?php if ($pr['tweetCount'] ?? ''): ?><div class="pstat"><span class="pstat-val"><?= htmlspecialchars($pr['tweetCount']) ?></span><span class="pstat-lbl">Posts</span></div><?php endif; ?>
          </div>
        </div>
        <div class="profile-right">
          <div class="score-big" style="color:<?= $sc ?>"><?= number_format($overall, 1) ?></div>
          <div class="score-grade-lbl"><?= htmlspecialchars($ev['grade'] ?? '') ?> · Grade</div>
          <?php if ($ev['niche'] ?? ''): ?><div class="niche-tag"><?= htmlspecialchars($ev['niche']) ?></div><?php endif; ?>
          <?php if ($report['account_type'] ?? ''): ?><div class="niche-tag" style="margin-top:4px;"><?= htmlspecialchars($report['account_type']) ?></div><?php endif; ?>
        </div>
      </div>
    </div>

    <!-- ── SUMMARY ── -->
    <?php if ($ev['summary'] ?? ''): ?>
    <div class="panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">01</span><span class="sec-pipe">|</span>
        <span class="sec-title">Assessment</span>
        <span class="sec-sub">AI evaluation summary</span>
        <span class="sec-status ok"><?= relTime($evalData['scannedAt'] ?? '') ?></span>
      </div>
      <div class="callout" style="border-left-color:var(--bdr3);">
        <span class="callout-pre">SUMMARY</span>
        <span class="callout-text"><?= htmlspecialchars($ev['summary']) ?></span>
      </div>
      <?php if ($report['verdict'] ?? ''): ?>
      <div class="callout green">
        <span class="callout-pre">VERDICT</span>
        <span class="callout-text"><?= htmlspecialchars($report['verdict']) ?></span>
      </div>
      <?php endif; ?>
    </div>
    <?php endif; ?>

    <!-- ── DIMENSION SCORES GRID ── -->
    <div class="panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">02</span><span class="sec-pipe">|</span>
        <span class="sec-title">Performance Dimensions</span>
        <span class="sec-sub">5-axis evaluation</span>
        <span class="sec-status"><?= number_format($overall, 1) ?> / 10</span>
      </div>
      <div class="dim-scores-grid">
        <?php foreach ($dims5 as $dim):
          $ds = (float)($dim['score'] ?? 0);
          $dsc = scoreColor($ds);
          $dpct = barPct($ds);
        ?>
        <div class="dim-score-cell">
          <div class="dim-score-val" style="color:<?= $dsc ?>"><?= number_format($ds, 1) ?></div>
          <div class="dim-score-lbl"><?= htmlspecialchars($dim['label'] ?? '') ?></div>
          <div class="dim-score-bar"><div class="dim-score-bar-fill" style="width:<?= $dpct ?>%;background:<?= $dsc ?>"></div></div>
        </div>
        <?php endforeach; ?>
      </div>
      <div class="dim-rows">
        <?php foreach ($dims5 as $dim):
          $ds = (float)($dim['score'] ?? 0);
          $dsc = scoreColor($ds);
          $dpct = barPct($ds);
        ?>
        <div class="dim-row">
          <div class="dim-row-head">
            <span class="dim-row-label"><?= htmlspecialchars($dim['label'] ?? '') ?></span>
            <span class="dim-row-score" style="color:<?= $dsc ?>"><?= number_format($ds, 1) ?>/10</span>
          </div>
          <div class="dim-row-bar-wrap"><div class="dim-row-bar-fill" style="width:<?= $dpct ?>%;background:<?= $dsc ?>"></div></div>
          <?php if (!empty($dim['good']) || !empty($dim['fix'])): ?>
          <div class="dim-row-lists">
            <?php if (!empty($dim['good'])): ?>
            <div>
              <div class="dim-list-lbl">Strengths</div>
              <ul class="dim-list good"><?php foreach ($dim['good'] as $g): ?><li><?= htmlspecialchars($g) ?></li><?php endforeach; ?></ul>
            </div>
            <?php endif; ?>
            <?php if (!empty($dim['fix'])): ?>
            <div>
              <div class="dim-list-lbl">Opportunities</div>
              <ul class="dim-list fix"><?php foreach ($dim['fix'] as $f): ?><li><?= htmlspecialchars($f) ?></li><?php endforeach; ?></ul>
            </div>
            <?php endif; ?>
          </div>
          <?php endif; ?>
        </div>
        <?php endforeach; ?>
      </div>
    </div>

    <!-- ── TOP ACTIONS ── -->
    <?php if (!empty($ev['top_actions'])): ?>
    <div class="panel actions-panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">03</span><span class="sec-pipe">|</span>
        <span class="sec-title">Top Actions</span>
        <span class="sec-sub">Highest-ROI moves</span>
      </div>
      <?php foreach ($ev['top_actions'] as $i => $action): ?>
      <div class="act-row">
        <span class="act-num">0<?= $i + 1 ?></span>
        <span class="act-text"><?= htmlspecialchars($action) ?></span>
      </div>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <!-- ── REPORT: ALGO RISK + ER ── -->
    <?php if ($report): ?>
    <div class="panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">04</span><span class="sec-pipe">|</span>
        <span class="sec-title">Signal Intelligence</span>
        <span class="sec-sub">Algo risk · ER · Velocity</span>
        <?php $risk = (int)($report['algo_risk_score'] ?? 0); ?>
        <span class="sec-status<?= $risk >= 60 ? '' : ' ok' ?>"><?= $risk >= 60 ? 'HIGH RISK' : 'LOW RISK' ?></span>
      </div>

      <?php if (isset($report['algo_risk_score'])): ?>
      <div style="padding:14px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:16px;">
        <div>
          <div style="font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);margin-bottom:2px;font-weight:700;">ALGO RISK SCORE</div>
          <div class="risk-score-bar"><span class="risk-score-num" style="color:<?= $risk >= 60 ? 'var(--red)' : 'var(--green)' ?>"><?= $risk ?></span></div>
        </div>
        <div class="risk-bar-track" style="flex:1;height:4px;background:var(--bdr);"><div style="width:<?= $risk ?>%;height:100%;background:<?= $risk >= 60 ? 'var(--red)' : 'var(--green)' ?>;transition:width .3s;"></div></div>
        <div style="font-size:9px;color:var(--ink4);text-align:right;">
          <?php if ($report['weighted_er_pct'] ?? ''): ?><div style="font-weight:700;color:var(--ink2);">ER <?= htmlspecialchars($report['weighted_er_pct']) ?></div><?php endif; ?>
          <?php if ($report['er_percentile'] ?? ''): ?><div><?= htmlspecialchars($report['er_percentile']) ?></div><?php endif; ?>
        </div>
      </div>
      <?php endif; ?>

      <?php if ($report['velocity_insight'] ?? ''): ?>
      <div class="callout" style="border-left-color:var(--bdr3);border-bottom:1px solid var(--bdr);">
        <span class="callout-pre">VELOCITY</span>
        <span class="callout-text"><?= htmlspecialchars($report['velocity_insight']) ?></span>
      </div>
      <?php endif; ?>

      <?php if (!empty($report['algo_risk_flags'])): ?>
      <div style="border-bottom:1px solid var(--bdr);">
        <div style="padding:8px 18px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);font-weight:700;background:var(--bg1);">RISK FLAGS</div>
        <?php foreach ($report['algo_risk_flags'] as $flag): ?>
        <div class="risk-row"><span class="risk-flag-dot"></span><span class="risk-flag-text"><?= htmlspecialchars($flag) ?></span></div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>

    </div>

    <!-- ── QUICK WINS + STRATEGY ── -->
    <?php if (!empty($report['quick_wins']) || !empty($report['strategy_fixes']) || !empty($report['long_term'])): ?>
    <div class="panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">05</span><span class="sec-pipe">|</span>
        <span class="sec-title">Growth Strategy</span>
        <span class="sec-sub">Quick wins · Medium-term · Long-term</span>
      </div>

      <?php if (!empty($report['quick_wins'])): ?>
      <div style="border-bottom:1px solid var(--bdr);">
        <div style="padding:8px 18px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);font-weight:700;background:var(--bg1);">QUICK WINS · 1–7 DAYS</div>
        <div class="log-rows">
          <?php foreach ($report['quick_wins'] as $i => $item): ?>
          <div class="log-row">
            <span class="log-idx">0<?= $i+1 ?></span>
            <span class="log-msg"><?= htmlspecialchars($item) ?></span>
          </div>
          <?php endforeach; ?>
        </div>
      </div>
      <?php endif; ?>

      <?php if (!empty($report['strategy_fixes'])): ?>
      <div style="border-bottom:1px solid var(--bdr);">
        <div style="padding:8px 18px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);font-weight:700;background:var(--bg1);">STRATEGY · 14–30 DAYS</div>
        <div class="log-rows">
          <?php foreach ($report['strategy_fixes'] as $i => $item): ?>
          <div class="log-row">
            <span class="log-idx">0<?= $i+1 ?></span>
            <span class="log-msg"><?= htmlspecialchars($item) ?></span>
          </div>
          <?php endforeach; ?>
        </div>
      </div>
      <?php endif; ?>

      <?php if (!empty($report['long_term'])): ?>
      <div>
        <div style="padding:8px 18px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);font-weight:700;background:var(--bg1);">COMPOUNDING HABITS · 30–90 DAYS</div>
        <div class="log-rows">
          <?php foreach ($report['long_term'] as $i => $item): ?>
          <div class="log-row">
            <span class="log-idx">0<?= $i+1 ?></span>
            <span class="log-msg"><?= htmlspecialchars($item) ?></span>
          </div>
          <?php endforeach; ?>
        </div>
      </div>
      <?php endif; ?>

    </div>
    <?php endif; ?>

    <!-- ── KPIs ── -->
    <?php if (!empty($report['kpis'])): ?>
    <div class="panel" style="margin-bottom:10px;">
      <div class="sec-hd">
        <span class="sec-num">06</span><span class="sec-pipe">|</span>
        <span class="sec-title">Weekly KPIs</span>
        <span class="sec-sub">3 metrics to track</span>
      </div>
      <div class="kpi-grid">
        <?php foreach (array_slice($report['kpis'], 0, 3) as $i => $kpi): ?>
        <div class="kpi-cell">
          <div class="kpi-num">KPI 0<?= $i+1 ?></div>
          <div class="kpi-val"><?= htmlspecialchars($kpi) ?></div>
        </div>
        <?php endforeach; ?>
      </div>
    </div>
    <?php endif; ?>

    <?php endif; // end $report ?>

    <!-- ── DOWNLOAD ── -->
    <div class="panel" style="margin-bottom:32px;">
      <div class="dl-wrap">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--ink2);">Share Card</div>
          <div style="font-size:9.5px;color:var(--ink4);margin-top:2px;">400×500px · PNG · <?= relTime($evalData['scannedAt'] ?? '') ?> · <?= (int)($evalData['tweetCount'] ?? 0) ?> posts analyzed</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="dl-status" id="dl-status"></div>
          <button class="dl-btn" id="dl-btn" onclick="downloadCard()">↓ Download Card</button>
        </div>
      </div>
    </div>

  </div><!-- /eval-wrap -->

  <?php elseif (!empty($recent)): ?>
  <div class="section-lbl">Recent Evaluations</div>
  <div class="recent-grid">
    <?php foreach ($recent as $r): ?>
    <a class="recent-card" href="?u=<?= urlencode($r['username']) ?>">
      <div class="rc-handle">@<?= htmlspecialchars($r['username']) ?></div>
      <div class="rc-meta">
        <?php if ($r['overall'] !== null): $rc = scoreColor((float)$r['overall']); ?>
          <span class="rc-grade" style="color:<?= $rc ?>"><?= number_format((float)$r['overall'], 1) ?> <?= htmlspecialchars($r['grade'] ?? '') ?></span>
        <?php endif; ?>
        <?php if ($r['niche']): ?><span class="rc-niche"><?= htmlspecialchars($r['niche']) ?></span><?php endif; ?>
        <span class="rc-time"><?= relTime($r['scannedAt']) ?></span>
      </div>
    </a>
    <?php endforeach; ?>
  </div>
  <?php endif; ?>

</div>

<script>
(function(){
  function clock(){var d=new Date(),el=document.getElementById('tb-clock');
    if(el)el.textContent=d.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});}
  clock();setInterval(clock,1000);
})();

function downloadCard(){
  var btn=document.getElementById('dl-btn'),status=document.getElementById('dl-status');
  btn.disabled=true;btn.textContent='Fetching…';status.textContent='';
  fetch('/evaluate?screenshot=1&u=<?= rawurlencode($evalData['username'] ?? '') ?>')
    .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t||r.status)});return r.blob()})
    .then(function(blob){
      var a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download='aptum-@<?= addslashes($evalData['username'] ?? 'eval') ?>-<?= number_format($overall, 1) ?>.png';
      a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);
      btn.disabled=false;btn.textContent='↓ Download Card';status.textContent='Saved ✓';
      setTimeout(function(){status.textContent=''},2500);
    })
    .catch(function(e){btn.disabled=false;btn.textContent='↓ Download Card';status.textContent='Failed: '+e.message;});
}
</script>
</body>
</html>
