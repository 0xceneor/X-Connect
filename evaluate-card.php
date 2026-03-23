<?php
/**
 * evaluate-card.php — Card-only renderer for Puppeteer screenshots
 * GET ?u=username → 400×620 NFT Creator Card, no page chrome
 */
define('EVAL_DIR', __DIR__ . '/evaluations/');

$username = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['u'] ?? '');
if (!$username) { http_response_code(400); echo 'No username'; exit; }
$file = EVAL_DIR . strtolower($username) . '.json';
if (!file_exists($file)) { http_response_code(404); echo 'Evaluation not found'; exit; }
$evalData = json_decode(file_get_contents($file), true);
if (!$evalData || !isset($evalData['evaluation'])) { http_response_code(500); echo 'Bad data'; exit; }

$ev      = $evalData['evaluation'];
$pr      = $evalData['profile'] ?? [];
$overall = (float)($ev['overall'] ?? 0);

// ── Helpers ────────────────────────────────────────────────────────────────────
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
    $idx = abs(crc32($username)) % count($pool);
    return '/backgrounds/' . $pool[$idx];
}
function styleAccent(string $style): string {
    return match($style) {
        'cyber'      => '#22c55e',
        'neon'       => '#a78bfa',
        'iridescent' => '#818cf8',
        'glitch'     => '#f87171',
        'cosmic'     => '#38bdf8',
        'analog'     => '#fb923c',
        'minimal'    => '#94a3b8',
        'liquid'     => '#34d399',
        'fire'       => '#f97316',
        'nature'     => '#4ade80',
        'gold'       => '#fbbf24',
        'manga'      => '#f472b6',
        default      => '#22c55e',
    };
}
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
function cardStyleProfile(string $style): array {
    $p = [
        'cyber'      => ['img_filter' => 'grayscale(0.45) brightness(0.82) contrast(1.22) saturate(1.3)'],
        'neon'       => ['img_filter' => 'brightness(0.76) contrast(1.25) saturate(1.6) hue-rotate(8deg)'],
        'glitch'     => ['img_filter' => 'grayscale(0.25) brightness(0.78) contrast(1.35) saturate(1.5)'],
        'cosmic'     => ['img_filter' => 'brightness(0.78) contrast(1.22) saturate(1.4)'],
        'analog'     => ['img_filter' => 'sepia(0.45) brightness(0.84) contrast(1.12) saturate(1.25)'],
        'fire'       => ['img_filter' => 'brightness(0.80) contrast(1.25) saturate(1.5) hue-rotate(-8deg)'],
        'gold'       => ['img_filter' => 'sepia(0.35) brightness(0.82) contrast(1.18) saturate(1.4)'],
        'iridescent' => ['img_filter' => 'brightness(0.80) contrast(1.18) saturate(1.3)'],
        'liquid'     => ['img_filter' => 'brightness(0.80) contrast(1.20) saturate(1.35)'],
        'nature'     => ['img_filter' => 'brightness(0.82) contrast(1.15) saturate(1.4)'],
        'minimal'    => ['img_filter' => 'grayscale(0.7) brightness(0.85) contrast(1.22)'],
        'manga'      => ['img_filter' => 'brightness(0.76) contrast(1.28) saturate(1.5)'],
    ];
    return $p[$style] ?? $p['cyber'];
}
function barPct(float $s): int { return (int)(($s / 10) * 100); }

// ── Card variables ─────────────────────────────────────────────────────────────
$cardUsername  = $evalData['username'] ?? '';
$cardDisplay   = $pr['displayName'] ?? '';
$cardFollowers = $pr['followers'] ?? '—';
$cardPosts     = $pr['tweetCount'] ?? '—';
$cardScore     = number_format($overall, 1);
$cardGrade     = $ev['grade'] ?? '';
$cardNiche     = $ev['niche'] ?? '';
$rawPfp        = $pr['pfpUrl'] ?? ('https://unavatar.io/x/' . urlencode($cardUsername));
$pfpProxy      = '/evaluate?proxy=1&imgurl=' . urlencode($rawPfp);

$aiCard       = $ev['card'] ?? [];
$bgStyle      = preg_match('/^(cyber|neon|iridescent|glitch|cosmic|analog|minimal|liquid|fire|nature|gold|manga)$/', $aiCard['style'] ?? '')
                ? $aiCard['style'] : nicheToBgStyle($ev['niche'] ?? '', $overall);
$rarity       = preg_match('/^(common|uncommon|rare|epic|legendary)$/', $aiCard['rarity'] ?? '')
                ? $aiCard['rarity'] : cardRarity($cardFollowers, $overall);
$cardTitle    = trim($aiCard['title'] ?? '');
$cardSubtitle = trim($aiCard['subtitle'] ?? '');
$bgFile       = pickBg($bgStyle, $cardUsername);
$accent       = styleAccent($bgStyle);
$rarityCol    = rarityColor($rarity);
$edition      = (abs(crc32($cardUsername)) % 1000) + 1;
$fx           = cardStyleProfile($bgStyle);

$hex = ltrim($accent, '#');
$aR  = (int)hexdec(substr($hex, 0, 2));
$aG  = (int)hexdec(substr($hex, 2, 2));
$aB  = (int)hexdec(substr($hex, 4, 2));

// rarity label font size: shrink for longer words so it fits in 70px column
$rarityFontPx = strlen($rarity) >= 9 ? 9 : (strlen($rarity) >= 7 ? 11 : 14);

$initials = strtoupper(substr($cardDisplay ?: $cardUsername, 0, 1) . (strlen($cardDisplay ?: $cardUsername) > 1 ? substr(str_replace(' ','', $cardDisplay ?: $cardUsername), 1, 1) : ''));
$dims5    = array_slice(array_values($ev['dimensions'] ?? []), 0, 5);
$mini3    = array_slice($dims5, 0, 3);

$cardShadow = match($rarity) {
    'legendary' => '0 0 0 1px rgba(255,215,0,.40),0 0 70px rgba(255,200,0,.14)',
    'epic'      => '0 0 0 1px rgba(180,127,255,.34),0 0 55px rgba(180,127,255,.10)',
    'rare'      => '0 0 0 1px rgba(0,200,255,.32),0 0 45px rgba(0,200,255,.09)',
    'uncommon'  => '0 0 0 1px rgba(57,211,83,.24)',
    default     => '0 0 0 1px rgba(255,255,255,.08)',
};
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@300;400;500&family=Syne:wght@800&family=Barlow+Condensed:ital,wght@1,900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --card-w:400px;--card-h:500px;--pad:18px;
  --surface:#080A0F;--surface2:#0c0e14;
  --border:rgba(255,255,255,0.11);--border-dim:rgba(255,255,255,0.07);
  --t1:rgba(255,255,255,0.92);--t2:rgba(255,255,255,0.55);
  --t3:rgba(255,255,255,0.28);--t4:rgba(255,255,255,0.14);
  --mono:'IBM Plex Mono',monospace;--ui:'Syne',sans-serif;--score-f:'Barlow Condensed',sans-serif;
}
body{background:#080A0F;margin:0;padding:0;width:400px;height:500px;overflow:hidden;font-family:var(--mono);}
.card{width:var(--card-w);height:var(--card-h);position:relative;border-radius:2px;overflow:hidden;}
/* BG */
.bg{position:absolute;inset:0;z-index:0;overflow:hidden;background:#080A0F;}
.bg img{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;}
/* FROST — strong: image becomes a dark texture */
.frost{position:absolute;inset:0;z-index:1;backdrop-filter:blur(22px) brightness(0.22) saturate(0.15);-webkit-backdrop-filter:blur(22px) brightness(0.22) saturate(0.15);background:rgba(8,10,15,0.72);}
/* SUBTLE RADIAL — very low accent tint */
.bg-radials{position:absolute;inset:0;z-index:2;background:radial-gradient(ellipse at 75% 25%,rgba(var(--aR),var(--aG),var(--aB),0.05) 0%,transparent 55%);}
/* TOP LINE — 1px white hairline */
.line-top{position:absolute;top:0;left:0;right:0;height:1px;z-index:20;background:rgba(255,255,255,0.18);}
/* LEFT BAR — subtle white */
.line-left{position:absolute;top:0;left:0;width:1px;height:100%;z-index:20;background:linear-gradient(to bottom,rgba(255,255,255,0.22),rgba(255,255,255,0.04) 55%,transparent);}
/* RING */
.ring{position:absolute;inset:0;border-radius:2px;z-index:25;border:1px solid rgba(255,255,255,0.09);pointer-events:none;}
/* LAYOUT */
.layout{position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;}
/* S1: HEADER 62px */
.header{height:62px;flex-shrink:0;display:grid;grid-template-columns:58px 1fr 70px;border-bottom:1px solid var(--border);}
.h-avatar{background:var(--surface2);border-right:1px solid var(--border-dim);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;}
.h-avatar img{width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.15);}
.h-avatar-text{font-family:var(--ui);font-size:15px;font-weight:800;color:rgba(255,255,255,0.30);}
.h-handle{border-right:1px solid var(--border-dim);display:flex;flex-direction:column;justify-content:center;padding:0 12px;gap:2px;overflow:hidden;min-width:0;background:rgba(8,10,15,0.30);}
.h-handle-name{font-family:var(--ui);font-size:17px;font-weight:800;line-height:1;letter-spacing:-0.01em;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.h-handle-sub{font-family:var(--mono);font-size:6.5px;letter-spacing:0.16em;text-transform:uppercase;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.h-meta{display:flex;flex-direction:column;background:var(--surface2);}
.h-meta-edition{flex:1;border-bottom:1px solid var(--border-dim);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
.h-meta-ed-num{font-family:var(--mono);font-size:10px;font-weight:500;color:rgba(255,255,255,0.45);letter-spacing:0.03em;}
.h-meta-ed-of{font-family:var(--mono);font-size:5.5px;color:var(--t4);letter-spacing:0.08em;}
.h-meta-rarity{flex:1;display:flex;align-items:center;justify-content:center;gap:4px;background:rgba(255,255,255,0.02);}
.r-pip{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.r-word{font-family:var(--mono);font-size:6.5px;font-weight:500;letter-spacing:0.20em;color:var(--t3);}
/* S2: TAGS 48px */
.tags{height:48px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 var(--pad);border-bottom:1px solid var(--border);}
.tag{display:inline-flex;align-items:stretch;width:fit-content;border-radius:1px;overflow:hidden;}
.tag.primary{border:1px solid var(--border);}
.tag.secondary{border:1px solid var(--border-dim);margin-left:10px;}
.tag-num{width:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:6.5px;font-weight:500;}
.tag.primary .tag-num{background:rgba(255,255,255,0.08);color:var(--t2);}
.tag.secondary .tag-num{background:rgba(255,255,255,0.04);color:var(--t4);}
.tag-body{display:flex;align-items:center;gap:7px;padding:3px 9px;}
.tag.primary .tag-body{background:rgba(255,255,255,0.03);}
.tag.secondary .tag-body{background:rgba(255,255,255,0.01);}
.tag-dot{width:4px;height:4px;border-radius:50%;flex-shrink:0;}
.tag.primary .tag-dot{background:rgba(var(--aR),var(--aG),var(--aB),0.80);}
.tag.secondary .tag-dot{background:rgba(255,255,255,0.15);}
.tag-lbl{font-family:var(--mono);font-size:7px;letter-spacing:0.16em;text-transform:uppercase;white-space:nowrap;}
.tag.primary .tag-lbl{color:var(--t2);}
.tag.secondary .tag-lbl{color:var(--t3);}
/* S3: DIVIDER 10px */
.hazard{height:10px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:0 var(--pad);border-bottom:1px solid var(--border);overflow:hidden;}
.hz-stripe{flex:1;height:1px;background:rgba(255,255,255,0.05);}
.hz-lbl{font-family:var(--mono);font-size:5.5px;letter-spacing:0.26em;text-transform:uppercase;color:rgba(255,255,255,0.16);white-space:nowrap;flex-shrink:0;}
/* S4: DATA flex:1 */
.data-section{flex:1;min-height:0;display:grid;grid-template-columns:1fr 96px;padding:0 var(--pad);border-bottom:1px solid var(--border);gap:12px;}
.stats{display:flex;flex-direction:column;justify-content:center;padding:8px 0;}
.stat-row{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:8px;row-gap:3px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
.stat-row:last-child{border-bottom:none;}
.s-label{font-family:var(--mono);font-size:8px;letter-spacing:0.03em;color:var(--t2);align-self:center;}
.s-val{display:flex;align-items:stretch;border:1px solid var(--border-dim);border-radius:1px;overflow:hidden;flex-shrink:0;align-self:center;}
.s-val-n{padding:1px 5px;font-family:var(--mono);font-size:8.5px;font-weight:500;letter-spacing:0.02em;display:flex;align-items:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.65);}
.s-val-d{padding:1px 4px;font-family:var(--mono);font-size:5.5px;color:var(--t4);display:flex;align-items:center;background:transparent;border-left:1px solid rgba(255,255,255,0.05);}
.s-bar-wrap{grid-column:1 / -1;}
.s-bar-track{width:100%;height:2px;background:rgba(255,255,255,0.06);border-radius:1px;position:relative;}
.s-bar-fill{height:100%;border-radius:1px;position:relative;background:linear-gradient(to right,rgba(var(--aR),var(--aG),var(--aB),0.50),rgba(var(--aR),var(--aG),var(--aB),0.95) 75%,rgba(255,255,255,0.80));}
.s-bar-fill::after{content:'';position:absolute;right:-2px;top:50%;transform:translateY(-50%);width:4px;height:4px;border-radius:50%;background:rgba(var(--aR),var(--aG),var(--aB),1.0);box-shadow:0 0 5px rgba(var(--aR),var(--aG),var(--aB),0.55);}
/* SCORE BLOCK */
.score-block{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 0 8px 10px;border-left:1px solid var(--border);}
.sc-label{display:flex;align-items:stretch;width:100%;border:1px solid var(--border-dim);border-radius:1px;overflow:hidden;margin-bottom:6px;}
.sc-label-tag{background:rgba(255,255,255,0.07);padding:2px 5px;font-family:var(--mono);font-size:5.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--t2);display:flex;align-items:center;}
.sc-label-name{flex:1;background:rgba(255,255,255,0.02);padding:2px 5px;font-family:var(--mono);font-size:5.5px;letter-spacing:0.18em;text-transform:uppercase;color:var(--t3);display:flex;align-items:center;border-left:1px solid rgba(255,255,255,0.05);}
.sc-num-wrap{position:relative;width:100%;padding:2px 0;}
.sc-echo{position:absolute;top:2px;left:50%;transform:translateX(-50%);font-family:var(--score-f);font-style:italic;font-weight:900;font-size:88px;line-height:1;letter-spacing:-0.04em;color:rgba(255,255,255,0.012);pointer-events:none;user-select:none;white-space:nowrap;}
.sc-num{font-family:var(--score-f);font-style:italic;font-weight:900;font-size:76px;line-height:1;letter-spacing:-0.04em;background:linear-gradient(150deg,#fff 0%,rgba(var(--aR),var(--aG),var(--aB),0.80) 65%,rgba(var(--aR),var(--aG),var(--aB),0.30) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;text-align:center;width:100%;display:block;position:relative;z-index:1;}
.sc-tier{display:flex;align-items:stretch;width:100%;border:1px solid var(--border-dim);border-radius:1px;overflow:hidden;margin-top:6px;}
.sc-tier-a{padding:2px 5px;font-family:var(--mono);font-size:6px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;background:rgba(255,255,255,0.05);color:var(--t2);display:flex;align-items:center;border-right:1px solid rgba(255,255,255,0.06);}
.sc-tier-b{flex:1;padding:2px 5px;font-family:var(--mono);font-size:6px;letter-spacing:0.15em;text-transform:uppercase;background:transparent;color:var(--t2);display:flex;align-items:center;}
/* S5: BOTTOM BAR 72px */
.bottom-bar{height:72px;flex-shrink:0;display:grid;grid-template-columns:1fr 78px 68px;background:var(--surface);position:relative;overflow:hidden;border-top:1px solid var(--border);}
.bb-left{display:flex;flex-direction:column;justify-content:center;padding:0 14px;gap:3px;border-right:1px solid var(--border);position:relative;z-index:1;overflow:hidden;min-width:0;}
.bb-brand{font-family:var(--mono);font-size:6px;letter-spacing:0.22em;text-transform:uppercase;color:var(--t3);}
.bb-title{font-family:var(--ui);font-size:12px;font-weight:800;color:var(--t1);letter-spacing:-0.01em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.bb-sub{font-family:var(--mono);font-size:6px;letter-spacing:0.08em;text-transform:uppercase;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.bb-mid{display:flex;flex-direction:column;justify-content:center;padding:0 10px;gap:5px;border-right:1px solid var(--border);position:relative;z-index:1;}
.mini-row{display:flex;align-items:center;gap:5px;}
.mini-lbl{font-family:var(--mono);font-size:5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--t4);flex-shrink:0;width:22px;}
.mini-track{flex:1;height:1.5px;background:rgba(255,255,255,0.07);border-radius:1px;}
.mini-fill{height:100%;border-radius:1px;background:rgba(var(--aR),var(--aG),var(--aB),0.65);}
.bb-right{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;background:rgba(255,255,255,0.02);position:relative;z-index:1;padding:0 6px;overflow:hidden;}
.bb-rarity{font-family:var(--ui);font-weight:800;letter-spacing:0.02em;line-height:1;text-align:center;white-space:nowrap;overflow:hidden;max-width:100%;color:var(--t1);}
.bb-tier{display:flex;align-items:stretch;border:1px solid var(--border-dim);border-radius:1px;overflow:hidden;width:100%;}
.bb-tier-bar{width:2px;flex-shrink:0;background:rgba(255,255,255,0.20);}
.bb-tier-txt{flex:1;padding:2px 4px;background:transparent;font-family:var(--mono);font-size:5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--t3);text-align:center;}
</style>
</head>
<body>
<div class="card" style="--a:<?= $accent ?>;--aR:<?= $aR ?>;--aG:<?= $aG ?>;--aB:<?= $aB ?>;--glow:rgba(<?= $aR ?>,<?= $aG ?>,<?= $aB ?>,.45);box-shadow:<?= $cardShadow ?>;">

  <div class="bg">
    <?php if ($bgFile): ?>
    <img src="<?= htmlspecialchars($bgFile) ?>" alt="" style="filter:<?= $fx['img_filter'] ?>;">
    <?php endif; ?>
    <div class="bg-radials"></div>
  </div>
  <div class="frost"></div>
  <div class="line-top"></div>
  <div class="line-left"></div>

  <div class="layout">

    <!-- S1: HEADER -->
    <div class="header">
      <div class="h-avatar">
        <img src="<?= htmlspecialchars($pfpProxy) ?>" alt="<?= htmlspecialchars($initials) ?>"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="h-avatar-text" style="display:none;"><?= htmlspecialchars($initials) ?></span>
      </div>
      <div class="h-handle">
        <span class="h-handle-name">@<?= htmlspecialchars($cardUsername) ?></span>
        <span class="h-handle-sub"><?= htmlspecialchars($cardDisplay ?: $cardNiche ?: 'Creator') ?></span>
      </div>
      <div class="h-meta">
        <div class="h-meta-edition">
          <span class="h-meta-ed-num">#<?= str_pad($edition, 4, '0', STR_PAD_LEFT) ?></span>
          <span class="h-meta-ed-of">/ 1000</span>
        </div>
        <div class="h-meta-rarity">
          <div class="r-pip" style="background:<?= $rarityCol ?>;box-shadow:0 0 5px <?= $rarityCol ?>99;"></div>
          <span class="r-word"><?= strtoupper($rarity) ?></span>
        </div>
      </div>
    </div>

    <!-- S2: TAGS -->
    <div class="tags">
      <div class="tag primary">
        <span class="tag-num">01</span>
        <div class="tag-body">
          <div class="tag-dot"></div>
          <span class="tag-lbl"><?= htmlspecialchars(strtoupper($cardNiche ?: 'UNCATEGORIZED')) ?></span>
        </div>
      </div>
      <div class="tag secondary">
        <span class="tag-num">02</span>
        <div class="tag-body">
          <div class="tag-dot"></div>
          <span class="tag-lbl"><?= htmlspecialchars(strtoupper($bgStyle)) ?> · <?= strtoupper(date('Y')) ?></span>
        </div>
      </div>
    </div>

    <!-- S3: HAZARD -->
    <div class="hazard">
      <div class="hz-stripe"></div>
      <span class="hz-lbl">▸ PERFORMANCE DATA</span>
      <div class="hz-stripe r"></div>
    </div>

    <!-- S4: DATA SECTION -->
    <div class="data-section">
      <div class="stats">
        <?php foreach ($dims5 as $dim):
          $ds  = (float)($dim['score'] ?? 0);
          $pct = barPct($ds);
          $ok  = $ds >= 9.0 ? ' ok' : '';
        ?>
        <div class="stat-row<?= $ok ?>">
          <span class="s-label"><?= htmlspecialchars($dim['label'] ?? '') ?></span>
          <div class="s-val">
            <span class="s-val-n"><?= number_format($ds, 1) ?></span>
            <span class="s-val-d">/10</span>
          </div>
          <div class="s-bar-wrap">
            <div class="s-bar-track">
              <div class="s-bar-fill" style="width:<?= $pct ?>%;"></div>
            </div>
          </div>
        </div>
        <?php endforeach; ?>
      </div>

      <div class="score-block">
        <div class="sc-label">
          <span class="sc-label-tag">▸</span>
          <span class="sc-label-name">EVAL SCORE</span>
        </div>
        <div class="sc-num-wrap">
          <div class="sc-echo"><?= $cardScore ?></div>
          <span class="sc-num"><?= $cardScore ?></span>
        </div>
        <div class="sc-tier">
          <span class="sc-tier-a">Tier</span>
          <span class="sc-tier-b"><?= htmlspecialchars($cardGrade) ?></span>
        </div>
      </div>
    </div>

    <!-- S5: BOTTOM BAR -->
    <div class="bottom-bar">
      <div class="bb-left">
        <div class="bb-brand">APTUM.FUN</div>
        <div class="bb-title"><?= htmlspecialchars($cardTitle ?: $cardDisplay ?: '@'.$cardUsername) ?></div>
        <div class="bb-sub"><?= htmlspecialchars($cardSubtitle ?: 'aptum.fun/evaluate') ?></div>
      </div>
      <div class="bb-mid">
        <?php foreach ($mini3 as $md):
          $ms = (float)($md['score'] ?? 0);
          $mp = barPct($ms);
          $ml = strtoupper(substr($md['label'] ?? '???', 0, 3));
        ?>
        <div class="mini-row">
          <span class="mini-lbl"><?= htmlspecialchars($ml) ?></span>
          <div class="mini-track"><div class="mini-fill" style="width:<?= $mp ?>%;"></div></div>
        </div>
        <?php endforeach; ?>
      </div>
      <div class="bb-right">
        <span class="bb-rarity" style="font-size:<?= $rarityFontPx ?>px;"><?= ucfirst($rarity) ?></span>
        <div class="bb-tier">
          <div class="bb-tier-bar"></div>
          <span class="bb-tier-txt">CARD TIER</span>
        </div>
      </div>
    </div>

  </div><!-- /layout -->
  <div class="ring"></div>
</div>
</body>
</html>
