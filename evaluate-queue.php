<?php
/**
 * evaluate-queue.php — Evaluation job queue
 * VPS polls this endpoint for pending jobs and submits results.
 *
 * GET  ?action=pending           → list pending jobs (for VPS poller)
 * POST action=claim&username=X   → mark job as claimed (by VPS)
 * POST action=queue&username=X   → add a new job (from evaluate.php)
 *
 * Auth: Bearer token = PUSH_SECRET
 */
define('PUSH_SECRET', getenv('FEED_PUSH_SECRET') ?: '68b68e6fc9c5bb4203c4352c491903836bb639690fb8df19');
define('QUEUE_FILE',  __DIR__ . '/evaluations/queue.json');
define('EVAL_DIR',    __DIR__ . '/evaluations/');

header('Content-Type: application/json');

// Auth — accept secret via Authorization header, query param, or body
$auth  = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$token = $auth ? str_replace('Bearer ', '', $auth) : ($_GET['s'] ?? $body['secret'] ?? '');
$bodyRaw = file_get_contents('php://input');
$body = json_decode($bodyRaw, true) ?: [];

function loadQueue(): array {
    if (!file_exists(QUEUE_FILE)) return [];
    return json_decode(file_get_contents(QUEUE_FILE), true) ?: [];
}
function saveQueue(array $q): void {
    file_put_contents(QUEUE_FILE, json_encode($q, JSON_PRETTY_PRINT));
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $body['action'] ?? '';

// GET /evaluate-queue.php?action=pending  (VPS polls this)
if ($method === 'GET' && $action === 'pending') {
    if ($token !== PUSH_SECRET) { http_response_code(403); echo json_encode(['error'=>'Forbidden']); exit; }
    $queue = loadQueue();
    // Reset stale claimed jobs (>5 min) back to pending
    $now = time();
    $changed = false;
    foreach ($queue as &$j) {
        if ($j['status'] === 'claimed') {
            $claimedAt = strtotime($j['claimedAt'] ?? '1970-01-01');
            if (($now - $claimedAt) > 300) { $j['status'] = 'pending'; $changed = true; }
        }
        // Also remove jobs where result already exists
        if (file_exists(EVAL_DIR . strtolower($j['username']) . '.json')) {
            $j['status'] = 'done'; $changed = true;
        }
    }
    if ($changed) saveQueue($queue);
    $pending = array_values(array_filter($queue, fn($j) => $j['status'] === 'pending'));
    echo json_encode(['jobs' => $pending]); exit;
}

// POST action=queue  (evaluate.php adds a job)
if ($method === 'POST' && $action === 'queue') {
    if ($token !== PUSH_SECRET && ($body['secret'] ?? '') !== PUSH_SECRET) {
        http_response_code(403); echo json_encode(['error'=>'Forbidden']); exit;
    }
    $username = preg_replace('/[^a-zA-Z0-9_]/', '', $body['username'] ?? '');
    if (!$username) { http_response_code(400); echo json_encode(['error'=>'No username']); exit; }

    // Don't queue if result already exists
    if (file_exists(EVAL_DIR . strtolower($username) . '.json')) {
        echo json_encode(['ok'=>true, 'status'=>'already_done']); exit;
    }

    $queue = loadQueue();
    // Don't duplicate
    foreach ($queue as $j) {
        if ($j['username'] === $username && in_array($j['status'], ['pending','claimed'])) {
            echo json_encode(['ok'=>true, 'status'=>'already_queued', 'job_id'=>$j['id']]); exit;
        }
    }

    $job = ['id' => bin2hex(random_bytes(5)), 'username' => $username,
            'status' => 'pending', 'createdAt' => date('c')];
    $queue[] = $job;
    // Keep last 50
    $queue = array_slice($queue, -50);
    saveQueue($queue);
    echo json_encode(['ok'=>true, 'job_id'=>$job['id'], 'username'=>$username]); exit;
}

// POST action=claim  (VPS claims a job before processing)
if ($method === 'POST' && $action === 'claim') {
    if ($token !== PUSH_SECRET) { http_response_code(403); echo json_encode(['error'=>'Forbidden']); exit; }
    $job_id = $body['job_id'] ?? '';
    $queue = loadQueue();
    $found = false;
    foreach ($queue as &$j) {
        if ($j['id'] === $job_id && $j['status'] === 'pending') {
            $j['status'] = 'claimed';
            $j['claimedAt'] = date('c');
            $found = true; break;
        }
    }
    saveQueue($queue);
    echo json_encode(['ok' => $found]); exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown action']);
