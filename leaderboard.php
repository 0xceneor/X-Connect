<?php
/**
 * leaderboard.php — aptum.fun/leaderboard
 * Ranks evaluated X accounts by score + niche explorer chart
 */

define('EVAL_DIR', __DIR__ . '/evaluations/');

if (!is_dir(EVAL_DIR)) { $evals = []; }
else {
    $evals = [];
    foreach (glob(EVAL_DIR . '*.json') as $f) {
        if (basename($f) === 'queue.json') continue;
        $d = json_decode(file_get_contents($f), true);
        if (!$d || !isset($d['evaluation']['overall'])) continue;
        $evals[] = [
            'username'     => $d['username'] ?? basename($f, '.json'),
            'scannedAt'    => $d['scannedAt'] ?? null,
            'overall'      => (float)($d['evaluation']['overall'] ?? 0),
            'grade'        => $d['evaluation']['grade'] ?? '',
            'niche'        => $d['evaluation']['niche'] ?? '',
            'account_type' => $d['evaluation']['report']['account_type'] ?? '',
            'followers'    => $d['profile']['followers'] ?? '',
            'pfpUrl'       => $d['profile']['pfpUrl'] ?? '',
            'er_pct'       => $d['evaluation']['report']['weighted_er_pct'] ?? '',
            'verdict'      => $d['evaluation']['report']['verdict'] ?? '',
            'dimensions'   => array_values($d['evaluation']['dimensions'] ?? []),
        ];
    }
}

// Sort by score desc
usort($evals, fn($a, $b) => $b['overall'] <=> $a['overall']);

// Niche groups: bucket by niche string, top 5 per niche, sorted by best score
$niches = [];
foreach ($evals as $e) {
    $n = trim($e['niche']);
    if (!$n) continue;
    if (!isset($niches[$n])) $niches[$n] = [];
    $niches[$n][] = $e;
}
// Sort each niche group by score, keep top 5
foreach ($niches as $n => $members) {
    usort($niches[$n], fn($a, $b) => $b['overall'] <=> $a['overall']);
    $niches[$n] = array_slice($niches[$n], 0, 5);
}
// Sort niches by their top score
uasort($niches, fn($a, $b) => ($b[0]['overall'] ?? 0) <=> ($a[0]['overall'] ?? 0));

function scoreColor(float $s): string {
    if ($s >= 7) return '#0B7A42';
    if ($s >= 5) return 'rgba(10,12,18,0.55)';
    return '#B91C1C';
}
function barPct(float $s): int { return (int)(($s / 10) * 100); }
function relTime(?string $iso): string {
    if (!$iso) return '';
    $d = time() - strtotime($iso);
    if ($d < 60)    return $d . 's ago';
    if ($d < 3600)  return floor($d/60) . 'm ago';
    if ($d < 86400) return floor($d/3600) . 'h ago';
    return floor($d/86400) . 'd ago';
}
// Parse followers string like "11.5K", "1.2M" → numeric for display sorting
function followersNum(string $f): float {
    $f = strtoupper(trim($f));
    if (preg_match('/^([\d,.]+)([KM]?)$/', $f, $m)) {
        $n = (float)str_replace(',', '', $m[1]);
        if ($m[2] === 'K') return $n * 1000;
        if ($m[2] === 'M') return $n * 1000000;
        return $n;
    }
    return 0;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Leaderboard — aptum_</title>
<meta property="og:title" content="X Account Leaderboard — aptum_">
<meta property="og:description" content="Top-ranked X accounts evaluated by aptum AI. Sorted by score across 5 dimensions.">
<meta property="og:image" content="https://aptum.fun/feed-preview.png">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#F4F5F8;--bg1:#ECEEF3;--bg2:#FFFFFF;--bg3:#F8F9FB;
  --bdr:rgba(9,11,16,0.12);--bdr2:rgba(9,11,16,0.22);--bdr3:rgba(9,11,16,0.30);
  --ink:#0A0C12;--ink2:rgba(10,12,18,0.80);--ink3:rgba(10,12,18,0.62);
  --ink4:rgba(10,12,18,0.45);--ink5:rgba(10,12,18,0.20);
  --green:#0B7A42;--green-bg:rgba(11,122,66,0.08);--red:#B91C1C;
  --gold:#B8860B;--gold-bg:rgba(184,134,11,0.08);
  --mono:'IBM Plex Mono',monospace;--disp:'Syne',sans-serif;
}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
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
.navbar{position:fixed;top:32px;left:0;right:0;z-index:200;height:52px;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1.5px solid var(--bdr2);display:flex;align-items:stretch;}
.brand{display:flex;align-items:center;gap:10px;padding:0 24px;border-right:1px solid var(--bdr2);text-decoration:none;}
.brand-name{font-family:var(--disp);font-size:15px;font-weight:800;letter-spacing:.16em;color:var(--ink);}
.brand-pill{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:2px 9px;background:var(--ink);color:#fff;}
.nav-end{margin-left:auto;display:flex;align-items:center;padding:0 24px;gap:22px;}
.nav-a{font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);text-decoration:none;transition:color .12s;}
.nav-a:hover{color:var(--ink);}
.nav-a.active{color:var(--ink);}

/* PAGE */
.page{position:relative;z-index:10;max-width:920px;margin:0 auto;padding:104px 18px 80px;}

/* HERO */
.hero{margin-bottom:32px;animation:fadeUp .4s both;}
.hero-eyebrow{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ink4);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.hero-line{width:28px;height:1px;background:var(--bdr2);}
.hero-title{font-family:var(--disp);font-size:clamp(22px,3vw,30px);font-weight:800;letter-spacing:-.01em;color:var(--ink);margin-bottom:5px;}
.hero-sub{font-size:11px;color:var(--ink4);letter-spacing:.04em;font-weight:500;}

/* PANEL */
.panel{background:var(--bg2);border:1px solid var(--bdr2);margin-bottom:12px;animation:fadeUp .4s both;}
.sec-hd{padding:9px 18px;border-bottom:1px solid var(--bdr2);display:flex;align-items:center;gap:10px;background:var(--bg1);}
.sec-num{font-size:8px;color:var(--ink4);letter-spacing:.1em;font-weight:700;border:1px solid var(--bdr);padding:2px 6px;background:var(--bg3);}
.sec-pipe{color:var(--bdr2);}
.sec-title{font-size:10.5px;color:var(--ink);letter-spacing:.12em;text-transform:uppercase;font-weight:700;}
.sec-sub{font-size:10px;color:var(--ink4);flex:1;font-weight:500;}
.sec-status{font-size:8.5px;color:var(--ink4);margin-left:auto;letter-spacing:.08em;font-weight:600;white-space:nowrap;}
.sec-status.ok{color:var(--green);}

/* ── LEADERBOARD TABLE ── */
.lb-table{width:100%;border-collapse:collapse;}
.lb-head th{padding:8px 14px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4);font-weight:700;text-align:left;border-bottom:1px solid var(--bdr2);background:var(--bg1);white-space:nowrap;}
.lb-head th.r{text-align:right;}
.lb-row{border-bottom:1px solid var(--bdr);transition:background .1s;cursor:pointer;}
.lb-row:last-child{border-bottom:none;}
.lb-row:hover{background:var(--bg3);}
.lb-row td{padding:11px 14px;vertical-align:middle;}
.lb-row td.r{text-align:right;}

/* rank cell */
.lb-rank{font-size:11px;font-weight:700;color:var(--ink4);letter-spacing:.06em;min-width:32px;text-align:center;}
.lb-rank.gold{color:#B8860B;}
.lb-rank.silver{color:rgba(10,12,18,0.55);}
.lb-rank.bronze{color:#7C4A00;}

/* account cell */
.lb-acc{display:flex;align-items:center;gap:10px;min-width:160px;}
.lb-pfp{width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--bg3);flex-shrink:0;border:1px solid var(--bdr);}
.lb-handle{font-size:12px;font-weight:700;color:var(--ink);letter-spacing:.01em;}
.lb-niche{font-size:8.5px;color:var(--ink4);letter-spacing:.04em;margin-top:2px;}

/* score cell */
.lb-score-wrap{display:flex;align-items:center;gap:8px;min-width:110px;}
.lb-score-num{font-family:var(--disp);font-size:18px;font-weight:800;line-height:1;min-width:38px;text-align:right;}
.lb-bar-col{flex:1;}
.lb-bar{height:3px;background:var(--bdr);width:100%;min-width:48px;}
.lb-bar-fill{height:100%;}

/* grade cell */
.lb-grade{font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--ink3);white-space:nowrap;}

/* followers cell */
.lb-followers{font-size:11.5px;font-weight:600;color:var(--ink2);white-space:nowrap;text-align:right;}

/* ER cell */
.lb-er{font-size:10px;font-weight:600;color:var(--ink3);white-space:nowrap;text-align:right;}

/* time cell */
.lb-time{font-size:9px;color:var(--ink4);white-space:nowrap;text-align:right;}

/* top-3 medal rows */
.lb-row.rank-1{background:rgba(184,134,11,0.04);}
.lb-row.rank-2{background:rgba(160,160,160,0.04);}
.lb-row.rank-3{background:rgba(124,74,0,0.04);}

/* ── NICHE CHART ── */
.niche-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px;background:var(--bdr);border:1px solid var(--bdr);}
.niche-card{background:var(--bg2);padding:0;transition:background .12s;}
.niche-card:hover{background:var(--bg3);}
.niche-card-hd{padding:10px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:10px;}
.niche-name{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.niche-count{font-size:8px;color:var(--ink4);letter-spacing:.06em;white-space:nowrap;}
.niche-members{display:flex;flex-direction:column;}
.niche-member{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--bdr);text-decoration:none;}
.niche-member:last-child{border-bottom:none;}
.niche-member:hover{background:rgba(9,11,16,.04);}
.niche-m-pfp{width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--bg3);flex-shrink:0;border:1px solid var(--bdr);}
.niche-m-handle{font-size:10.5px;font-weight:700;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.niche-m-score{font-size:10.5px;font-weight:700;white-space:nowrap;}
.niche-m-bar-wrap{width:44px;height:3px;background:var(--bdr);flex-shrink:0;}
.niche-m-bar{height:100%;}

/* ── NICHE BAR CHART ── */
.niche-bar-chart{display:flex;flex-direction:column;gap:0;}
.nbc-row{display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--bdr);transition:background .1s;}
.nbc-row:last-child{border-bottom:none;}
.nbc-row:hover{background:var(--bg3);}
.nbc-label{font-size:9.5px;font-weight:700;color:var(--ink);letter-spacing:.04em;width:160px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nbc-bar-wrap{flex:1;height:6px;background:var(--bdr);position:relative;}
.nbc-bar{height:100%;transition:width .4s;}
.nbc-meta{display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:100px;justify-content:flex-end;}
.nbc-avg{font-size:10px;font-weight:700;color:var(--ink2);}
.nbc-count{font-size:9px;color:var(--ink4);}

/* empty */
.empty{padding:32px 18px;text-align:center;font-size:12px;color:var(--ink4);}
</style>
</head>
<body>

<div class="topbar">
  <div class="tb-item"><span class="tb-live-dot"></span><span>LEADERBOARD</span><span class="tb-val"><?= count($evals) ?> ACCOUNTS</span></div>
  <div class="tb-item"><span>NICHES</span><span class="tb-val"><?= count($niches) ?></span></div>
  <span id="tb-clock"></span>
</div>

<div class="navbar">
  <a class="brand" href="/feed">
    <span class="brand-name">APTUM</span>
    <span class="brand-pill">LB</span>
  </a>
  <div class="nav-end">
    <a href="/feed" class="nav-a">Feed</a>
    <a href="/evaluate" class="nav-a">Evaluate</a>
    <a href="/leaderboard" class="nav-a active">Leaderboard</a>
    <a href="https://x.com/aptum_" target="_blank" class="nav-a">@aptum_</a>
  </div>
</div>

<div class="page">

  <div class="hero">
    <div class="hero-eyebrow"><span class="hero-line"></span>AI-RANKED ACCOUNTS<span class="hero-line"></span></div>
    <div class="hero-title">Leaderboard</div>
    <div class="hero-sub">Top X accounts ranked by aptum AI score across 5 dimensions.</div>
  </div>

  <?php if (empty($evals)): ?>
  <div class="panel"><div class="empty">No evaluations yet. <a href="/evaluate" style="color:var(--ink);font-weight:700;">Run one →</a></div></div>
  <?php else: ?>

  <!-- ── §01 RANKINGS ── -->
  <div class="panel">
    <div class="sec-hd">
      <span class="sec-num">01</span><span class="sec-pipe">|</span>
      <span class="sec-title">Rankings</span>
      <span class="sec-sub">Sorted by overall AI score</span>
      <span class="sec-status ok"><?= count($evals) ?> accounts</span>
    </div>
    <div style="overflow-x:auto;">
    <table class="lb-table">
      <thead class="lb-head">
        <tr>
          <th style="width:42px;text-align:center;">#</th>
          <th>Account</th>
          <th>Score</th>
          <th>Grade</th>
          <th class="r">Followers</th>
          <th class="r">ER</th>
          <th class="r">Scanned</th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($evals as $i => $e):
          $rank = $i + 1;
          $rankClass = $rank === 1 ? 'rank-1' : ($rank === 2 ? 'rank-2' : ($rank === 3 ? 'rank-3' : ''));
          $medalClass = $rank === 1 ? 'gold' : ($rank === 2 ? 'silver' : ($rank === 3 ? 'bronze' : ''));
          $sc = scoreColor($e['overall']);
          $pct = barPct($e['overall']);
          $medal = $rank === 1 ? '①' : ($rank === 2 ? '②' : ($rank === 3 ? '③' : $rank));
        ?>
        <tr class="lb-row <?= $rankClass ?>" onclick="location.href='/evaluate?u=<?= urlencode($e['username']) ?>'">
          <td><div class="lb-rank <?= $medalClass ?>"><?= $medal ?></div></td>
          <td>
            <div class="lb-acc">
              <img class="lb-pfp" src="<?= htmlspecialchars($e['pfpUrl'] ?: 'https://unavatar.io/x/'.urlencode($e['username'])) ?>"
                   onerror="this.src='https://unavatar.io/x/<?= urlencode($e['username']) ?>';this.onerror=null" alt="">
              <div>
                <div class="lb-handle">@<?= htmlspecialchars($e['username']) ?></div>
                <?php if ($e['niche']): ?><div class="lb-niche"><?= htmlspecialchars($e['niche']) ?></div><?php endif; ?>
              </div>
            </div>
          </td>
          <td>
            <div class="lb-score-wrap">
              <div class="lb-score-num" style="color:<?= $sc ?>"><?= number_format($e['overall'], 1) ?></div>
              <div class="lb-bar-col">
                <div class="lb-bar"><div class="lb-bar-fill" style="width:<?= $pct ?>%;background:<?= $sc ?>"></div></div>
              </div>
            </div>
          </td>
          <td><span class="lb-grade"><?= htmlspecialchars($e['grade']) ?></span></td>
          <td class="r"><span class="lb-followers"><?= htmlspecialchars($e['followers']) ?></span></td>
          <td class="r"><span class="lb-er"><?= htmlspecialchars($e['er_pct']) ?></span></td>
          <td class="r"><span class="lb-time"><?= relTime($e['scannedAt']) ?></span></td>
        </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
    </div>
  </div>

  <!-- ── §02 NICHE BAR CHART ── -->
  <?php if (count($niches) >= 2):
    // Compute avg score per niche
    $nicheStats = [];
    foreach ($niches as $n => $members) {
        $avg = array_sum(array_column($members, 'overall')) / count($members);
        $nicheStats[$n] = ['avg' => $avg, 'count' => count($members), 'top' => $members[0]];
    }
    uasort($nicheStats, fn($a, $b) => $b['avg'] <=> $a['avg']);
    $maxAvg = max(array_column($nicheStats, 'avg'));
  ?>
  <div class="panel">
    <div class="sec-hd">
      <span class="sec-num">02</span><span class="sec-pipe">|</span>
      <span class="sec-title">Niche Strength Index</span>
      <span class="sec-sub">Average score by content category</span>
      <span class="sec-status"><?= count($nicheStats) ?> niches</span>
    </div>
    <div class="niche-bar-chart">
      <?php foreach ($nicheStats as $n => $ns):
        $pct = $maxAvg > 0 ? round(($ns['avg'] / $maxAvg) * 100) : 0;
        $sc = scoreColor($ns['avg']);
      ?>
      <div class="nbc-row" onclick="location.href='/evaluate?u=<?= urlencode($ns['top']['username']) ?>'" style="cursor:pointer;">
        <div class="nbc-label"><?= htmlspecialchars($n) ?></div>
        <div class="nbc-bar-wrap">
          <div class="nbc-bar" style="width:<?= $pct ?>%;background:<?= $sc ?>;"></div>
        </div>
        <div class="nbc-meta">
          <span class="nbc-avg" style="color:<?= $sc ?>"><?= number_format($ns['avg'], 1) ?></span>
          <span class="nbc-count"><?= $ns['count'] ?> acct<?= $ns['count'] !== 1 ? 's' : '' ?></span>
        </div>
      </div>
      <?php endforeach; ?>
    </div>
  </div>
  <?php endif; ?>

  <!-- ── §03 BEST TO FOLLOW BY NICHE ── -->
  <div class="panel">
    <div class="sec-hd">
      <span class="sec-num">03</span><span class="sec-pipe">|</span>
      <span class="sec-title">Best To Follow</span>
      <span class="sec-sub">Top accounts per content niche</span>
    </div>
    <?php if (empty($niches)): ?>
    <div class="empty">No niche data yet.</div>
    <?php else: ?>
    <div class="niche-grid">
      <?php foreach ($niches as $niche => $members): ?>
      <div class="niche-card">
        <div class="niche-card-hd">
          <span class="niche-name"><?= htmlspecialchars($niche) ?></span>
          <span class="niche-count"><?= count($members) ?> ranked</span>
        </div>
        <div class="niche-members">
          <?php foreach ($members as $j => $m):
            $msc = scoreColor($m['overall']);
            $mpct = barPct($m['overall']);
          ?>
          <a class="niche-member" href="/evaluate?u=<?= urlencode($m['username']) ?>">
            <img class="niche-m-pfp" src="<?= htmlspecialchars($m['pfpUrl'] ?: 'https://unavatar.io/x/'.urlencode($m['username'])) ?>"
                 onerror="this.src='https://unavatar.io/x/<?= urlencode($m['username']) ?>';this.onerror=null" alt="">
            <span class="niche-m-handle">@<?= htmlspecialchars($m['username']) ?></span>
            <?php if ($m['followers']): ?><span style="font-size:9px;color:var(--ink4);white-space:nowrap;"><?= htmlspecialchars($m['followers']) ?></span><?php endif; ?>
            <span class="niche-m-score" style="color:<?= $msc ?>"><?= number_format($m['overall'], 1) ?></span>
            <div class="niche-m-bar-wrap"><div class="niche-m-bar" style="width:<?= $mpct ?>%;background:<?= $msc ?>"></div></div>
          </a>
          <?php endforeach; ?>
        </div>
      </div>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>
  </div>

  <?php endif; ?>

</div>

<script>
(function(){
  function clock(){var d=new Date(),el=document.getElementById('tb-clock');
    if(el)el.textContent=d.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});}
  clock();setInterval(clock,1000);
})();
</script>
</body>
</html>
