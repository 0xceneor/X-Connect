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

// ── GET: display ─────────────────────────────────────────────────────────────
$query    = trim($_GET['u'] ?? '');
$query    = preg_replace('/[^a-zA-Z0-9_]/', '', ltrim($query, '@'));
$evalData = null;
$error    = null;

$pending   = false;
$triggered = false;

if ($query) {
    $file = EVAL_DIR . strtolower($query) . '.json';
    if (file_exists($file)) {
        $evalData = json_decode(file_get_contents($file), true);
        // Clean up pending marker if result arrived
        $pendingFile = EVAL_DIR . strtolower($query) . '.pending';
        if (file_exists($pendingFile)) @unlink($pendingFile);
    } else {
        // Check for pending job marker
        $pendingFile = EVAL_DIR . strtolower($query) . '.pending';
        if (file_exists($pendingFile) && (time() - filemtime($pendingFile)) < 300) {
            $pending = true;
        } else {
            // Queue evaluation via local queue file
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

// list recent evaluations
$recent = [];
foreach (glob(EVAL_DIR . '*.json') as $f) {
    $d = json_decode(file_get_contents($f), true);
    if ($d) $recent[] = ['username' => $d['username'] ?? basename($f, '.json'), 'scannedAt' => $d['scannedAt'] ?? null, 'overall' => $d['evaluation']['overall'] ?? null, 'grade' => $d['evaluation']['grade'] ?? null, 'niche' => $d['evaluation']['niche'] ?? null];
}
usort($recent, fn($a, $b) => strcmp($b['scannedAt'] ?? '', $a['scannedAt'] ?? ''));
$recent = array_slice($recent, 0, 12);

function relTime(?string $iso): string {
    if (!$iso) return '';
    $d = time() - strtotime($iso);
    if ($d < 60)    return $d . 's ago';
    if ($d < 3600)  return floor($d/60) . 'm ago';
    if ($d < 86400) return floor($d/3600) . 'h ago';
    return floor($d/86400) . 'd ago';
}
function scoreColor(float $s): string {
    if ($s >= 7) return '#0D9151';
    if ($s >= 5) return '#C2820A';
    return '#C2400A';
}
function scoreBg(float $s): string {
    if ($s >= 7) return 'rgba(13,145,81,.08)';
    if ($s >= 5) return 'rgba(194,130,10,.08)';
    return 'rgba(194,64,10,.08)';
}
function barPct(float $s): int { return (int)(($s / 10) * 100); }
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Evaluate — aptum_</title>
<meta name="description" content="AI-powered X account analysis. Get a full breakdown and actionable steps to grow.">
<meta property="og:title" content="X Account Evaluator — aptum_">
<meta property="og:image" content="https://aptum.fun/feed-preview.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@aptum_">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:    #ECEEF2;
  --surf:  #FFFFFF;
  --surf2: #F5F7FA;
  --bd:    rgba(9,11,15,.09);
  --bd2:   rgba(9,11,15,.16);
  --bd3:   rgba(9,11,15,.28);
  --ink:   #0A0C10;
  --ink2:  rgba(10,12,16,.80);
  --ink3:  rgba(10,12,16,.54);
  --ink4:  rgba(10,12,16,.36);
  --ink5:  rgba(10,12,16,.12);
  --mono: 'IBM Plex Mono', monospace;
  --disp: 'Syne', sans-serif;
  --sh-sm: 0 1px 3px rgba(9,11,15,.06), 0 1px 2px rgba(9,11,15,.04);
  --sh-md: 0 4px 20px rgba(9,11,15,.08), 0 1px 4px rgba(9,11,15,.05);
}
@keyframes fadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
@keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.25} }
@keyframes spin   { to { transform: rotate(360deg) } }

html, body { height:100%; }
body { background: var(--bg); color: var(--ink); font-family: var(--mono); -webkit-font-smoothing: antialiased; }
body::before {
  content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image: linear-gradient(var(--bd) 1px, transparent 1px), linear-gradient(90deg, var(--bd) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* ── Top bar ── */
.topbar { position:fixed; top:0; left:0; right:0; z-index:300; height:32px; background:var(--ink); display:flex; align-items:center; padding:0 0 0 1px; }
.tb-item { display:flex; align-items:center; gap:6px; padding:0 16px; height:32px; border-right:1px solid rgba(255,255,255,.07); font-size:10px; letter-spacing:.1em; color:rgba(255,255,255,.35); }
.tb-item:first-child { border-left:1px solid rgba(255,255,255,.07); }
.tb-val { font-weight:700; color:rgba(255,255,255,.88); }
#tb-clock { font-size:10px; color:rgba(255,255,255,.22); letter-spacing:.1em; margin-left:auto; padding-right:16px; }

/* ── Navbar ── */
.navbar { position:fixed; top:32px; left:0; right:0; z-index:200; height:52px; background:rgba(255,255,255,.92); backdrop-filter:blur(12px); border-bottom:1px solid var(--bd2); display:flex; align-items:stretch; box-shadow:var(--sh-sm); }
.brand { display:flex; align-items:center; gap:12px; padding:0 24px; border-right:1px solid var(--bd2); text-decoration:none; }
.brand-name { font-family:var(--disp); font-size:15px; font-weight:800; letter-spacing:.16em; color:var(--ink); }
.brand-pill { font-size:9px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; padding:2px 8px; background:var(--ink); color:#fff; }
.nav-end { margin-left:auto; display:flex; align-items:center; padding:0 24px; gap:20px; }
.nav-a { font-size:10px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--ink4); text-decoration:none; }
.nav-a:hover { color:var(--ink); }
.nav-a.active { color:var(--ink); }

/* ── Page ── */
.page { position:relative; z-index:10; max-width:720px; margin:0 auto; padding:108px 16px 80px; }

/* ── Search hero ── */
.hero { text-align:center; margin-bottom:40px; animation:fadeUp .4s both; }
.hero-label { font-size:9px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:var(--ink4); margin-bottom:14px; }
.hero-title { font-family:var(--disp); font-size:28px; font-weight:800; letter-spacing:.06em; color:var(--ink); margin-bottom:6px; }
.hero-sub { font-size:11px; color:var(--ink3); letter-spacing:.04em; margin-bottom:28px; }

.search-form { display:flex; gap:0; max-width:420px; margin:0 auto; box-shadow:var(--sh-md); }
.search-at { display:flex; align-items:center; padding:0 14px; background:var(--ink); color:rgba(255,255,255,.5); font-size:14px; font-weight:700; border:1px solid var(--ink); border-right:none; }
.search-input {
  flex:1; padding:12px 16px; font-family:var(--mono); font-size:13px; font-weight:500;
  border:1px solid var(--bd3); border-right:none; background:var(--surf);
  color:var(--ink); outline:none; letter-spacing:.02em;
}
.search-input::placeholder { color:var(--ink4); }
.search-input:focus { border-color:var(--ink); }
.search-btn {
  padding:12px 20px; background:var(--ink); color:#fff;
  border:1px solid var(--ink); font-family:var(--mono); font-size:10px;
  font-weight:700; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;
  transition:background .14s; white-space:nowrap;
}
.search-btn:hover { background:#222; }

/* ── Error ── */
.error-box { border:1px solid rgba(194,64,10,.3); background:rgba(194,64,10,.05); padding:12px 16px; margin-bottom:24px; font-size:11px; color:#C2400A; letter-spacing:.03em; animation:fadeUp .3s both; }

/* ── Recent list ── */
.section-label { font-size:9px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--ink4); margin-bottom:12px; }
.recent-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:8px; margin-bottom:32px; animation:fadeUp .35s both; }
.recent-card {
  background:var(--surf); border:1px solid var(--bd2); padding:12px 14px;
  text-decoration:none; display:block; transition:box-shadow .15s, transform .15s;
  box-shadow:var(--sh-sm);
}
.recent-card:hover { box-shadow:var(--sh-md); transform:translateY(-1px); }
.rc-handle { font-size:11px; font-weight:700; color:var(--ink); letter-spacing:.01em; margin-bottom:4px; }
.rc-meta { display:flex; align-items:center; gap:8px; }
.rc-grade { font-size:10px; font-weight:700; }
.rc-niche { font-size:9px; color:var(--ink4); letter-spacing:.04em; text-transform:uppercase; }
.rc-time { font-size:9px; color:var(--ink4); margin-left:auto; }

/* ── Evaluation result ── */
.eval-wrap { animation:fadeUp .4s both; }

/* profile header */
.eval-header {
  background:var(--surf); border:1px solid var(--bd2); border-left:3px solid var(--ink);
  padding:20px 20px 18px; margin-bottom:12px; box-shadow:var(--sh-sm);
  display:flex; align-items:flex-start; gap:16px;
}
.eval-pfp { width:52px; height:52px; border-radius:50%; border:1.5px solid var(--bd2); object-fit:cover; flex-shrink:0; background:var(--surf2); }
.eval-info { flex:1; min-width:0; }
.eval-handle { font-size:16px; font-weight:700; letter-spacing:.02em; color:var(--ink); margin-bottom:3px; }
.eval-bio { font-size:11px; color:var(--ink3); line-height:1.55; margin-bottom:8px; }
.eval-stats { display:flex; gap:20px; flex-wrap:wrap; }
.eval-stat { font-size:10px; color:var(--ink4); letter-spacing:.04em; }
.eval-stat strong { color:var(--ink); font-weight:700; }
.eval-right { text-align:right; flex-shrink:0; }
.eval-score-big { font-family:var(--disp); font-size:36px; font-weight:800; line-height:1; }
.eval-grade { font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--ink4); margin-top:2px; }
.eval-niche { font-size:8.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; margin-top:6px; padding:2px 8px; border:1px solid var(--bd2); background:var(--surf2); color:var(--ink3); display:inline-block; }

/* summary */
.eval-summary { background:var(--surf); border:1px solid var(--bd2); padding:14px 18px; margin-bottom:12px; font-size:12px; color:var(--ink2); line-height:1.7; box-shadow:var(--sh-sm); }

/* top actions */
.actions-box { background:var(--ink); border:1px solid var(--ink); padding:16px 20px; margin-bottom:12px; box-shadow:var(--sh-sm); }
.actions-label { font-size:8.5px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:rgba(255,255,255,.35); margin-bottom:12px; }
.action-item { display:flex; align-items:flex-start; gap:10px; margin-bottom:8px; }
.action-item:last-child { margin-bottom:0; }
.action-num { font-size:9px; font-weight:700; color:rgba(255,255,255,.3); letter-spacing:.1em; padding-top:1px; flex-shrink:0; }
.action-text { font-size:12px; color:#fff; font-weight:600; line-height:1.5; }

/* dimensions grid */
.dims-grid { display:grid; gap:8px; margin-bottom:12px; }
.dim-card { background:var(--surf); border:1px solid var(--bd2); border-left:2px solid; padding:14px 16px; box-shadow:var(--sh-sm); }
.dim-head { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
.dim-label { font-size:11px; font-weight:700; color:var(--ink); flex:1; letter-spacing:.01em; }
.dim-score { font-size:13px; font-weight:700; }
.dim-bar-track { height:3px; background:var(--ink5); flex:1; }
.dim-bar-fill  { height:3px; transition:width .4s ease; }
.dim-lists { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; }
@media (max-width:500px) { .dim-lists { grid-template-columns:1fr; } }
.dim-list-label { font-size:8.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--ink4); margin-bottom:6px; }
.dim-list li { font-size:11px; color:var(--ink2); line-height:1.55; margin-bottom:4px; padding-left:14px; position:relative; list-style:none; }
.dim-list.good li::before { content:'✓'; position:absolute; left:0; color:#0D9151; font-weight:700; }
.dim-list.fix  li::before { content:'→'; position:absolute; left:0; color:#C2820A; }

/* scan time */
.eval-footer { font-size:9.5px; color:var(--ink4); text-align:center; padding:12px 0 0; letter-spacing:.04em; }

/* ── Pending state ── */
.pending-box {
  border:1px solid var(--bd2); background:var(--surf); padding:24px 20px;
  margin-bottom:24px; display:flex; align-items:center; gap:16px;
  animation:fadeUp .3s both; box-shadow:var(--sh-sm);
}
.pending-spinner {
  width:20px; height:20px; border:2.5px solid var(--ink5); border-top-color:var(--ink);
  border-radius:50%; animation:spin .7s linear infinite; flex-shrink:0;
}
.pending-text { font-size:12px; font-weight:600; color:var(--ink); letter-spacing:.01em; }
.pending-sub  { font-size:10px; color:var(--ink4); margin-top:4px; letter-spacing:.03em; }
</style>
</head>
<body>

<!-- Top bar -->
<div class="topbar">
  <div class="tb-item"><span>EVALUATE</span><span class="tb-val">X ACCOUNTS</span></div>
  <div class="tb-item"><span>EVALS</span><span class="tb-val"><?= count($recent) ?></span></div>
  <span id="tb-clock"></span>
</div>

<!-- Navbar -->
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

  <!-- Hero search -->
  <div class="hero">
    <div class="hero-label">AI-powered analysis</div>
    <div class="hero-title">X ACCOUNT EVALUATOR</div>
    <div class="hero-sub">Score any X account across 5 dimensions. Get specific, actionable feedback.</div>
    <form class="search-form" method="GET" action="/evaluate">
      <div class="search-at">@</div>
      <input class="search-input" type="text" name="u" placeholder="username" value="<?= htmlspecialchars($query) ?>" autocomplete="off" autocorrect="off" spellcheck="false">
      <button class="search-btn" type="submit">Evaluate</button>
    </form>
  </div>

  <?php if ($pending): ?>
  <div class="pending-box">
    <div class="pending-spinner"></div>
    <div class="pending-text">
      <strong>@<?= htmlspecialchars($query) ?></strong> is being evaluated
      <?= $triggered ? ' — just kicked off' : ' — in progress' ?>
    </div>
    <div class="pending-sub">Scraping profile · Running AI analysis · Usually 30–90 seconds</div>
  </div>
  <script>setTimeout(()=>location.reload(),8000);</script>
  <?php elseif ($error): ?>
  <div class="error-box"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <?php if ($evalData): $ev = $evalData['evaluation']; $pr = $evalData['profile']; ?>
  <!-- ── EVALUATION RESULT ── -->
  <div class="eval-wrap">

    <!-- Profile header -->
    <div class="eval-header">
      <?php $pfpSrc = "https://unavatar.io/x/" . urlencode($evalData['username']); ?>
      <img class="eval-pfp" src="<?= htmlspecialchars($pfpSrc) ?>" alt="" onerror="this.style.opacity='.3'">
      <div class="eval-info">
        <div class="eval-handle">@<?= htmlspecialchars($evalData['username']) ?>
          <?php if ($pr['displayName'] ?? ''): ?>
            <span style="font-weight:400;color:var(--ink3);font-size:12px;margin-left:8px"><?= htmlspecialchars($pr['displayName']) ?></span>
          <?php endif; ?>
        </div>
        <?php if ($pr['bio'] ?? ''): ?>
          <div class="eval-bio"><?= htmlspecialchars(substr($pr['bio'], 0, 160)) ?></div>
        <?php endif; ?>
        <div class="eval-stats">
          <?php if ($pr['followers'] ?? ''): ?><span class="eval-stat"><strong><?= htmlspecialchars($pr['followers']) ?></strong> followers</span><?php endif; ?>
          <?php if ($pr['following'] ?? ''): ?><span class="eval-stat"><strong><?= htmlspecialchars($pr['following']) ?></strong> following</span><?php endif; ?>
          <?php if ($pr['tweetCount'] ?? ''): ?><span class="eval-stat"><strong><?= htmlspecialchars($pr['tweetCount']) ?></strong> posts</span><?php endif; ?>
          <?php if ($pr['location'] ?? ''): ?><span class="eval-stat"><?= htmlspecialchars($pr['location']) ?></span><?php endif; ?>
        </div>
      </div>
      <div class="eval-right">
        <?php $overall = $ev['overall'] ?? 0; $sc = scoreColor($overall); ?>
        <div class="eval-score-big" style="color:<?= $sc ?>"><?= number_format($overall, 1) ?></div>
        <div class="eval-grade" style="color:<?= $sc ?>"><?= htmlspecialchars($ev['grade'] ?? '') ?></div>
        <?php if ($ev['niche'] ?? ''): ?>
          <div class="eval-niche"><?= htmlspecialchars($ev['niche']) ?></div>
        <?php endif; ?>
      </div>
    </div>

    <!-- Summary -->
    <?php if ($ev['summary'] ?? ''): ?>
    <div class="eval-summary"><?= htmlspecialchars($ev['summary']) ?></div>
    <?php endif; ?>

    <!-- Top actions -->
    <?php if (!empty($ev['top_actions'])): ?>
    <div class="actions-box">
      <div class="actions-label">Top 3 actions</div>
      <?php foreach ($ev['top_actions'] as $i => $action): ?>
      <div class="action-item">
        <span class="action-num"><?= $i + 1 ?>.</span>
        <span class="action-text"><?= htmlspecialchars($action) ?></span>
      </div>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <!-- Dimensions -->
    <div class="dims-grid">
      <?php foreach ($ev['dimensions'] ?? [] as $key => $dim):
        $s  = (float)($dim['score'] ?? 0);
        $sc = scoreColor($s);
        $bg = scoreBg($s);
        $pct = barPct($s);
      ?>
      <div class="dim-card" style="border-left-color:<?= $sc ?>; background:<?= $bg ?>">
        <div class="dim-head">
          <span class="dim-label"><?= htmlspecialchars($dim['label'] ?? $key) ?></span>
          <span class="dim-score" style="color:<?= $sc ?>"><?= number_format($s, 1) ?>/10</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="dim-bar-track" style="flex:1">
            <div class="dim-bar-fill" style="width:<?= $pct ?>%;background:<?= $sc ?>"></div>
          </div>
        </div>
        <?php if (!empty($dim['good']) || !empty($dim['fix'])): ?>
        <div class="dim-lists">
          <?php if (!empty($dim['good'])): ?>
          <div>
            <div class="dim-list-label">Strengths</div>
            <ul class="dim-list good">
              <?php foreach ($dim['good'] as $g): ?>
                <li><?= htmlspecialchars($g) ?></li>
              <?php endforeach; ?>
            </ul>
          </div>
          <?php endif; ?>
          <?php if (!empty($dim['fix'])): ?>
          <div>
            <div class="dim-list-label">Improve</div>
            <ul class="dim-list fix">
              <?php foreach ($dim['fix'] as $f): ?>
                <li><?= htmlspecialchars($f) ?></li>
              <?php endforeach; ?>
            </ul>
          </div>
          <?php endif; ?>
        </div>
        <?php endif; ?>
      </div>
      <?php endforeach; ?>
    </div>

    <div class="eval-footer">
      Scanned <?= relTime($evalData['scannedAt'] ?? '') ?> · <?= (int)($evalData['tweetCount'] ?? 0) ?> posts analyzed
    </div>

  </div>

  <?php elseif (!empty($recent)): ?>
  <!-- ── RECENT EVALUATIONS ── -->
  <div class="section-label">Recent Evaluations</div>
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
  function clock(){
    const d=new Date();
    const el=document.getElementById('tb-clock');
    if(el) el.textContent=d.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  clock(); setInterval(clock,1000);
})();
</script>
</body>
</html>
