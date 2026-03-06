import { useState, useEffect, useCallback } from "react";

const BG0 = "#ECEEF2", BG1 = "#E4E7EC", BG2 = "#FFFFFF", BG3 = "#F5F6F9";
const BORDER = "rgba(10,12,16,0.14)", BORDER2 = "rgba(10,12,16,0.22)", BORDER3 = "rgba(10,12,16,0.36)";
const INK = "#090B0F", INK2 = "rgba(9,11,15,0.88)", INK3 = "rgba(9,11,15,0.65)", INK4 = "rgba(9,11,15,0.42)", INK5 = "rgba(9,11,15,0.18)";
const GREEN = "#0A7A3E", GREENBG = "rgba(10,122,62,0.08)", GREENHL = "#0DB85A", AMBER = "#92400E";
const MONO = "'IBM Plex Mono',monospace", SANS = "'IBM Plex Sans',sans-serif", DISPLAY = "'Syne',sans-serif";

const PATHS = { extract: "M12 3c4.97 0 9 4.03 9 9s-4.03 9-9 9-9-4.03-9-9 4.03-9 9-9zm0 4v5l3 3", classify: "M3 6h18M3 12h18M3 18h18", enrich: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", generate: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", proofread: "M9 11l3 3L22 4", clean: "M20 6L9 17l-5-5", post: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z", shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", dollar: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", check: "M20 6L9 17l-5-5", xmark: "M18 6L6 18M6 6l12 12", chart: "M18 20V10M12 20V4M6 20v-6M2 20h20", trending: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6", zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", cpu: "M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 1v3M12 20v3", globe: "M12 2a10 10 0 100 20A10 10 0 0012 2zm0 0c-2.76 3.56-4 7-4 10s1.24 6.44 4 10m0-20c2.76 3.56 4 7 4 10s-1.24 6.44-4 10M2 12h20", tag: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01", server: "M22 9H2M22 15H2M2 5h20v14H2z", users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", arrow: "M5 12h14M12 5l7 7-7 7" };

function Ico({ n, s = 16, c = INK, o = 1 }) { return (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: o, flexShrink: 0 }}><path d={PATHS[n] || ""} /></svg>); }

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes timerW{from{width:0%}to{width:100%}}@keyframes pulseDot{0%,100%{opacity:1}50%{opacity:.3}}@keyframes tapescroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}*{box-sizing:border-box;margin:0;padding:0}::selection{background:#090B0F;color:#fff}::-webkit-scrollbar{display:none}`;

const Tag = ({ children, live = false }) => (<div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", padding: "4px 12px", border: `1px solid ${live ? GREEN : BORDER2}`, color: live ? GREEN : INK3, background: live ? GREENBG : "transparent", fontWeight: live ? 700 : 500 }}>{live && <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, animation: "pulseDot 2s infinite", display: "inline-block" }} />}{children}</div>);

const SHd = ({ num, title, sub, status }) => (<div style={{ padding: "11px 26px", borderBottom: `2px solid ${BORDER3}`, display: "flex", alignItems: "center", gap: 12, background: BG1 }}><span style={{ fontFamily: MONO, fontSize: 10, color: INK4, letterSpacing: "0.1em", fontWeight: 700, border: `1px solid ${BORDER2}`, padding: "2px 8px", background: BG3 }}>{num}</span><span style={{ color: INK5, fontSize: 14 }}>|</span><span style={{ fontFamily: MONO, fontSize: 11, color: INK, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>{title}</span>{sub && <span style={{ fontFamily: SANS, fontSize: 11, color: INK3, flex: 1, fontWeight: 500 }}>{sub}</span>}{status && <span style={{ fontFamily: MONO, fontSize: 9.5, color: GREEN, marginLeft: "auto", letterSpacing: "0.08em", fontWeight: 700 }}>● {status}</span>}</div>);

const TAPE = [{ s: "X-CONNECT", v: "AI ENGAGEMENT ENGINE" }, { s: "PIPELINE", v: "7 STAGES · ZERO DETECTION" }, { s: "COST", v: "$199 ONE-TIME — NO SUBSCRIPTION" }, { s: "DETECTION", v: "0 ACCOUNTS FLAGGED TO DATE" }, { s: "HOSTED", v: "SELF-HOSTED · YOUR VPS · FULL CONTROL" }, { s: "AI", v: "FRONTIER LLM · NO TEMPLATES EVER" }, { s: "SAVINGS", v: "$1,200–$2,800 / YEAR VS COMPETITORS" }];

function Tape() { const items = [...TAPE, ...TAPE]; return (<div style={{ height: 30, background: BG1, borderBottom: `1px solid ${BORDER2}`, overflow: "hidden", display: "flex", alignItems: "center", position: "relative" }}><div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 60, background: `linear-gradient(to right,${BG1},transparent)`, zIndex: 2, pointerEvents: "none" }} /><div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 60, background: `linear-gradient(to left,${BG1},transparent)`, zIndex: 2, pointerEvents: "none" }} /><div style={{ display: "flex", animation: "tapescroll 28s linear infinite", whiteSpace: "nowrap" }}>{items.map((it, i) => (<div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 22px", borderRight: `1px solid ${BORDER2}`, height: 30, fontFamily: MONO, fontSize: 10.5 }}><span style={{ color: INK, fontWeight: 700, letterSpacing: "0.1em" }}>{it.s}</span><span style={{ color: INK3 }}>{it.v}</span></div>))}</div></div>); }

function Counter({ to, active, dur = 1100 }) { const [v, setV] = useState(0); useEffect(() => { if (!active || to === 0) { setV(0); return; } let s = null; const step = ts => { if (!s) s = ts; const p = Math.min((ts - s) / dur, 1); setV(Math.round((1 - Math.pow(1 - p, 3)) * to)); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, [active, to]); return <>{v}</>; }

// ── SCENE 1 HERO ──────────────────────────────────────────────────────────
function S1() {
    return (<div style={{ width: "100%", maxWidth: 1060, padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 0, border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)", marginBottom: 1 }}>
            <div style={{ padding: "36px 40px", borderRight: `2px solid ${BORDER3}`, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", right: -10, top: -20, fontFamily: DISPLAY, fontWeight: 800, fontSize: 200, lineHeight: 1, color: "rgba(10,12,16,0.04)", pointerEvents: "none", userSelect: "none", letterSpacing: "-0.04em" }}>X</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 22, animation: "fadeUp 0.6s 0.1s both" }}><Tag live>AGENT ACTIVE</Tag><Tag>SELF-HOSTED</Tag><Tag>$199 OTP</Tag></div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(50px,5.5vw,82px)", lineHeight: 0.88, letterSpacing: "-0.03em", color: INK, marginBottom: 10, animation: "fadeUp 0.6s 0.25s both" }}>X-Connect</div>
                <div style={{ fontFamily: SANS, fontSize: 14, color: INK3, marginBottom: 26, letterSpacing: "0.02em", animation: "fadeUp 0.6s 0.35s both", fontWeight: 400 }}>The AI engine that never sleeps — grow any X account on autopilot with human-quality replies.</div>
                <div style={{ display: "flex", gap: 0, marginBottom: 26, animation: "fadeUp 0.6s 0.45s both" }}>
                    {[{ val: "$199", lbl: "One-Time" }, { val: "7", lbl: "AI Stages" }, { val: "0", lbl: "Detections" }, { val: "24/7", lbl: "Always On" }].map((m, i) => (<div key={i} style={{ padding: "12px 20px", border: `1px solid ${BORDER2}`, borderRight: "none", background: i % 2 === 0 ? BG3 : BG2, display: "flex", flexDirection: "column", gap: 3, ...(i === 0 ? { borderLeft: `1px solid ${BORDER2}` } : {}), ...(i === 3 ? { borderRight: `1px solid ${BORDER2}` } : {}) }}><div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: INK, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{m.val}</div><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: INK4, fontWeight: 600 }}>{m.lbl}</div></div>))}
                </div>
                <div style={{ display: "flex", gap: 8, animation: "fadeUp 0.6s 0.55s both" }}>
                    <button style={{ padding: "13px 28px", background: INK, color: BG2, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>GET STARTED — $199 <Ico n="arrow" s={12} c={BG2} /></button>
                    <button style={{ padding: "13px 18px", background: "transparent", color: INK3, fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid ${BORDER2}`, cursor: "pointer" }}>See How It Works</button>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", background: BG1 }}>
                <div style={{ padding: "11px 18px", borderBottom: `1px solid ${BORDER2}`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.18em", textTransform: "uppercase", color: INK3, background: BG3, fontWeight: 700 }}>CAPABILITY MATRIX</div>
                {[{ ico: "shield", k: "Detection rate", v: "0 — undetectable", c: GREEN }, { ico: "cpu", k: "AI pipeline", v: "7-stage frontier LLM", c: INK }, { ico: "tag", k: "License cost", v: "$199 one-time", c: GREEN }, { ico: "server", k: "Infrastructure", v: "Self-hosted VPS", c: INK3 }, { ico: "users", k: "Accounts", v: "Unlimited isolation", c: INK3 }, { ico: "globe", k: "X API usage", v: "$0 — browser mode", c: GREEN }, { ico: "zap", k: "Templates used", v: "Zero — generated fresh", c: INK }].map((r, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? BG2 : BG3 }}><Ico n={r.ico} s={12} c={INK4} /><span style={{ fontFamily: SANS, fontSize: 11.5, color: INK3, flex: 1, fontWeight: 500 }}>{r.k}</span><span style={{ fontFamily: MONO, fontSize: 10.5, color: r.c, fontWeight: 600 }}>{r.v}</span></div>))}
                <div style={{ padding: "14px 16px", marginTop: "auto" }}>
                    <button style={{ width: "100%", padding: "13px 16px", background: INK, color: BG2, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>BUY NOW — $199 <Ico n="arrow" s={12} c={BG2} /></button>
                </div>
            </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 1, background: BORDER2 }}>
            {[{ ico: "shield", l: "Zero Detection", a: true }, { ico: "cpu", l: "7-Stage AI", a: true }, { ico: "tag", l: "$199 OTP", a: true }, { ico: "server", l: "Self-Hosted", a: false }, { ico: "users", l: "Multi-Account", a: false }, { ico: "globe", l: "Browser Mode", a: false }].map((c, i) => (<div key={i} style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: c.a ? INK : BG2, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: c.a ? BG2 : INK3, fontWeight: c.a ? 600 : 500 }}><Ico n={c.ico} s={10} c={c.a ? BG2 : INK4} />{c.l}</div>))}
        </div>
    </div>);
}

// ── SCENE 2 PIPELINE ─────────────────────────────────────────────────────
const PIPE = [{ ico: "extract", num: "01", name: "Extract", phase: "DATA", desc: "Full tweet context — text, images, author metadata, engagement signals scraped cleanly." }, { ico: "classify", num: "02", name: "Classify", phase: "FILTER", desc: "AI decides: bait, genuine, or shill — zero wasted replies on low-signal posts." }, { ico: "enrich", num: "03", name: "Enrich", phase: "AUGMENT", desc: "Live news + on-chain data + AI vision on images woven in before writing." }, { ico: "generate", num: "04", name: "Generate", phase: "WRITE", desc: "Frontier LLM crafts a unique contextual reply from scratch. No templates ever." }, { ico: "proofread", num: "05", name: "Proofread", phase: "VERIFY", desc: "Second AI pass: grammar, tone, and factual accuracy verified against live data." }, { ico: "clean", num: "06", name: "Clean", phase: "FORMAT", desc: "Strips tickers, fixes formatting, enforces brand-safety — polished output." }, { ico: "post", num: "07", name: "Post", phase: "DEPLOY", desc: "Keyboard simulation with randomized 25–720s delays — completely undetectable." }];

function S2({ active }) {
    const [lit, setLit] = useState(-1);
    useEffect(() => { if (!active) { setLit(-1); return; } const ts = PIPE.map((_, i) => setTimeout(() => setLit(i), 400 + i * 600)); const tAll = setTimeout(() => setLit(99), 400 + PIPE.length * 600 + 400); return () => { ts.forEach(clearTimeout); clearTimeout(tAll); }; }, [active]);
    const on = i => lit === 99 || lit >= i;
    return (<div style={{ width: "100%", maxWidth: 1060, padding: "0 28px" }}>
        <div style={{ border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)" }}>
            <SHd num="02" title="7-STAGE AI PIPELINE" sub="From raw tweet to posted reply — fully automated" status="RUNNING NOW" />
            <div style={{ padding: "24px 24px 18px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, background: BORDER2, marginBottom: 14 }}>
                    {PIPE.map((s, i) => (<div key={i} style={{ background: on(i) ? BG2 : BG3, padding: "18px 14px", position: "relative", transition: "background 0.4s", borderTop: `2px solid ${on(i) ? (i >= 5 ? GREEN : INK) : BORDER}` }}>
                        <div style={{ position: "absolute", top: -5, left: 14, width: 8, height: 8, borderRadius: "50%", background: on(i) ? (i >= 5 ? GREEN : INK) : BG3, border: `1px solid ${on(i) ? (i >= 5 ? GREEN : INK) : BORDER2}`, transition: "all 0.4s" }} />
                        <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.18em", color: on(i) ? (i >= 5 ? GREEN : INK3) : INK5, marginBottom: 8, transition: "color 0.3s", textTransform: "uppercase" }}>{s.num}·{s.phase}</div>
                        <div style={{ marginBottom: 8, opacity: on(i) ? 1 : 0.2, transition: "opacity 0.3s" }}><Ico n={s.ico} s={16} c={on(i) ? (i >= 5 ? GREEN : INK) : INK4} /></div>
                        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, color: on(i) ? INK : INK4, marginBottom: 5, transition: "color 0.3s" }}>{s.name}</div>
                        <div style={{ fontFamily: SANS, fontSize: 10, color: on(i) ? INK3 : INK5, lineHeight: 1.6, transition: "color 0.3s", fontWeight: 500 }}>{s.desc}</div>
                    </div>))}
                </div>
                <div style={{ height: 3, background: BG0, overflow: "hidden", marginBottom: 14 }}>
                    <div style={{ height: "100%", background: `linear-gradient(90deg,${INK},${GREEN})`, width: lit === 99 ? "100%" : lit < 0 ? "0%" : `${((lit + 1) / PIPE.length) * 100}%`, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
                </div>
                <div style={{ background: INK, padding: "12px 16px", fontFamily: MONO, fontSize: 10.5 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>{["#FF605C", "#FFBD44", "#00CA4E"].map((c, i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />)}<span style={{ marginLeft: 8, color: "rgba(255,255,255,0.3)", fontSize: 10, letterSpacing: "0.1em" }}>session.log</span></div>
                    <div style={{ maxHeight: 88, overflow: "hidden" }}>
                        {PIPE.slice(0, Math.max(0, lit + 1)).map((s, i) => (<div key={i} style={{ display: "flex", gap: 10, lineHeight: 1.9, opacity: 0, animation: "fadeUp 0.25s forwards" }}><span style={{ color: "rgba(255,255,255,0.28)", minWidth: 20 }}>{s.num}</span><span style={{ color: i >= 5 ? GREENHL : "rgba(255,255,255,0.5)", minWidth: 58, textTransform: "uppercase", letterSpacing: "0.08em" }}>[{s.phase}]</span><span style={{ color: "rgba(255,255,255,0.55)" }}>{s.name} — {s.desc.slice(0, 55)}…</span></div>))}
                        {lit < 0 && <span style={{ color: "rgba(255,255,255,0.2)" }}>Awaiting session…<span style={{ animation: "blink 1s infinite" }}>▌</span></span>}
                    </div>
                </div>
            </div>
        </div>
    </div>);
}

// ── SCENE 3 STEALTH + COST ────────────────────────────────────────────────
function S3({ active }) {
    const [n, setN] = useState(0);
    useEffect(() => { if (!active) { setN(0); return; } const ts = Array.from({ length: 12 }, (_, i) => setTimeout(() => setN(i + 1), 250 + i * 100)); return () => ts.forEach(clearTimeout); }, [active]);
    const L = [{ ico: "globe", k: "Browser fingerprint", v: "Real Chrome profile", c: GREEN }, { ico: "cpu", k: "Typing pattern", v: "Keyboard simulation", c: GREEN }, { ico: "zap", k: "Reply quality", v: "Unique every time", c: INK }, { ico: "shield", k: "Action pacing", v: "Randomized 25–720s", c: INK }, { ico: "check", k: "webdriver flag", v: "Spoofed & clean", c: GREEN }];
    const R = [{ ico: "tag", k: "Software license", v: "$199 one-time", c: GREEN }, { ico: "globe", k: "X API credits", v: "$0 — browser mode", c: GREEN }, { ico: "cpu", k: "AI model calls", v: "~$0.50–2 / day", c: INK }, { ico: "server", k: "Hosting (VPS)", v: "$5–20 / month", c: INK }, { ico: "xmark", k: "Competitors avg", v: "$99–$299 / mo", c: "rgba(185,28,28,0.7)", st: true }];
    const Panel = ({ side, rows, off }) => (<div style={{ background: BG2, border: `1px solid ${BORDER2}`, boxShadow: "0 2px 12px rgba(10,12,16,0.06)" }}>
        <div style={{ padding: "11px 20px", borderBottom: `2px solid ${BORDER3}`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: INK3, background: BG1, fontWeight: 700, borderTop: `2px solid ${side === "l" ? INK : GREEN}` }}>{side === "l" ? "UNDETECTABLE BY DESIGN" : "REAL COST BREAKDOWN"}</div>
        <div style={{ padding: "22px 22px 0" }}>
            {side === "l" ? (<><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(52px,5.5vw,78px)", color: INK, lineHeight: 1, marginBottom: 6 }}>0</div><p style={{ fontFamily: SANS, fontSize: 12.5, color: INK3, lineHeight: 1.75, marginBottom: 20, fontWeight: 500 }}>Accounts flagged or banned to date.<br />Real browser. Human pacing. Every reply unique.</p></>) : (<><div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 6 }}><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(44px,5vw,68px)", color: GREEN, lineHeight: 1 }}>$199</span><div style={{ paddingBottom: 10 }}><div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: GREEN, textTransform: "uppercase", fontWeight: 700 }}>one-time</div><div style={{ fontFamily: MONO, fontSize: 9, color: INK4, letterSpacing: "0.1em", textDecoration: "line-through" }}>was $299/mo</div></div></div><p style={{ fontFamily: SANS, fontSize: 12.5, color: INK3, lineHeight: 1.75, marginBottom: 20, fontWeight: 500 }}>No subscription. Pay once, own it.<br />Optional $5/mo flex plan available.</p></>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "0 22px 16px" }}>
            {rows.map((r, i) => (<div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${BORDER}`, opacity: n > off + i ? 1 : 0, transform: n > off + i ? "translateY(0)" : "translateY(5px)", transition: `opacity 0.35s ${i * 0.05}s,transform 0.35s ${i * 0.05}s` }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Ico n={r.ico} s={11} c={INK4} /><span style={{ fontFamily: SANS, fontSize: 12, color: INK3, fontWeight: 500 }}>{r.k}</span></div><span style={{ fontFamily: MONO, fontSize: 11.5, color: r.c, fontWeight: 600, textDecoration: r.st ? "line-through" : "none" }}>{r.v}</span></div>))}
        </div>
    </div>);
    return (<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%", maxWidth: 1000, padding: "0 28px" }}><Panel side="l" rows={L} off={0} /><Panel side="r" rows={R} off={5} /></div>);
}

// ── SCENE 4 PERFORMANCE ───────────────────────────────────────────────────
const LOGS = [{ ts: "14:32:01", tag: "INFO", col: INK4, msg: "Session started — 100 tweets queued" }, { ts: "14:32:04", tag: "PASS", col: INK, msg: "Tweet #001 classified PASS (BTC macro take)" }, { ts: "14:32:07", tag: "DATA", col: AMBER, msg: "Enrichment — 3 headlines + Dune on-chain merged" }, { ts: "14:32:09", tag: "OK", col: GREEN, msg: "Reply generated (219 chars) — proofread ✓" }, { ts: "14:32:11", tag: "POST", col: GREEN, msg: "Posted via keyboard sim, 340ms avg delay" }, { ts: "14:32:41", tag: "SKIP", col: INK4, msg: "Tweet #002 — SKIP (bait score 0.12)" }, { ts: "14:33:18", tag: "SHILL", col: AMBER, msg: "Tweet #003 — SHILL opportunity queued (0.87)" }];

function S4({ active }) {
    const [logs, setLogs] = useState([]);
    useEffect(() => { if (!active) { setLogs([]); return; } const ts = LOGS.map((l, i) => setTimeout(() => setLogs(p => [...p, l]), 400 + i * 520)); return () => ts.forEach(clearTimeout); }, [active]);
    const stats = [{ to: 85, suf: "%", lbl: "Engagement rate", sub: "Skip filter removes bait & bots", ico: "chart" }, { to: 75, suf: "", lbl: "Unique replies/session", sub: "Generated fresh — zero templates", ico: "zap" }, { to: 0, suf: "", lbl: "Templates used", sub: "AI writes from scratch every time", ico: "check" }, { to: 0, suf: "", lbl: "Accounts flagged", sub: "Undetected across all clients", ico: "shield" }];
    return (<div style={{ width: "100%", maxWidth: 960, padding: "0 28px" }}>
        <div style={{ border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)" }}>
            <SHd num="04" title="PERFORMANCE METRICS" sub="Across real client deployments" status="DATA VERIFIED" />
            <div style={{ padding: "24px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: BORDER2, marginBottom: 14 }}>
                    {stats.map((s, i) => (<div key={i} style={{ background: BG2, padding: "20px 18px" }}><div style={{ marginBottom: 10 }}><Ico n={s.ico} s={15} c={INK4} /></div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(34px,3.5vw,50px)", lineHeight: 1, color: active ? (i < 2 ? INK : INK3) : INK5, marginBottom: 5, transition: "color 0.5s", fontVariantNumeric: "tabular-nums" }}><Counter to={s.to} active={active} dur={1200} />{s.suf}</div><div style={{ fontFamily: SANS, fontSize: 12, color: INK, fontWeight: 700, marginBottom: 3 }}>{s.lbl}</div><div style={{ fontFamily: SANS, fontSize: 11, color: INK3, lineHeight: 1.55, fontWeight: 500 }}>{s.sub}</div></div>))}
                </div>
                <div style={{ background: INK, padding: "11px 14px", fontFamily: MONO, fontSize: 10.5 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>{["#FF605C", "#FFBD44", "#00CA4E"].map((c, i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />)}<span style={{ marginLeft: 8, color: "rgba(255,255,255,0.3)", fontSize: 10, letterSpacing: "0.1em" }}>session.log</span><span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.2)", fontSize: 9 }}>{logs.length}/{LOGS.length} events</span></div>
                    <div style={{ maxHeight: 96, overflow: "hidden" }}>
                        {logs.map((l, i) => (<div key={i} style={{ display: "flex", gap: 10, lineHeight: 1.9, opacity: 0, animation: "fadeUp 0.25s forwards" }}><span style={{ color: "rgba(255,255,255,0.25)", minWidth: 52, flexShrink: 0 }}>{l.ts}</span><span style={{ color: l.col, flexShrink: 0, minWidth: 50, textTransform: "uppercase", letterSpacing: "0.08em" }}>[{l.tag}]</span><span style={{ color: "rgba(255,255,255,0.55)" }}>{l.msg}</span></div>))}
                        {logs.length === 0 && <span style={{ color: "rgba(255,255,255,0.2)" }}>Awaiting session…<span style={{ animation: "blink 1s infinite" }}>▌</span></span>}
                    </div>
                </div>
            </div>
        </div>
    </div>);
}

// ── SCENE 5 COMPETITORS ───────────────────────────────────────────────────
function S5({ active }) {
    const [n, setN] = useState(0);
    useEffect(() => { if (!active) { setN(0); return; } const ts = Array.from({ length: 10 }, (_, i) => setTimeout(() => setN(i + 1), 80 + i * 80)); return () => ts.forEach(clearTimeout); }, [active]);
    const C = [{ nm: "Buffer", pr: "$6/mo", ai: false, au: false, st: false, ot: false }, { nm: "Hootsuite", pr: "$99/mo", ai: "Basic", au: false, st: false, ot: false }, { nm: "Hypefury", pr: "$49/mo", ai: "Templates", au: "Limited", st: false, ot: false }, { nm: "Tweet Hunter", pr: "$49/mo", ai: "Templates", au: "Limited", st: false, ot: false }, { nm: "Sprout Social", pr: "$249/mo", ai: "Partial", au: false, st: false, ot: false }, { nm: "SocialPilot", pr: "$30/mo", ai: "Basic", au: false, st: false, ot: false }, { nm: "Drip", pr: "$99/mo", ai: "Basic", au: "Limited", st: false, ot: false }, { nm: "Bika.ai", pr: "$30/mo", ai: "Basic", au: "Basic", st: false, ot: false }, { nm: "X-Connect", pr: "$199 OTP", ai: "Frontier LLM", au: "Full 7-Stage", st: true, ot: true, us: true }];
    const Tick = ({ v, us }) => { if (v === true) return <Ico n="check" s={13} c={us ? GREEN : GREEN} />; if (v === false) return <Ico n="xmark" s={13} c="rgba(185,28,28,0.5)" />; return <span style={{ fontFamily: MONO, fontSize: 9.5, color: us ? INK : AMBER, fontWeight: 600 }}>{v}</span>; };
    const cols = "1.8fr 1fr 1.2fr 1.2fr 0.8fr 0.8fr";
    return (<div style={{ width: "100%", maxWidth: 1060, padding: "0 28px" }}>
        <div style={{ border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)" }}>
            <SHd num="05" title="MARKET LANDSCAPE" sub="Nothing else does all four — verified March 2025" />
            <div style={{ padding: "24px" }}>
                <div style={{ border: `1px solid ${BORDER2}`, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: cols, background: BG1, borderBottom: `2px solid ${BORDER3}` }}>
                        {["Tool", "Price", "Frontier AI", "Auto-Engage", "Stealth", "One-Time"].map((h, i) => (<div key={i} style={{ padding: "10px 14px", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: INK3, textAlign: i > 0 ? "center" : "left", borderRight: `1px solid ${BORDER}`, fontWeight: 700 }}>{h}</div>))}
                    </div>
                    {C.map((c, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: cols, background: c.us ? "rgba(10,122,62,0.04)" : (i % 2 === 0 ? BG2 : BG3), borderBottom: `1px solid ${BORDER}`, opacity: n > i ? 1 : 0, transition: `opacity 0.3s ${i * 0.035}s`, borderLeft: c.us ? `3px solid ${GREEN}` : "3px solid transparent" }}>
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 7, borderRight: `1px solid ${BORDER}` }}>{c.us && <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, display: "inline-block", flexShrink: 0 }} />}<span style={{ fontFamily: SANS, fontSize: 12.5, color: c.us ? INK : INK2, fontWeight: c.us ? 700 : 500 }}>{c.nm}</span></div>
                        <div style={{ padding: "10px 14px", textAlign: "center", borderRight: `1px solid ${BORDER}` }}><span style={{ fontFamily: MONO, fontSize: 11, color: c.us ? GREEN : INK3, fontWeight: c.us ? 700 : 500 }}>{c.pr}</span></div>
                        {[c.ai, c.au, c.st, c.ot].map((val, vi) => (<div key={vi} style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", borderRight: vi < 3 ? `1px solid ${BORDER}` : "none" }}><Tick v={val} us={c.us} /></div>))}
                    </div>))}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: INK5, letterSpacing: "0.1em", marginBottom: 12 }}>Sources: socialchamp.com · sproutsocial.com · tweetpeek.ai · northpennnow.com · ifttt.com</div>
                <div style={{ padding: "13px 16px", background: BG1, border: `1px solid ${BORDER2}`, borderLeft: `3px solid ${GREEN}`, display: "flex", alignItems: "center", gap: 10 }}><Ico n="check" s={13} c={GREEN} /><p style={{ fontFamily: SANS, fontSize: 12, color: INK2, lineHeight: 1.65, fontWeight: 500 }}><strong style={{ color: INK, fontWeight: 700 }}>Conclusion:</strong> X-Connect is the only tool combining frontier LLM auto-engagement, stealth operation, and a one-time price. Competitors average $99–$299/mo with no stealth and template-only AI.</p></div>
            </div>
        </div>
    </div>);
}

// ── SCENE 6 PRICING ───────────────────────────────────────────────────────
function S6({ active }) {
    const [n, setN] = useState(0);
    useEffect(() => { if (!active) { setN(0); return; } const ts = Array.from({ length: 16 }, (_, i) => setTimeout(() => setN(i + 1), 120 + i * 85)); return () => ts.forEach(clearTimeout); }, [active]);
    const plans = [{ nm: "Lifetime", pr: "$199", sub: "one-time", acc: INK, note: "Best value", feats: ["All 3 pipeline modes", "Multi-account isolation", "Lifetime updates (opt-in)", "Community & docs"] }, { nm: "Flex", pr: "$5", sub: "per month", acc: AMBER, note: "Budget-friendly", feats: ["Full feature parity", "Cancel anytime", "~40mo to own", "No lock-in"] }, { nm: "Pro+", pr: "$199", sub: "+ $29/mo maintenance", acc: GREEN, note: "Best support", feats: ["Lifetime license", "Priority bug fixes", "Model upgrades", "Dedicated channel"] }];
    const biz = [{ ico: "chart", l: "Break-even (10 clients)", v: "$1,990" }, { ico: "trending", l: "Revenue at 100 clients", v: "$19,900" }, { ico: "dollar", l: "Flex MRR at 100 clients", v: "$500/mo" }, { ico: "server", l: "Cost to serve / client", v: "~$5/mo" }];
    const sav = [{ l: "vs Sprout Social (1yr)", v: "+$2,789" }, { l: "vs Hypefury (1yr)", v: "+$389" }, { l: "vs Tweet Hunter (1yr)", v: "+$389" }, { l: "vs avg competitor (1yr)", v: "+$1,200" }];
    return (<div style={{ width: "100%", maxWidth: 1040, padding: "0 28px" }}>
        <div style={{ border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)" }}>
            <SHd num="06" title="PRICING & VIABILITY" sub="Good economics — for both parties" />
            <div style={{ padding: "24px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.1fr", gap: 10, marginBottom: 14 }}>
                    {plans.map((p, i) => (<div key={i} style={{ background: BG3, border: `1px solid ${BORDER2}`, borderTop: `2px solid ${p.acc}`, padding: "20px 18px", display: "flex", flexDirection: "column", opacity: n > i ? 1 : 0, transform: n > i ? "translateY(0)" : "translateY(8px)", transition: `all 0.4s ${i * 0.1}s` }}><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.16em", color: p.acc, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>{p.note}</div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, color: INK, marginBottom: 7 }}>{p.nm}</div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(30px,3vw,44px)", color: p.acc, lineHeight: 1, marginBottom: 3 }}>{p.pr}</div><div style={{ fontFamily: MONO, fontSize: 9.5, color: INK4, letterSpacing: "0.1em", marginBottom: 16 }}>{p.sub}</div><div style={{ height: 1, background: BORDER2, marginBottom: 12 }} /><div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{p.feats.map((f, fi) => (<div key={fi} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}><Ico n="check" s={10} c={p.acc} /><span style={{ fontFamily: SANS, fontSize: 11, color: INK3, lineHeight: 1.5, fontWeight: 500 }}>{f}</span></div>))}</div></div>))}
                    <div style={{ background: BG3, border: `1px solid ${BORDER2}`, padding: "20px 18px", opacity: n > 3 ? 1 : 0, transition: "all 0.4s 0.35s" }}>
                        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.16em", color: GREEN, textTransform: "uppercase", marginBottom: 12, fontWeight: 700 }}>YOUR REVENUE</div>
                        {biz.map((m, i) => (<div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${BORDER}`, opacity: n > 4 + i ? 1 : 0, transition: `opacity 0.3s ${i * 0.08}s` }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Ico n={m.ico} s={10} c={INK4} /><span style={{ fontFamily: SANS, fontSize: 10.5, color: INK3, fontWeight: 500 }}>{m.l}</span></div><span style={{ fontFamily: MONO, fontSize: 11, color: GREEN, fontWeight: 700 }}>{m.v}</span></div>))}
                        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.16em", color: INK3, textTransform: "uppercase", margin: "12px 0 8px", fontWeight: 700 }}>CUSTOMER SAVINGS</div>
                        {sav.map((s, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", opacity: n > 8 + i ? 1 : 0, transition: `opacity 0.3s ${i * 0.06}s` }}><span style={{ fontFamily: SANS, fontSize: 10.5, color: INK3, fontWeight: 500 }}>{s.l}</span><span style={{ fontFamily: MONO, fontSize: 11, color: INK, fontWeight: 700 }}>{s.v}</span></div>))}
                    </div>
                </div>
                <div style={{ padding: "13px 16px", background: BG1, border: `1px solid ${BORDER2}`, borderLeft: `3px solid ${GREEN}`, display: "flex", alignItems: "center", gap: 10, opacity: n > 14 ? 1 : 0, transition: "opacity 0.5s" }}><Ico n="zap" s={13} c={GREEN} /><p style={{ fontFamily: SANS, fontSize: 12, color: INK2, lineHeight: 1.65, fontWeight: 500 }}><strong style={{ color: INK, fontWeight: 700 }}>Verdict:</strong> Customers save $400–$2,800/year vs subscription tools. At 50 clients you clear ~$10K upfront + ~$250/mo Flex MRR. High margin — only costs are LLM inference (~$1–2/client/day) and VPS (~$10/mo).</p></div>
            </div>
        </div>
    </div>);
}

// ── SCENE 7 CTA ───────────────────────────────────────────────────────────
function S7({ onReplay }) {
    const M = [{ n: "$199", l: "One-Time" }, { n: "7", l: "AI Stages" }, { n: "0", l: "Detections" }, { n: "24/7", l: "Always On" }, { n: "∞", l: "Accounts" }];
    return (<div style={{ width: "100%", maxWidth: 820, padding: "0 28px" }}>
        <div style={{ border: `1px solid ${BORDER2}`, background: BG2, boxShadow: "0 2px 16px rgba(10,12,16,0.06)", padding: "48px 48px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 26, animation: "fadeUp 0.6s 0.1s both" }}><Tag live>AGENT ACTIVE</Tag><Tag>ONE-TIME PURCHASE</Tag><Tag>SELF-HOSTED</Tag></div>
            <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(48px,6vw,86px)", letterSpacing: "-0.03em", lineHeight: 0.88, color: INK, marginBottom: 8, animation: "fadeUp 0.6s 0.25s both" }}>Grow on</h2>
            <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(48px,6vw,86px)", letterSpacing: "-0.03em", lineHeight: 0.88, color: "transparent", WebkitTextStroke: `2px ${INK}`, marginBottom: 30, animation: "fadeUp 0.6s 0.3s both" }}>autopilot.</h2>
            <p style={{ fontFamily: SANS, fontSize: 15, color: INK3, lineHeight: 1.75, maxWidth: 460, marginBottom: 32, fontWeight: 400, animation: "fadeUp 0.6s 0.4s both" }}>Human-quality AI replies, undetectable by design, running 24/7 on your infrastructure. Pay once — <strong style={{ color: INK, fontWeight: 700 }}>own it forever.</strong></p>
            <div style={{ display: "flex", border: `1px solid ${BORDER2}`, overflow: "hidden", marginBottom: 30, animation: "fadeUp 0.6s 0.5s both" }}>
                {M.map((m, i) => (<div key={i} style={{ flex: 1, padding: "13px 18px", borderRight: i < M.length - 1 ? `1px solid ${BORDER2}` : "none", textAlign: "center", background: i % 2 === 0 ? BG2 : BG3 }}><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, color: INK, lineHeight: 1 }}>{m.n}</div><div style={{ fontFamily: MONO, fontSize: 8.5, color: INK4, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 3, fontWeight: 600 }}>{m.l}</div></div>))}
            </div>
            <div style={{ display: "flex", gap: 10, animation: "fadeUp 0.6s 0.6s both" }}>
                <button style={{ padding: "14px 32px", background: INK, color: BG2, fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>GET X-CONNECT — $199 <Ico n="arrow" s={13} c={BG2} /></button>
                <button onClick={onReplay} style={{ padding: "14px 20px", background: "transparent", color: INK3, fontFamily: MONO, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", border: `1px solid ${BORDER2}`, cursor: "pointer" }}>↺ Replay</button>
            </div>
        </div>
    </div>);
}

// ── ROOT ──────────────────────────────────────────────────────────────────
const TOTAL = 7, DURS = [8000, 9000, 9000, 9000, 9500, 10000, 0];
const LABELS = ["Overview", "Pipeline", "Stealth & Cost", "Performance", "Competitors", "Pricing", "Deploy"];
const SCENES = [S1, S2, S3, S4, S5, S6];

export default function App() {
    const [sc, setSc] = useState(0); const [tick, setTick] = useState(0); const [secs, setSecs] = useState(0);
    const goTo = useCallback(i => { setSc(i); setTick(t => t + 1); }, []);
    const advance = useCallback(() => { setSc(s => { const n = Math.min(s + 1, TOTAL - 1); setTick(t => t + 1); return n; }); }, []);
    const back = useCallback(() => { setSc(s => { const n = Math.max(s - 1, 0); setTick(t => t + 1); return n; }); }, []);
    useEffect(() => { if (!DURS[sc]) return; const t = setTimeout(advance, DURS[sc]); return () => clearTimeout(t); }, [sc, tick, advance]);
    useEffect(() => { const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t); }, []);
    useEffect(() => { const h = e => { if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); advance(); } if (e.key === "ArrowLeft") { e.preventDefault(); back(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [advance, back]);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss2 = String(secs % 60).padStart(2, "0");
    return (<div style={{ width: "100vw", height: "100vh", background: BG0, color: INK, overflow: "hidden", position: "relative", fontFamily: MONO }}>
        <style>{CSS}</style>
        <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", backgroundImage: `linear-gradient(${BORDER} 1px,transparent 1px),linear-gradient(90deg,${BORDER} 1px,transparent 1px)`, backgroundSize: "40px 40px" }} />
        <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(10,12,16,0.007) 3px,rgba(10,12,16,0.007) 4px)" }} />
        {DURS[sc] > 0 && <div key={`b-${tick}`} style={{ position: "fixed", top: 0, left: 0, height: 2, zIndex: 200, background: INK, opacity: 0.55, animation: `timerW ${DURS[sc]}ms linear forwards` }} />}
        {/* STATUS BAR */}
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 150, height: 30, background: INK, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", padding: "0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
                {[{ lbl: "STATUS", val: "AGENT ACTIVE", col: "#4ade80", live: true }, { lbl: "PRODUCT", val: "X-CONNECT", col: "rgba(255,255,255,0.9)" }, { lbl: "DETECTION", val: "0 FLAGS", col: "#4ade80" }, { lbl: "PRICE", val: "$199 OTP", col: "#4ade80" }, { lbl: "AI", val: "FRONTIER LLM", col: "rgba(255,255,255,0.7)" }].map((c, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", height: 30, borderRight: "1px solid rgba(255,255,255,0.1)", ...(i === 0 ? { borderLeft: "1px solid rgba(255,255,255,0.1)" } : {}) }}>{c.live && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", animation: "pulseDot 2s infinite", display: "inline-block", boxShadow: "0 0 6px rgba(74,222,128,0.6)", flexShrink: 0 }} />}<span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "rgba(255,255,255,0.38)" }}>{c.lbl}</span><span style={{ fontFamily: MONO, fontSize: 11, color: c.col, fontWeight: 700, letterSpacing: "0.06em" }}>{c.val}</span></div>))}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>{mm}:{ss2}</span>
        </div>
        {/* NAVBAR */}
        <div style={{ position: "fixed", top: 30, left: 0, right: 0, zIndex: 100, height: 48, background: BG2, borderBottom: `2px solid ${BORDER3}`, display: "flex", alignItems: "stretch", boxShadow: "0 2px 12px rgba(10,12,16,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "0 22px", borderRight: `2px solid ${BORDER3}`, gap: 10 }}>
                <span style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, letterSpacing: "0.14em", color: INK }}>X-CONNECT</span>
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: BG2, letterSpacing: "0.12em", background: INK, padding: "2px 8px" }}>AI</span>
            </div>
            {LABELS.map((l, i) => (<button key={i} onClick={() => goTo(i)} style={{ display: "flex", alignItems: "center", padding: "0 18px", fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", color: sc === i ? INK : INK4, background: sc === i ? BG3 : "transparent", fontWeight: sc === i ? 700 : 500, border: "none", borderRight: `1px solid ${BORDER}`, borderBottom: sc === i ? `2px solid ${INK}` : "2px solid transparent", transition: "all 0.15s", position: "relative", top: 1 }}>{l}</button>))}
        </div>
        {/* TICKER */}
        <div style={{ position: "fixed", top: 78, left: 0, right: 0, zIndex: 90 }}><Tape /></div>
        {/* SCENES */}
        <div style={{ position: "fixed", top: 108, bottom: 54, left: 0, right: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {SCENES.map((Scene, i) => (<div key={i} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: sc === i ? 1 : 0, pointerEvents: sc === i ? "all" : "none", transition: "opacity 0.45s cubic-bezier(0.4,0,0.2,1)", overflowY: "auto", overflowX: "hidden" }}><Scene active={sc === i} /></div>))}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: sc === 6 ? 1 : 0, pointerEvents: sc === 6 ? "all" : "none", transition: "opacity 0.45s cubic-bezier(0.4,0,0.2,1)", overflowY: "auto" }}><S7 onReplay={() => goTo(0)} /></div>
        </div>
        {/* BOTTOM NAV */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, height: 54, background: BG2, borderTop: `2px solid ${BORDER3}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
            <button onClick={back} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: sc === 0 ? INK5 : INK3, background: "none", border: `1px solid ${BORDER2}`, padding: "6px 14px", cursor: "pointer" }}>← Back</button>
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                {Array.from({ length: TOTAL }).map((_, i) => (<button key={i} onClick={() => goTo(i)} style={{ width: sc === i ? 22 : 6, height: 6, borderRadius: sc === i ? 3 : "50%", background: sc === i ? INK : BORDER3, border: `1px solid ${sc === i ? INK : "transparent"}`, cursor: "pointer", transition: "all 0.25s", padding: 0 }} />))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: INK4, letterSpacing: "0.1em" }}>{sc + 1}/{TOTAL} · {LABELS[sc].toUpperCase()}</span>
                <button onClick={advance} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: sc === TOTAL - 1 ? INK5 : BG2, background: sc === TOTAL - 1 ? "transparent" : INK, border: `1px solid ${sc === TOTAL - 1 ? BORDER2 : INK}`, padding: "6px 18px", cursor: "pointer" }}>Next →</button>
            </div>
        </div>
    </div>);
}
