<?php
/**
 * feed.php — Signal Feed
 *
 * Dual-purpose:
 *   POST  → push receiver (called by x-feed-engage.js after each engagement)
 *   GET   → renders the live signal feed at aptum.fun/feed
 */

define('PUSH_SECRET', getenv('FEED_PUSH_SECRET') ?: '68b68e6fc9c5bb4203c4352c491903836bb639690fb8df19');
define('FEED_DATA',   __DIR__ . '/feed-data.json');
define('MAX_ENTRIES', 500);
define('DEFAULT_LIMIT', 50);

// ── POST: push receiver ─────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw, true);

    if (!$data || !PUSH_SECRET || ($data['secret'] ?? '') !== PUSH_SECRET) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }

    unset($data['secret']);
    $data['receivedAt'] = date('c');

    $feed = file_exists(FEED_DATA)
        ? (json_decode(file_get_contents(FEED_DATA), true) ?: [])
        : [];

    array_unshift($feed, $data);
    if (count($feed) > MAX_ENTRIES) $feed = array_slice($feed, 0, MAX_ENTRIES);

    file_put_contents(FEED_DATA, json_encode($feed, JSON_PRETTY_PRINT));
    echo json_encode(['ok' => true, 'total' => count($feed)]);
    exit;
}

// ── GET: display ────────────────────────────────────────────────────────────
$all    = file_exists(FEED_DATA) ? (json_decode(file_get_contents(FEED_DATA), true) ?: []) : [];
$filter = $_GET['filter'] ?? 'all';
$limit  = min((int)($_GET['limit'] ?? DEFAULT_LIMIT), MAX_ENTRIES);

$entries = $all;
if ($filter === 'shill') {
    $entries = array_values(array_filter($entries, fn($e) => ($e['signal'] ?? '') === 'SHILL'));
} elseif ($filter === 'pass') {
    $entries = array_values(array_filter($entries, fn($e) => ($e['signal'] ?? '') === 'PASS'));
}

$total   = count($all);
$shown   = min($limit, count($entries));
$entries = array_slice($entries, 0, $limit);

$lastAt = $all[0]['engagedAt'] ?? $all[0]['receivedAt'] ?? null;
$isLive = $lastAt && (time() - strtotime($lastAt)) < 3600;

function relTime(?string $iso): string {
    if (!$iso) return '';
    $d = time() - strtotime($iso);
    if ($d < 60)    return $d . 's ago';
    if ($d < 3600)  return floor($d / 60)  . 'm ago';
    if ($d < 86400) return floor($d / 3600) . 'h ago';
    return floor($d / 86400) . 'd ago';
}

function fmtNum(?int $n): string {
    if ($n === null) return '';
    if ($n >= 1000000) return round($n / 1000000, 1) . 'M';
    if ($n >= 1000)    return round($n / 1000, 1) . 'K';
    return (string)$n;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Signal Feed — aptum_</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg0: #ECEEF2; --bg1: #E4E7EC; --bg2: #FFFFFF; --bg3: #F5F6F9;
  --bd:  rgba(10,12,16,.10); --bd2: rgba(10,12,16,.16); --bd3: rgba(10,12,16,.30);
  --ink: #090B0F; --ink2: rgba(9,11,15,.86); --ink3: rgba(9,11,15,.58);
  --ink4: rgba(9,11,15,.38); --ink5: rgba(9,11,15,.14);
  --green: #0A7A3E; --greenbg: rgba(10,122,62,.07); --greenborder: rgba(10,122,62,.25);
  --amber: #92400E; --amberbg: rgba(180,83,9,.07); --amberborder: rgba(146,64,14,.22);
  --mono: 'IBM Plex Mono', monospace;
  --disp: 'Syne', sans-serif;
  --radius: 2px;
}
@keyframes fadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
@keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.25} }

body { background: var(--bg0); color: var(--ink); font-family: var(--mono); min-height: 100vh; }

.grid-bg {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(var(--bd) 1px, transparent 1px),
                    linear-gradient(90deg, var(--bd) 1px, transparent 1px);
  background-size: 40px 40px; opacity: .5;
}

/* ── Status Bar ── */
.status-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 200;
  height: 30px; background: var(--ink);
  border-bottom: 1px solid rgba(255,255,255,.07);
  display: flex; align-items: center; padding: 0 16px;
}
.si {
  display: flex; align-items: center; gap: 6px;
  padding: 0 14px; height: 30px;
  border-right: 1px solid rgba(255,255,255,.08);
  color: rgba(255,255,255,.40); font-size: 10px; letter-spacing: .1em;
}
.si:first-child { border-left: 1px solid rgba(255,255,255,.08); }
.sv { font-weight: 700; color: rgba(255,255,255,.85); }
.dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.dot.live { background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,.7); animation: pulse 2s infinite; }
.dot.off  { background: rgba(255,255,255,.2); }
#clock { font-size: 10px; color: rgba(255,255,255,.25); letter-spacing: .1em; margin-left: auto; }

/* ── Navbar ── */
.navbar {
  position: fixed; top: 30px; left: 0; right: 0; z-index: 100;
  height: 48px; background: var(--bg2);
  border-bottom: 2px solid var(--bd3);
  display: flex; align-items: stretch;
  box-shadow: 0 2px 16px rgba(10,12,16,.06);
}
.brand {
  display: flex; align-items: center; padding: 0 22px;
  border-right: 2px solid var(--bd3); gap: 10px; text-decoration: none;
}
.brand-name { font-family: var(--disp); font-size: 16px; font-weight: 800; letter-spacing: .14em; color: var(--ink); }
.brand-badge { font-size: 10px; font-weight: 700; color: var(--bg2); letter-spacing: .12em; background: var(--ink); padding: 2px 8px; }
.nav-right { margin-left: auto; display: flex; align-items: center; padding-right: 20px; }
.nav-link { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink4); text-decoration: none; font-weight: 600; }
.nav-link:hover { color: var(--ink); }

/* ── Content ── */
.content {
  position: relative; z-index: 10;
  margin-top: 78px; padding: 24px 16px 80px;
  max-width: 680px; margin-left: auto; margin-right: auto;
}

/* ── Filter Bar ── */
.filter-bar { display: flex; gap: 2px; margin-bottom: 20px; animation: fadeUp .3s both; }
.filter-pill {
  font-family: var(--mono); font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; font-weight: 700; padding: 7px 16px;
  border: 1px solid var(--bd2); background: var(--bg2); color: var(--ink4);
  text-decoration: none; transition: all .15s;
}
.filter-pill:hover  { background: var(--bg1); color: var(--ink2); }
.filter-pill.active { background: var(--ink); color: var(--bg2); border-color: var(--ink); }
.filter-count {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; margin-left: 6px;
  padding: 1px 6px; min-width: 20px;
  background: rgba(255,255,255,.18);
}
.filter-pill:not(.active) .filter-count { background: var(--bg0); color: var(--ink3); }

/* ── Tweet Card ── */
.tweet-card {
  background: var(--bg2);
  border: 1px solid var(--bd2);
  border-left: 3px solid var(--bd3);
  box-shadow: 0 1px 8px rgba(10,12,16,.04), 0 4px 20px rgba(10,12,16,.03);
  margin-bottom: 12px;
  animation: fadeUp .35s both;
  transition: box-shadow .15s, transform .15s;
}
.tweet-card:hover { box-shadow: 0 4px 24px rgba(10,12,16,.10); transform: translateY(-1px); }
.tweet-card:nth-child(2)  { animation-delay: .04s; }
.tweet-card:nth-child(3)  { animation-delay: .08s; }
.tweet-card:nth-child(4)  { animation-delay: .12s; }
.tweet-card:nth-child(5)  { animation-delay: .15s; }
.tweet-card.is-pass  { border-left-color: var(--green); }
.tweet-card.is-shill { border-left-color: #D97706; }

/* ── Card Header ── */
.card-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--bd);
}
.avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; letter-spacing: 0;
  border: 1.5px solid var(--bd2);
}
.is-pass  .avatar { background: var(--greenbg); color: var(--green); border-color: var(--greenborder); }
.is-shill .avatar { background: var(--amberbg);  color: var(--amber); border-color: var(--amberborder); }
.author-block { flex: 1; min-width: 0; }
.author-name {
  font-size: 12px; font-weight: 700; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: .01em;
}
.author-meta {
  display: flex; align-items: center; gap: 8px; margin-top: 2px; flex-wrap: wrap;
}
.author-time { font-size: 9.5px; color: var(--ink4); letter-spacing: .04em; }
.header-badges { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-left: auto; }

/* ── Badges ── */
.badge {
  display: inline-flex; align-items: center;
  font-size: 8.5px; letter-spacing: .1em; text-transform: uppercase;
  padding: 2px 7px; font-weight: 700; flex-shrink: 0;
}
.badge-shill { background: var(--amberbg);  color: var(--amber); border: 1px solid var(--amberborder); }
.badge-pass  { background: var(--greenbg);  color: var(--green); border: 1px solid var(--greenborder); }
.badge-topic { background: var(--bg0); color: var(--ink3); border: 1px solid var(--bd2); font-weight: 500; }

/* ── Tweet Body ── */
.tweet-body { padding: 14px 16px 12px; }
.tweet-text {
  font-size: 13.5px; line-height: 1.65; color: var(--ink2);
  white-space: pre-wrap; word-break: break-word; font-weight: 400;
}

/* ── Images ── */
.tweet-images { display: flex; gap: 5px; margin-top: 12px; border-radius: var(--radius); overflow: hidden; }
.tweet-images img {
  flex: 1 1 0; min-width: 0; max-height: 280px;
  object-fit: cover; display: block;
  border: 1px solid var(--bd); background: var(--bg1);
}
.tweet-images img:only-child { max-height: 340px; }

/* ── Stats row ── */
.tweet-stats {
  display: flex; align-items: center; gap: 16px;
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--bd);
}
.tweet-stat { display: flex; align-items: center; gap: 5px; }
.tweet-stat svg { opacity: .35; flex-shrink: 0; }
.stat-val { font-size: 11px; font-weight: 600; color: var(--ink3); letter-spacing: .02em; }
.stat-label { font-size: 9px; color: var(--ink4); letter-spacing: .06em; text-transform: uppercase; }
.tweet-xlink {
  margin-left: auto; font-size: 9px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink4); text-decoration: none;
  padding: 4px 10px; border: 1px solid var(--bd2); background: var(--bg0);
  transition: all .15s;
}
.tweet-xlink:hover { background: var(--ink); color: #fff; border-color: var(--ink); }

/* ── Reply section ── */
.reply-section {
  border-top: 1px solid var(--bd);
  padding: 10px 16px 12px;
  background: var(--bg3);
  position: relative;
}
.reply-section::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--ink5);
}
.reply-label {
  font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase;
  font-weight: 700; color: var(--ink4); margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
}
.reply-label::before { content: '↳'; font-style: normal; opacity: .5; }
.reply-text {
  font-size: 12px; color: var(--ink2); line-height: 1.6;
  font-style: italic; letter-spacing: .01em;
}
.reply-link {
  display: inline-block; margin-top: 7px;
  font-size: 9px; color: var(--ink4); text-decoration: none;
  letter-spacing: .06em; font-weight: 600;
}
.reply-link:hover { color: var(--ink); }

/* ── Empty ── */
.empty { text-align: center; padding: 80px 20px; color: var(--ink4); font-size: 12px; letter-spacing: .06em; }
.empty-icon { font-size: 28px; margin-bottom: 12px; opacity: .25; }

/* ── Footer ── */
.feed-footer { text-align: center; padding: 20px 0; font-size: 10px; color: var(--ink4); letter-spacing: .06em; }
.feed-footer a { color: var(--ink3); text-decoration: none; }
.feed-footer a:hover { color: var(--ink); }
</style>
</head>
<body>

<div class="grid-bg"></div>

<!-- Status Bar -->
<div class="status-bar">
  <div class="si">
    <span class="dot <?= $isLive ? 'live' : 'off' ?>"></span>
    <span class="sv"><?= $isLive ? 'LIVE' : 'IDLE' ?></span>
  </div>
  <div class="si"><span>TOTAL</span><span class="sv"><?= $total ?></span></div>
  <div class="si"><span>SHOWING</span><span class="sv"><?= $shown ?></span></div>
  <?php if ($lastAt): ?>
  <div class="si"><span>LAST</span><span class="sv"><?= relTime($lastAt) ?></span></div>
  <?php endif; ?>
  <span id="clock"></span>
</div>

<!-- Navbar -->
<div class="navbar">
  <a class="brand" href="/feed">
    <span class="brand-name">APTUM</span>
    <span class="brand-badge">FEED</span>
  </a>
  <div class="nav-right">
    <a href="https://x.com/aptum_" target="_blank" class="nav-link">@aptum_</a>
  </div>
</div>

<!-- Content -->
<div class="content">

  <!-- Filter Bar -->
  <?php
  $shillCount = count(array_filter($all, fn($e) => ($e['signal'] ?? '') === 'SHILL'));
  $passCount  = count(array_filter($all, fn($e) => ($e['signal'] ?? '') === 'PASS'));
  ?>
  <div class="filter-bar">
    <a href="?filter=all"   class="filter-pill <?= $filter==='all'   ? 'active' : '' ?>">All<span   class="filter-count"><?= $total ?></span></a>
    <a href="?filter=pass"  class="filter-pill <?= $filter==='pass'  ? 'active' : '' ?>">Pass<span  class="filter-count"><?= $passCount ?></span></a>
    <a href="?filter=shill" class="filter-pill <?= $filter==='shill' ? 'active' : '' ?>">Shill<span class="filter-count"><?= $shillCount ?></span></a>
  </div>

  <!-- Feed -->
  <?php if (empty($entries)): ?>
    <div class="empty">
      <div class="empty-icon">◎</div>
      No signals yet<?= $filter !== 'all' ? ' for this filter' : '' ?>.
    </div>
  <?php else: foreach ($entries as $i => $e):
    $tweetId   = htmlspecialchars($e['id']     ?? '');
    $author    = htmlspecialchars($e['author'] ?? '');
    $signal    = $e['signal'] ?? 'PASS';
    $topic     = htmlspecialchars($e['topic']  ?? '');
    $tone      = htmlspecialchars($e['tone']   ?? '');
    $reply     = htmlspecialchars($e['reply']  ?? '');
    $replyUrl  = htmlspecialchars($e['replyUrl'] ?? '');
    $time      = $e['engagedAt'] ?? $e['receivedAt'] ?? '';
    $tweetUrl  = "https://x.com/{$author}/status/{$tweetId}";
    $tweetText = htmlspecialchars($e['text'] ?? '');
    $imageUrls = is_array($e['imageUrls'] ?? null) ? $e['imageUrls'] : [];
    $stats     = is_array($e['stats']     ?? null) ? $e['stats']     : null;
    $isShill   = $signal === 'SHILL';
    $cardClass = $isShill ? 'is-shill' : 'is-pass';
    $avatarChar = strtoupper(substr($author, 0, 1)) ?: '?';
  ?>
  <div class="tweet-card <?= $cardClass ?>">

    <!-- Header -->
    <div class="card-header">
      <div class="avatar"><?= $avatarChar ?></div>
      <div class="author-block">
        <div class="author-name">@<?= $author ?></div>
        <div class="author-meta">
          <span class="author-time"><?= relTime($time) ?></span>
        </div>
      </div>
      <div class="header-badges">
        <?php if ($isShill): ?>
          <span class="badge badge-shill">SHILL</span>
        <?php else: ?>
          <span class="badge badge-pass">PASS</span>
        <?php endif; ?>
        <?php if ($topic && $topic !== 'unknown'): ?><span class="badge badge-topic"><?= $topic ?></span><?php endif; ?>
        <?php if ($tone  && $tone  !== 'unknown'): ?><span class="badge badge-topic"><?= $tone  ?></span><?php endif; ?>
      </div>
    </div>

    <!-- Body -->
    <div class="tweet-body">
      <?php if ($tweetText): ?>
      <div class="tweet-text"><?= $tweetText ?></div>
      <?php endif; ?>

      <?php if (!empty($imageUrls)): ?>
      <div class="tweet-images">
        <?php foreach (array_slice($imageUrls, 0, 2) as $imgUrl):
          $safeImg = htmlspecialchars(preg_replace('/\?.*$/', '', $imgUrl) . '?format=jpg&name=medium');
        ?>
          <img src="<?= $safeImg ?>" alt="" loading="lazy" onerror="this.parentNode.removeChild(this)">
        <?php endforeach; ?>
      </div>
      <?php endif; ?>

      <div class="tweet-stats">
        <?php if ($stats && isset($stats['replies']) && $stats['replies'] !== null): ?>
        <span class="tweet-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="stat-val"><?= fmtNum($stats['replies']) ?></span>
        </span>
        <?php endif; ?>
        <?php if ($stats && isset($stats['reposts']) && $stats['reposts'] !== null): ?>
        <span class="tweet-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span class="stat-val"><?= fmtNum($stats['reposts']) ?></span>
        </span>
        <?php endif; ?>
        <?php if ($stats && isset($stats['likes']) && $stats['likes'] !== null): ?>
        <span class="tweet-stat">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span class="stat-val"><?= fmtNum($stats['likes']) ?></span>
        </span>
        <?php endif; ?>
        <a href="<?= $tweetUrl ?>" target="_blank" class="tweet-xlink">↗ X</a>
      </div>
    </div>

    <!-- Reply -->
    <?php if ($reply): ?>
    <div class="reply-section">
      <div class="reply-label">aptum_ replied</div>
      <div class="reply-text"><?= $reply ?></div>
      <?php if ($replyUrl): ?>
        <a href="<?= $replyUrl ?>" target="_blank" class="reply-link">view reply on X →</a>
      <?php endif; ?>
    </div>
    <?php endif; ?>

  </div>
  <?php endforeach; endif; ?>

  <!-- Footer -->
  <?php if ($total > $shown): ?>
  <div class="feed-footer">
    Showing <?= $shown ?> of <?= $total ?> —
    <a href="?filter=<?= htmlspecialchars($filter) ?>&limit=<?= min($limit + 50, MAX_ENTRIES) ?>">load 50 more</a>
  </div>
  <?php else: ?>
  <div class="feed-footer">All <?= $shown ?> signal<?= $shown !== 1 ? 's' : '' ?> loaded</div>
  <?php endif; ?>

</div>

<script>
function updateClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateClock();
setInterval(updateClock, 1000);
setInterval(() => location.reload(), 60000);
</script>

</body>
</html>
