<?php
/**
 * feed.php — Signal Feed
 * POST → push receiver | GET → live signal feed viewer
 */

define('PUSH_SECRET', getenv('FEED_PUSH_SECRET') ?: '68b68e6fc9c5bb4203c4352c491903836bb639690fb8df19');
define('FEED_DATA',   __DIR__ . '/feed-data.json');
define('MAX_ENTRIES', 500);
define('DEFAULT_LIMIT', 50);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data || !PUSH_SECRET || ($data['secret'] ?? '') !== PUSH_SECRET) {
        http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
    }
    unset($data['secret']);
    $data['receivedAt'] = date('c');
    $feed = file_exists(FEED_DATA) ? (json_decode(file_get_contents(FEED_DATA), true) ?: []) : [];
    array_unshift($feed, $data);
    if (count($feed) > MAX_ENTRIES) $feed = array_slice($feed, 0, MAX_ENTRIES);
    file_put_contents(FEED_DATA, json_encode($feed, JSON_PRETTY_PRINT));
    echo json_encode(['ok' => true, 'total' => count($feed)]); exit;
}

$all    = file_exists(FEED_DATA) ? (json_decode(file_get_contents(FEED_DATA), true) ?: []) : [];
$filter = $_GET['filter'] ?? 'all';
$limit  = min((int)($_GET['limit'] ?? DEFAULT_LIMIT), MAX_ENTRIES);
$entries = $all;
if ($filter === 'shill')     $entries = array_values(array_filter($entries, fn($e) => ($e['signal'] ?? '') === 'SHILL'));
elseif ($filter === 'pass')  $entries = array_values(array_filter($entries, fn($e) => ($e['signal'] ?? '') === 'PASS'));
$total   = count($all);
$shown   = min($limit, count($entries));
$entries = array_slice($entries, 0, $limit);
$lastAt  = $all[0]['engagedAt'] ?? $all[0]['receivedAt'] ?? null;
$isLive  = $lastAt && (time() - strtotime($lastAt)) < 3600;

function relTime(?string $iso): string {
    if (!$iso) return '';
    $d = time() - strtotime($iso);
    if ($d < 60)    return $d . 's ago';
    if ($d < 3600)  return floor($d/60)  . 'm ago';
    if ($d < 86400) return floor($d/3600) . 'h ago';
    return floor($d/86400) . 'd ago';
}
function fmtNum($n): string {
    if ($n === null || $n === '') return '';
    $n = (int)$n;
    if ($n >= 1000000) return round($n/1000000, 1) . 'M';
    if ($n >= 1000)    return round($n/1000, 1) . 'K';
    return (string)$n;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Signal Feed — aptum_</title>
<meta name="description" content="High-signal posts from the crypto and web3 feed, curated by aptum_.">
<meta property="og:title" content="Signal Feed — aptum_">
<meta property="og:description" content="High-signal posts from the crypto and web3 feed, curated by aptum_.">
<meta property="og:image" content="https://aptum.fun/feed-preview.png">
<meta property="og:url" content="https://aptum.fun/feed">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Signal Feed — aptum_">
<meta name="twitter:description" content="High-signal posts from the crypto and web3 feed, curated by aptum_.">
<meta name="twitter:image" content="https://aptum.fun/feed-preview.png">
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
  --pass:  #0D9151;
  --pass-bg:  rgba(13,145,81,.07);
  --pass-bd:  rgba(13,145,81,.22);
  --shill: #C2620A;
  --shill-bg:  rgba(194,98,10,.07);
  --shill-bd:  rgba(194,98,10,.22);
  --mono: 'IBM Plex Mono', monospace;
  --disp: 'Syne', sans-serif;
  --shadow-sm: 0 1px 3px rgba(9,11,15,.06), 0 1px 2px rgba(9,11,15,.04);
  --shadow-md: 0 4px 16px rgba(9,11,15,.08), 0 1px 4px rgba(9,11,15,.05);
  --shadow-lg: 0 8px 32px rgba(9,11,15,.12), 0 2px 8px rgba(9,11,15,.06);
}

@keyframes fadeUp { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
@keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.2} }

html, body { height: 100%; }
body { background: var(--bg); color: var(--ink); font-family: var(--mono); -webkit-font-smoothing: antialiased; }

/* grid */
body::before {
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    linear-gradient(var(--bd) 1px, transparent 1px),
    linear-gradient(90deg, var(--bd) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* ── Top bar ── */
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 300;
  height: 32px; background: var(--ink);
  display: flex; align-items: center; gap: 0; padding: 0 0 0 1px;
}
.tb-item {
  display: flex; align-items: center; gap: 6px;
  padding: 0 16px; height: 32px;
  border-right: 1px solid rgba(255,255,255,.07);
  font-size: 10px; letter-spacing: .1em; color: rgba(255,255,255,.35);
}
.tb-item:first-child { border-left: 1px solid rgba(255,255,255,.07); }
.tb-val { font-weight: 700; color: rgba(255,255,255,.88); }
.live-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,.6);
  animation: pulse 1.8s ease-in-out infinite;
}
.idle-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.18); }
#tb-clock { font-size: 10px; color: rgba(255,255,255,.22); letter-spacing: .1em; margin-left: auto; padding-right: 16px; }

/* ── Navbar ── */
.navbar {
  position: fixed; top: 32px; left: 0; right: 0; z-index: 200;
  height: 52px; background: rgba(255,255,255,.92); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--bd2);
  display: flex; align-items: stretch;
  box-shadow: var(--shadow-sm);
}
.brand { display: flex; align-items: center; gap: 12px; padding: 0 24px; border-right: 1px solid var(--bd2); text-decoration: none; }
.brand-name { font-family: var(--disp); font-size: 15px; font-weight: 800; letter-spacing: .16em; color: var(--ink); }
.brand-pill {
  font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  padding: 2px 8px; background: var(--ink); color: #fff;
}
.nav-end { margin-left: auto; display: flex; align-items: center; padding: 0 24px; gap: 20px; }
.nav-a { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--ink4); text-decoration: none; }
.nav-a:hover { color: var(--ink); }

/* ── Layout ── */
.page {
  position: relative; z-index: 10;
  max-width: 660px; margin: 0 auto;
  padding: 108px 16px 80px;
}

/* ── Filter bar ── */
.filters { display: flex; gap: 2px; margin-bottom: 24px; animation: fadeUp .3s both; }
.f-pill {
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  padding: 8px 18px; text-decoration: none;
  background: var(--surf); border: 1px solid var(--bd2); color: var(--ink4);
  transition: background .12s, color .12s;
}
.f-pill:hover { background: #F0F2F6; color: var(--ink2); }
.f-pill.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.f-count {
  margin-left: 7px; font-size: 9px; font-weight: 700;
  padding: 1px 6px; display: inline-flex; align-items: center;
}
.f-pill.on  .f-count { background: rgba(255,255,255,.15); }
.f-pill:not(.on) .f-count { background: rgba(9,11,15,.06); color: var(--ink3); }

/* ────────────────────────────────────────────
   CARD
──────────────────────────────────────────── */
.card {
  background: var(--surf);
  border: 1px solid var(--bd2);
  border-left-width: 2px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 8px;
  animation: fadeUp .3s both;
  transition: box-shadow .18s, transform .18s;
  overflow: hidden;
}
.card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
.card:nth-child(1) { animation-delay: .00s; }
.card:nth-child(2) { animation-delay: .04s; }
.card:nth-child(3) { animation-delay: .08s; }
.card:nth-child(4) { animation-delay: .11s; }
.card:nth-child(5) { animation-delay: .14s; }
.card.pass  { border-left-color: var(--pass); }
.card.shill { border-left-color: var(--shill); }

/* card header */
.c-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px 9px;
}
.pfp-wrap { position: relative; flex-shrink: 0; width: 28px; height: 28px; }
.pfp-img {
  width: 28px; height: 28px; border-radius: 50%;
  object-fit: cover; display: block;
  border: 1px solid var(--bd2); background: var(--surf2);
}
.pfp-fallback {
  position: absolute; inset: 0; border-radius: 50%;
  display: none; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; letter-spacing: 0;
  border: 1px solid var(--bd2);
}
.card.pass  .pfp-fallback { background: var(--pass-bg);  color: var(--pass);  border-color: var(--pass-bd); }
.card.shill .pfp-fallback { background: var(--shill-bg); color: var(--shill); border-color: var(--shill-bd); }

.c-author { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.c-handle {
  font-size: 12px; font-weight: 700; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: .01em; line-height: 1; flex-shrink: 0;
}
.c-time { font-size: 9.5px; color: var(--ink4); letter-spacing: .02em; }

/* right side of header */
.c-signal { display: flex; align-items: center; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.sig-label {
  font-size: 8px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  padding: 2px 7px; border: 1px solid;
}
.card.pass  .sig-label { color: var(--pass);  background: var(--pass-bg);  border-color: var(--pass-bd); }
.card.shill .sig-label { color: var(--shill); background: var(--shill-bg); border-color: var(--shill-bd); }
.sig-chip {
  font-size: 8px; font-weight: 500; letter-spacing: .07em; text-transform: uppercase;
  padding: 2px 7px; border: 1px solid var(--bd2);
  background: var(--surf2); color: var(--ink3);
}

/* divider */
.c-div { height: 1px; background: var(--bd); }

/* card body */
.c-body { padding: 10px 14px 8px; }
.c-text {
  font-size: 12.5px; line-height: 1.62; color: var(--ink2);
  white-space: pre-wrap; word-break: break-word; font-weight: 400;
}

/* images */
.c-imgs { display: flex; gap: 3px; margin-top: 8px; overflow: hidden; background: var(--surf2); }
.c-imgs img {
  flex: 1 1 0; min-width: 0; max-height: 200px;
  object-fit: cover; display: block; border: none;
}
.c-imgs img:only-child { max-height: 240px; }

/* stats + link row */
.c-foot {
  display: flex; align-items: center;
  padding: 7px 14px 9px;
}
.c-stats { display: flex; align-items: center; gap: 12px; flex: 1; }
.c-stat  { display: flex; align-items: center; gap: 4px; }
.c-stat svg { color: var(--ink5); flex-shrink: 0; }
.c-stat-n { font-size: 11px; font-weight: 600; color: var(--ink3); }
.c-xbtn {
  font-size: 8.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink4); text-decoration: none;
  padding: 4px 10px; border: 1px solid var(--bd2); background: var(--surf2);
  transition: all .14s; white-space: nowrap; flex-shrink: 0;
}
.c-xbtn:hover { background: var(--ink); color: #fff; border-color: var(--ink); }

/* reply block */
.c-reply {
  border-top: 1px solid var(--bd);
  padding: 8px 14px 10px 16px;
  background: var(--surf2);
  position: relative;
}
.c-reply::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px; background: var(--ink5);
}
.c-reply-label {
  font-size: 8.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink4); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;
}
.c-reply-label svg { opacity: .4; }
.c-reply-text {
  font-size: 11.5px; color: var(--ink2); line-height: 1.6;
  font-style: italic; letter-spacing: .01em;
}
.c-reply-link {
  display: inline-block; margin-top: 7px;
  font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink4); text-decoration: none;
}
.c-reply-link:hover { color: var(--ink); }

/* ── Empty ── */
.empty { text-align: center; padding: 100px 20px; color: var(--ink4); font-size: 12px; letter-spacing: .06em; }
.empty-mark { font-size: 24px; opacity: .2; margin-bottom: 14px; }

/* ── Footer ── */
.foot { text-align: center; padding: 28px 0 0; font-size: 10px; color: var(--ink4); letter-spacing: .06em; }
.foot a { color: var(--ink3); text-decoration: none; }
.foot a:hover { color: var(--ink); }
</style>
</head>
<body>

<!-- Top bar -->
<div class="topbar">
  <div class="tb-item">
    <?php if ($isLive): ?><span class="live-dot"></span><span class="tb-val">LIVE</span>
    <?php else: ?><span class="idle-dot"></span><span class="tb-val">IDLE</span><?php endif; ?>
  </div>
  <div class="tb-item"><span>SIGNALS</span><span class="tb-val"><?= $total ?></span></div>
  <div class="tb-item"><span>SHOWING</span><span class="tb-val"><?= $shown ?></span></div>
  <?php if ($lastAt): ?>
  <div class="tb-item"><span>LAST</span><span class="tb-val"><?= relTime($lastAt) ?></span></div>
  <?php endif; ?>
  <span id="tb-clock"></span>
</div>

<!-- Navbar -->
<div class="navbar">
  <a class="brand" href="/feed">
    <span class="brand-name">APTUM</span>
    <span class="brand-pill">FEED</span>
  </a>
  <div class="nav-end">
    <a href="https://x.com/aptum_" target="_blank" class="nav-a">@aptum_</a>
  </div>
</div>

<!-- Page -->
<div class="page">

  <!-- Filters -->
  <?php
  $sc = count(array_filter($all, fn($e) => ($e['signal']??'') === 'SHILL'));
  $pc = count(array_filter($all, fn($e) => ($e['signal']??'') === 'PASS'));
  ?>
  <div class="filters">
    <a href="?filter=all"   class="f-pill <?= $filter==='all'   ? 'on':'' ?>">All<span   class="f-count"><?= $total ?></span></a>
    <a href="?filter=pass"  class="f-pill <?= $filter==='pass'  ? 'on':'' ?>">Pass<span  class="f-count"><?= $pc ?></span></a>
    <a href="?filter=shill" class="f-pill <?= $filter==='shill' ? 'on':'' ?>">Shill<span class="f-count"><?= $sc ?></span></a>
  </div>

  <!-- Cards -->
  <?php if (empty($entries)): ?>
    <div class="empty">
      <div class="empty-mark">◎</div>
      No signals yet<?= $filter!=='all' ? ' for this filter' : '' ?>.
    </div>

  <?php else: foreach ($entries as $e):
    $tweetId   = htmlspecialchars($e['id']      ?? '');
    $author    = htmlspecialchars($e['author']  ?? '');
    $signal    = $e['signal'] ?? 'PASS';
    $topic     = $e['topic']  ?? '';
    $tone      = $e['tone']   ?? '';
    $reply     = htmlspecialchars($e['reply']   ?? '');
    $replyUrl  = htmlspecialchars($e['replyUrl'] ?? '');
    $time      = $e['engagedAt'] ?? $e['receivedAt'] ?? '';
    $tweetUrl  = "https://x.com/{$author}/status/{$tweetId}";
    $tweetText = htmlspecialchars($e['text'] ?? '');
    $imageUrls = is_array($e['imageUrls'] ?? null) ? $e['imageUrls'] : [];
    $stats     = is_array($e['stats']     ?? null) ? $e['stats']     : null;
    $isShill   = $signal === 'SHILL';
    $cls       = $isShill ? 'shill' : 'pass';
    $initial   = strtoupper(substr($author, 0, 1)) ?: '?';
    $pfpUrl    = "https://unavatar.io/x/" . urlencode($author);

    // build meta chips (skip empty / literal 'unknown')
    $tags = array_filter(
        array_map('trim', [$topic, $tone]),
        fn($t) => $t !== '' && $t !== 'unknown'
    );
  ?>

  <div class="card <?= $cls ?>">

    <!-- Header -->
    <div class="c-head">
      <div class="pfp-wrap">
        <img class="pfp-img" src="<?= htmlspecialchars($pfpUrl) ?>" alt=""
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
        <div class="pfp-fallback"><?= $initial ?></div>
      </div>

      <div class="c-author">
        <span class="c-handle">@<?= $author ?></span>
        <span class="c-time"><?= relTime($time) ?></span>
      </div>

      <div class="c-signal">
        <span class="sig-label"><?= $isShill ? 'SHILL' : 'PASS' ?></span>
        <?php foreach ($tags as $tag): ?>
          <span class="sig-chip"><?= htmlspecialchars($tag) ?></span>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="c-div"></div>

    <!-- Body -->
    <div class="c-body">
      <?php if ($tweetText): ?>
      <div class="c-text"><?= $tweetText ?></div>
      <?php endif; ?>

      <?php if (!empty($imageUrls)): ?>
      <div class="c-imgs">
        <?php foreach (array_slice($imageUrls, 0, 2) as $img):
          $imgSrc = htmlspecialchars(preg_replace('/\?.*$/', '', $img) . '?format=jpg&name=medium');
        ?>
          <img src="<?= $imgSrc ?>" alt="" loading="lazy"
               onerror="this.parentNode.children.length===1 ? this.parentNode.remove() : this.remove()">
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
    </div>

    <!-- Footer: stats + link -->
    <div class="c-foot">
      <div class="c-stats">
        <?php if ($stats && isset($stats['replies'])  && $stats['replies']  !== null): ?>
        <span class="c-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="c-stat-n"><?= fmtNum($stats['replies']) ?></span>
        </span>
        <?php endif; ?>
        <?php if ($stats && isset($stats['reposts'])  && $stats['reposts']  !== null): ?>
        <span class="c-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span class="c-stat-n"><?= fmtNum($stats['reposts']) ?></span>
        </span>
        <?php endif; ?>
        <?php if ($stats && isset($stats['likes'])    && $stats['likes']    !== null): ?>
        <span class="c-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span class="c-stat-n"><?= fmtNum($stats['likes']) ?></span>
        </span>
        <?php endif; ?>
      </div>
      <a href="<?= $tweetUrl ?>" target="_blank" class="c-xbtn">↗ View on X</a>
    </div>

    <!-- Reply -->
    <?php if ($reply): ?>
    <div class="c-reply">
      <div class="c-reply-label">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        aptum_ replied
      </div>
      <div class="c-reply-text"><?= $reply ?></div>
    </div>
    <?php endif; ?>

  </div>
  <?php endforeach; endif; ?>

  <!-- Load more -->
  <?php if ($total > $shown): ?>
  <div class="foot">
    Showing <?= $shown ?> of <?= $total ?> —
    <a href="?filter=<?= htmlspecialchars($filter) ?>&limit=<?= min($limit+50, MAX_ENTRIES) ?>">Load 50 more</a>
  </div>
  <?php else: ?>
  <div class="foot">All <?= $shown ?> signal<?= $shown!==1?'s':'' ?> loaded · <a href="?filter=<?= htmlspecialchars($filter) ?>">Refresh</a></div>
  <?php endif; ?>

</div>

<script>
(function() {
  function clock() {
    const d = new Date();
    document.getElementById('tb-clock').textContent =
      d.toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  clock(); setInterval(clock, 1000);
  setInterval(() => location.reload(), 60000);
})();
</script>
</body>
</html>
