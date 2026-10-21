// Spectrum explorer: draws every allocation on a zoomable, logarithmic frequency axis.
// Data comes from /api/spectrum. All text from the data is added with textContent, never as HTML.
(function () {
    'use strict';

    // Service categories, matched in order against the sub-band usage and services text.
    // Colours come from the --cat-* variables in style.css so they follow light and dark mode.
    var CATEGORIES = [
        { key: 'amateur', label: 'Amateur', match: /amateur/i },
        { key: 'maritime', label: 'Maritime', match: /maritime|marine|ship|port/i },
        { key: 'aero', label: 'Aeronautical', match: /aeronaut|aviation|aircraft|airport/i },
        { key: 'broadcast', label: 'Broadcasting', match: /broadcast|television|\btv\b|\bdab\b|\bfm\b|sound/i },
        { key: 'radar', label: 'Radar and navigation', match: /radar|radiolocation|radionavigation|navigation|gnss|gps|galileo|altimeter/i },
        { key: 'science', label: 'Science and astronomy', match: /astronom|meteorolog|earth exploration|space research|weather|science/i },
        { key: 'satellite', label: 'Satellite', match: /satellite|space/i },
        { key: 'srd', label: 'Short range and ISM', match: /short range|\bsrd\b|\bism\b|rfid|wlan|wi-?fi|rlan|bluetooth|alarm|wireless microphone|model control|ultra wideband|\buwb\b/i },
        { key: 'cellular', label: 'Mobile networks', match: /\bgsm|umts|\blte\b|\bimt\b|\b5g\b|\bnr\b|mobile network|public mobile|cellular|mfcn|bwa/i },
        { key: 'fixed', label: 'Fixed links', match: /fixed|radio relay|point-to-point|link/i },
        { key: 'mobile', label: 'Land mobile', match: /mobile|pmr|tetra|virve|paging|taxi/i },
        { key: 'other', label: 'Other', match: /./ }
    ];

    // Shortcuts to commonly looked up ranges, in Hz.
    var PRESETS = [
        ['Whole spectrum', 0, 0],
        ['HF', 3e6, 30e6],
        ['VHF', 30e6, 300e6],
        ['UHF', 300e6, 3e9],
        ['FM radio', 87.5e6, 108e6],
        ['Airband', 108e6, 137e6],
        ['2 m amateur', 144e6, 146e6],
        ['Marine VHF', 156e6, 162.05e6],
        ['433 MHz', 433.05e6, 434.79e6],
        ['PMR446', 446e6, 446.2e6],
        ['868 MHz', 863e6, 870e6],
        ['GNSS', 1164e6, 1610e6],
        ['2.4 GHz', 2400e6, 2483.5e6],
        ['5 GHz Wi-Fi', 5150e6, 5875e6]
    ];

    // ITU band names drawn above the axis.
    var ITU_BANDS = [
        ['VLF', 3e3, 3e4], ['LF', 3e4, 3e5], ['MF', 3e5, 3e6], ['HF', 3e6, 3e7],
        ['VHF', 3e7, 3e8], ['UHF', 3e8, 3e9], ['SHF', 3e9, 3e10], ['EHF', 3e10, 3e11]
    ];

    var LANE_H = 30, LANE_GAP = 4, MAX_LANES = 10, BAND_STRIP = 18, AXIS_H = 30, PAD = 6;
    var MIN_SPAN = 2e-6; // smallest view in decades (about 0.0005 % of the frequency)

    var bands = [];
    var full = { lo: 3, hi: 12 };
    var view = { lo: 3, hi: 12 };
    var hiddenCats = {};
    var colors = {};
    var hits = [];
    var selectedFreq = null;
    var canvas, ctx, overview, octx, stage, tip, rangeTitle, details;

    function $(id) { return document.getElementById(id); }
    function log10(v) { return Math.log(v) / Math.LN10; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function formatHz(value) {
        var units = [['GHz', 1e9], ['MHz', 1e6], ['kHz', 1e3]];
        for (var i = 0; i < units.length; i++) {
            if (Math.abs(value) >= units[i][1]) {
                return trim(value / units[i][1]) + ' ' + units[i][0];
            }
        }
        return trim(value) + ' Hz';
    }
    function trim(n) { return String(parseFloat(n.toPrecision(7))); }

    // "433 MHz", "2.4GHz", "446,1 mhz" -> Hz. A bare number is read as MHz.
    function parseFrequency(text) {
        var m = String(text).trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)?$/i);
        if (!m) { return null; }
        var mult = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 }[(m[2] || 'mhz').toLowerCase()];
        var hz = parseFloat(m[1]) * mult;
        return hz > 0 ? hz : null;
    }

    function categorize(band) {
        var text = band.usage + ' ' + band.services;
        for (var i = 0; i < CATEGORIES.length; i++) {
            if (CATEGORIES[i].match.test(text)) { return CATEGORIES[i].key; }
        }
        return 'other';
    }

    function readColors() {
        var style = getComputedStyle(document.documentElement);
        CATEGORIES.forEach(function (c) { colors[c.key] = style.getPropertyValue('--cat-' + c.key).trim() || '#888'; });
        ['ink', 'ink-muted', 'line', 'surface-raised', 'surface-sunken', 'lingon', 'lake'].forEach(function (name) {
            colors[name] = style.getPropertyValue('--' + name).trim();
        });
    }

    // --- View ---------------------------------------------------------------

    function setView(lo, hi, keepHash) {
        var span = clamp(hi - lo, MIN_SPAN, full.hi - full.lo);
        var mid = (lo + hi) / 2;
        lo = mid - span / 2;
        hi = mid + span / 2;
        if (lo < full.lo) { hi += full.lo - lo; lo = full.lo; }
        if (hi > full.hi) { lo -= hi - full.hi; hi = full.hi; }
        view.lo = lo;
        view.hi = hi;
        if (tip) { tip.hidden = true; }
        if (!keepHash) { scheduleHash(); }
        scheduleDraw();
    }

    function setViewHz(fLo, fHi) {
        // Pad the range a little so the edges of the bands are visible.
        var lo = log10(fLo), hi = log10(fHi), pad = (hi - lo) * 0.04;
        setView(lo - pad, hi + pad);
    }

    function zoomAt(factor, x) {
        var w = canvas.clientWidth || 1;
        var at = view.lo + (x / w) * (view.hi - view.lo);
        var span = clamp((view.hi - view.lo) * factor, MIN_SPAN, full.hi - full.lo);
        var ratio = x / w;
        setView(at - span * ratio, at + span * (1 - ratio));
    }

    function xToLog(x) { return view.lo + (x / canvas.clientWidth) * (view.hi - view.lo); }
    function hzToX(hz, w) { return (log10(hz) - view.lo) / (view.hi - view.lo) * w; }

    var hashTimer = null;
    function scheduleHash() {
        clearTimeout(hashTimer);
        hashTimer = setTimeout(function () {
            var lo = Math.round(Math.pow(10, view.lo)), hi = Math.round(Math.pow(10, view.hi));
            var hash = '#' + lo + '-' + hi + (selectedFreq ? '@' + Math.round(selectedFreq) : '');
            history.replaceState(null, '', hash);
        }, 250);
    }

    function readHash() {
        var m = location.hash.match(/^#(\d+)-(\d+)(?:@(\d+))?$/);
        if (!m || +m[2] <= +m[1]) { return false; }
        setView(log10(+m[1]), log10(+m[2]), true);
        if (m[3]) { select(+m[3]); }
        return true;
    }

    // --- Drawing ------------------------------------------------------------

    var drawPending = false;
    function scheduleDraw() {
        if (drawPending) { return; }
        drawPending = true;
        requestAnimationFrame(function () { drawPending = false; draw(); drawOverview(); });
    }

    function sizeCanvas(c, cssW, cssH) {
        var dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
            c.width = Math.round(cssW * dpr);
            c.height = Math.round(cssH * dpr);
            c.style.height = cssH + 'px';
        }
        var context = c.getContext('2d');
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        return context;
    }

    function layout(w) {
        // Greedy lanes: each visible band goes to the first lane that is free at its left edge.
        var fLo = Math.pow(10, view.lo), fHi = Math.pow(10, view.hi);
        var laneEnd = [], placed = [], hidden = 0, shown = 0;
        for (var i = 0; i < bands.length; i++) {
            var b = bands[i];
            if (b.hi <= fLo || b.lo >= fHi || hiddenCats[b.cat]) { continue; }
            var x0 = Math.max(hzToX(b.lo, w), -2);
            var x1 = Math.min(hzToX(b.hi, w), w + 2);
            if (x1 - x0 < 2) { x1 = x0 + 2; }
            var lane = -1;
            for (var k = 0; k < laneEnd.length; k++) {
                if (laneEnd[k] <= x0) { lane = k; break; }
            }
            if (lane === -1) {
                if (laneEnd.length >= MAX_LANES) { hidden++; continue; }
                lane = laneEnd.length;
                laneEnd.push(0);
            }
            laneEnd[lane] = x1 + 1;
            placed.push({ band: b, x0: x0, x1: x1, lane: lane });
            shown++;
        }
        return { placed: placed, lanes: Math.max(laneEnd.length, 1), hidden: hidden, shown: shown };
    }

    function niceStep(raw) {
        var p = Math.pow(10, Math.floor(log10(raw))), n = raw / p;
        return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
    }

    function ticks(w) {
        var out = [], span = view.hi - view.lo;
        var fLo = Math.pow(10, view.lo), fHi = Math.pow(10, view.hi);
        if (span > 1.2) {
            var subs = span < 3 ? [1, 2, 5] : [1];
            for (var e = Math.floor(view.lo); e <= Math.ceil(view.hi); e++) {
                subs.forEach(function (s) { out.push(s * Math.pow(10, e)); });
            }
        } else if (span > 0.25) {
            // Wide but not huge: 1, 1.5, 2, 3 … 9 in each decade, thinned out by spacing below.
            var mantissas = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
            for (var d = Math.floor(view.lo); d <= Math.ceil(view.hi); d++) {
                mantissas.forEach(function (m) { out.push(m * Math.pow(10, d)); });
            }
        } else {
            var step = niceStep((fHi - fLo) / Math.max(2, Math.floor(w / 120)));
            for (var f = Math.ceil(fLo / step) * step; f <= fHi; f += step) { out.push(f); }
        }
        // Keep ticks at least 56 px apart so grid lines and labels never crowd together.
        var kept = [], lastX = -Infinity;
        out.forEach(function (hz) {
            if (hz < fLo || hz > fHi) { return; }
            var x = hzToX(hz, w);
            if (x - lastX >= 56) { kept.push(hz); lastX = x; }
        });
        return kept;
    }

    function roundRect(c, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function draw() {
        var w = stage.clientWidth;
        var lay = layout(w);
        var top = BAND_STRIP + AXIS_H;
        var h = top + PAD + lay.lanes * (LANE_H + LANE_GAP) + PAD;
        ctx = sizeCanvas(canvas, w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.textBaseline = 'middle';

        // ITU band strip
        ctx.font = '700 11px "Atkinson Hyperlegible", system-ui, sans-serif';
        ITU_BANDS.forEach(function (ib, i) {
            var x0 = hzToX(ib[1], w), x1 = hzToX(ib[2], w);
            if (x1 < 0 || x0 > w) { return; }
            ctx.fillStyle = i % 2 ? colors['surface-sunken'] : colors['surface-raised'];
            ctx.fillRect(x0, 0, x1 - x0, BAND_STRIP);
            var cx = clamp((Math.max(x0, 0) + Math.min(x1, w)) / 2, 16, w - 16);
            ctx.fillStyle = colors['ink-muted'];
            ctx.textAlign = 'center';
            ctx.fillText(ib[0], cx, BAND_STRIP / 2);
        });

        // Axis and grid
        ctx.font = '400 12px "Atkinson Hyperlegible", system-ui, sans-serif';
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, top - 0.5);
        ctx.lineTo(w, top - 0.5);
        ctx.stroke();
        var lastLabelEnd = -Infinity;
        ticks(w).forEach(function (hz) {
            var x = Math.round(hzToX(hz, w)) + 0.5;
            ctx.strokeStyle = colors.line;
            ctx.beginPath();
            ctx.moveTo(x, top - 6);
            ctx.lineTo(x, h);
            ctx.stroke();
            var label = formatHz(hz), lw = ctx.measureText(label).width;
            var lx = clamp(x, lw / 2 + 2, w - lw / 2 - 2);
            if (lx - lw / 2 > lastLabelEnd + 8) {
                ctx.fillStyle = colors['ink-muted'];
                ctx.textAlign = 'center';
                ctx.fillText(label, lx, BAND_STRIP + AXIS_H / 2 - 2);
                lastLabelEnd = lx + lw / 2;
            }
        });

        // Bands
        hits = [];
        ctx.font = '700 12px "Atkinson Hyperlegible", system-ui, sans-serif';
        ctx.textAlign = 'left';
        lay.placed.forEach(function (p) {
            var y = top + PAD + p.lane * (LANE_H + LANE_GAP);
            var bw = p.x1 - p.x0, color = colors[p.band.cat];
            var primary = p.band.priority !== 'Secondary';
            ctx.globalAlpha = primary ? 0.32 : 0.14;
            ctx.fillStyle = color;
            roundRect(ctx, p.x0, y, bw, LANE_H, 6);
            ctx.fill();
            ctx.globalAlpha = 1;
            if (bw > 4) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash(primary ? [] : [4, 3]);
                roundRect(ctx, p.x0 + 0.75, y + 0.75, bw - 1.5, LANE_H - 1.5, 6);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            var tx0 = Math.max(p.x0, 0) + 8, tx1 = Math.min(p.x1, w) - 8;
            if (tx1 - tx0 > 24) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(tx0, y, tx1 - tx0, LANE_H);
                ctx.clip();
                ctx.fillStyle = colors.ink;
                ctx.fillText(p.band.usage || p.band.services, tx0, y + LANE_H / 2);
                ctx.restore();
            }
            hits.push({ x0: p.x0, x1: p.x1, y0: y, y1: y + LANE_H, band: p.band });
        });

        // Selected frequency marker
        if (selectedFreq) {
            var sx = hzToX(selectedFreq, w);
            if (sx >= 0 && sx <= w) {
                ctx.strokeStyle = colors.lingon;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, BAND_STRIP);
                ctx.lineTo(sx, h);
                ctx.stroke();
            }
        }

        var text = formatHz(Math.pow(10, view.lo)) + ' – ' + formatHz(Math.pow(10, view.hi)) + ' · ' +
            lay.shown + (lay.shown === 1 ? ' allocation' : ' allocations');
        if (lay.hidden) { text += ' (' + lay.hidden + ' more overlap, zoom in to see them)'; }
        rangeTitle.textContent = text;
    }

    function drawOverview() {
        var w = overview.parentNode.clientWidth, h = 28;
        octx = sizeCanvas(overview, w, h);
        octx.clearRect(0, 0, w, h);
        var toX = function (hz) { return (log10(hz) - full.lo) / (full.hi - full.lo) * w; };
        octx.globalAlpha = 0.35;
        bands.forEach(function (b) {
            if (hiddenCats[b.cat]) { return; }
            var x0 = Math.max(toX(b.lo), 0), x1 = Math.max(toX(b.hi), x0 + 1);
            octx.fillStyle = colors[b.cat];
            octx.fillRect(x0, 4, x1 - x0, h - 8);
        });
        octx.globalAlpha = 1;
        var vx0 = (view.lo - full.lo) / (full.hi - full.lo) * w;
        var vx1 = Math.max((view.hi - full.lo) / (full.hi - full.lo) * w, vx0 + 3);
        octx.strokeStyle = colors.lingon;
        octx.lineWidth = 2;
        roundRect(octx, vx0 + 1, 1, vx1 - vx0 - 2, h - 2, 4);
        octx.stroke();
    }

    // --- Details and tooltip -------------------------------------------------

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined) { node.textContent = text; }
        return node;
    }

    function select(hz) {
        selectedFreq = hz;
        var found = bands.filter(function (b) { return b.lo <= hz && b.hi >= hz; });
        details.textContent = '';
        var head = el('div', 'spectrum__details-head');
        head.appendChild(el('h2', 'section-title', 'Allocations at ' + formatHz(hz)));
        var link = el('a', null, 'Open in table view');
        link.href = '/frequency/' + Math.round(hz) + 'Hz';
        head.appendChild(link);
        details.appendChild(head);

        var wrap = el('div', 'table-wrap');
        var table = el('table', 'alloc');
        var thead = el('thead'), tr = el('tr');
        ['Sub-band', 'Sub-band usage', 'Services in Finland', 'Priority', 'Direction', 'Bandwidth', 'Comment'].forEach(function (t) {
            var th = el('th', null, t);
            th.scope = 'col';
            tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
        var tbody = el('tbody');
        found.forEach(function (b) {
            var row = el('tr');
            var first = el('td', 'range', b.range);
            first.style.boxShadow = 'inset 4px 0 0 ' + colors[b.cat];
            row.appendChild(first);
            row.appendChild(el('td', 'usage', b.usage));
            row.appendChild(el('td', null, b.services));
            var pr = el('td');
            if (b.priority) { pr.appendChild(el('span', 'badge badge--' + b.priority.toLowerCase(), b.priority)); }
            row.appendChild(pr);
            row.appendChild(el('td', null, b.direction));
            row.appendChild(el('td', null, b.bandwidth));
            row.appendChild(el('td', null, b.comment));
            tbody.appendChild(row);
        });
        if (!found.length) {
            var empty = el('tr', 'empty'), td = el('td', null, 'No allocations at this frequency.');
            td.colSpan = 7;
            empty.appendChild(td);
            tbody.appendChild(empty);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        details.appendChild(wrap);
        scheduleHash();
        scheduleDraw();
    }

    function hitAt(x, y) {
        for (var i = hits.length - 1; i >= 0; i--) {
            var hb = hits[i];
            if (x >= hb.x0 - 2 && x <= hb.x1 + 2 && y >= hb.y0 && y <= hb.y1) { return hb.band; }
        }
        return null;
    }

    function showTip(band, x, y) {
        if (!band) { tip.hidden = true; return; }
        tip.textContent = '';
        tip.appendChild(el('strong', null, band.usage || band.services));
        tip.appendChild(el('span', null, band.range));
        var meta = [band.services, band.priority, band.direction].filter(Boolean).join(' · ');
        if (meta) { tip.appendChild(el('span', 'spectrum__tip-meta', meta)); }
        tip.hidden = false;
        var sw = stage.clientWidth, tw = tip.offsetWidth;
        tip.style.left = clamp(x + 12, 4, sw - tw - 4) + 'px';
        tip.style.top = (y + 16) + 'px';
    }

    // --- Input ----------------------------------------------------------------

    function bindPointer() {
        var pointers = {}, start = null, pinch = null;

        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            var r = canvas.getBoundingClientRect();
            var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            if (Math.abs(e.deltaX) > Math.abs(dy)) {
                var d = e.deltaX / canvas.clientWidth * (view.hi - view.lo);
                setView(view.lo + d, view.hi + d);
            } else {
                zoomAt(Math.exp(dy * 0.0015), e.clientX - r.left);
            }
        }, { passive: false });

        canvas.addEventListener('pointerdown', function (e) {
            canvas.setPointerCapture(e.pointerId);
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pointers);
            if (ids.length === 1) {
                start = { x: e.clientX, y: e.clientY, lo: view.lo, hi: view.hi, moved: false };
            } else if (ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                pinch = { dist: Math.abs(a.x - b.x) || 1, lo: view.lo, hi: view.hi, mid: (a.x + b.x) / 2 };
                start = null;
            }
        });

        canvas.addEventListener('pointermove', function (e) {
            var r = canvas.getBoundingClientRect();
            if (!pointers[e.pointerId]) {
                showTip(hitAt(e.clientX - r.left, e.clientY - r.top), e.clientX - r.left, e.clientY - r.top);
                return;
            }
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pointers);
            if (pinch && ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var factor = pinch.dist / (Math.abs(a.x - b.x) || 1);
                var w = canvas.clientWidth, mx = pinch.mid - r.left;
                var at = pinch.lo + (mx / w) * (pinch.hi - pinch.lo);
                var span = (pinch.hi - pinch.lo) * factor;
                setView(at - span * (mx / w), at + span * (1 - mx / w));
            } else if (start) {
                var dx = e.clientX - start.x;
                if (Math.abs(dx) > 4 || Math.abs(e.clientY - start.y) > 4) { start.moved = true; }
                if (start.moved) {
                    tip.hidden = true;
                    var shift = -dx / canvas.clientWidth * (start.hi - start.lo);
                    setView(start.lo + shift, start.hi + shift);
                }
            }
        });

        function end(e) {
            var r = canvas.getBoundingClientRect();
            if (start && !start.moved && Object.keys(pointers).length === 1) {
                var x = e.clientX - r.left, y = e.clientY - r.top;
                select(Math.pow(10, xToLog(x)));
                showTip(hitAt(x, y), x, y);
            }
            delete pointers[e.pointerId];
            if (Object.keys(pointers).length < 2) { pinch = null; }
            start = null;
        }
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; pinch = null; start = null; });
        canvas.addEventListener('pointerleave', function () { if (!start) { tip.hidden = true; } });
        canvas.addEventListener('dblclick', function (e) {
            var r = canvas.getBoundingClientRect();
            zoomAt(e.shiftKey ? 2.5 : 0.4, e.clientX - r.left);
        });

        canvas.addEventListener('keydown', function (e) {
            var span = view.hi - view.lo, w = canvas.clientWidth;
            var handled = true;
            if (e.key === 'ArrowLeft') { setView(view.lo - span * 0.1, view.hi - span * 0.1); }
            else if (e.key === 'ArrowRight') { setView(view.lo + span * 0.1, view.hi + span * 0.1); }
            else if (e.key === '+' || e.key === '=') { zoomAt(0.5, w / 2); }
            else if (e.key === '-' || e.key === '_') { zoomAt(2, w / 2); }
            else if (e.key === 'Home') { setView(full.lo, full.hi); }
            else if (e.key === 'Enter' || e.key === ' ') { select(Math.pow(10, (view.lo + view.hi) / 2)); }
            else { handled = false; }
            if (handled) { e.preventDefault(); }
        });

        // Overview: tap or drag to move the window.
        var dragging = false;
        function moveTo(e) {
            var r = overview.getBoundingClientRect();
            var at = full.lo + (e.clientX - r.left) / r.width * (full.hi - full.lo);
            var span = view.hi - view.lo;
            setView(at - span / 2, at + span / 2);
        }
        overview.addEventListener('pointerdown', function (e) { dragging = true; overview.setPointerCapture(e.pointerId); moveTo(e); });
        overview.addEventListener('pointermove', function (e) { if (dragging) { moveTo(e); } });
        overview.addEventListener('pointerup', function () { dragging = false; });
    }

    function bindControls() {
        $('spectrum-zoom-in').onclick = function () { zoomAt(0.5, canvas.clientWidth / 2); };
        $('spectrum-zoom-out').onclick = function () { zoomAt(2, canvas.clientWidth / 2); };
        $('spectrum-reset').onclick = function () { setView(full.lo, full.hi); };
        $('spectrum-goto').onsubmit = function (e) {
            e.preventDefault();
            var input = $('spectrum-freq'), hz = parseFrequency(input.value);
            input.setAttribute('aria-invalid', hz ? 'false' : 'true');
            if (!hz) { return; }
            setViewHz(hz * 0.995, hz * 1.005);
            select(hz);
        };

        var presets = $('spectrum-presets');
        PRESETS.forEach(function (p) {
            var b = el('button', 'chip chip--button', p[0]);
            b.type = 'button';
            if (p[1]) { b.title = formatHz(p[1]) + ' – ' + formatHz(p[2]); }
            b.onclick = function () { p[1] ? setViewHz(p[1], p[2]) : setView(full.lo, full.hi); };
            presets.appendChild(b);
        });
    }

    function buildLegend() {
        var legend = $('spectrum-legend'), present = {};
        bands.forEach(function (b) { present[b.cat] = (present[b.cat] || 0) + 1; });
        legend.textContent = '';
        CATEGORIES.forEach(function (c) {
            if (!present[c.key]) { return; }
            var b = el('button', 'legend__item legend__toggle');
            b.type = 'button';
            b.setAttribute('aria-pressed', 'true');
            b.title = 'Show or hide ' + c.label.toLowerCase();
            var sw = el('span', 'legend__swatch');
            sw.style.background = colors[c.key];
            b.appendChild(sw);
            b.appendChild(document.createTextNode(c.label + ' (' + present[c.key] + ')'));
            b.onclick = function () {
                hiddenCats[c.key] = !hiddenCats[c.key];
                b.setAttribute('aria-pressed', hiddenCats[c.key] ? 'false' : 'true');
                scheduleDraw();
            };
            legend.appendChild(b);
        });
    }

    function init() {
        canvas = $('spectrum-canvas');
        overview = $('spectrum-overview');
        stage = $('spectrum-stage');
        tip = $('spectrum-tip');
        rangeTitle = $('spectrum-view');
        details = $('spectrum-details');
        readColors();
        bindControls();
        bindPointer();
        window.addEventListener('resize', scheduleDraw);
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            readColors();
            buildLegend();
            scheduleDraw();
        });

        fetch('/api/spectrum').then(function (r) {
            if (!r.ok) { throw new Error(r.status); }
            return r.json();
        }).then(function (data) {
            bands = data;
            var min = Infinity, max = 0;
            bands.forEach(function (b) {
                b.cat = categorize(b);
                if (b.lo > 0) { min = Math.min(min, b.lo); }
                max = Math.max(max, b.hi);
            });
            if (!bands.length || !isFinite(min)) { rangeTitle.textContent = 'No allocation data available.'; return; }
            full.lo = log10(min) - 0.05;
            full.hi = log10(max) + 0.05;
            buildLegend();
            if (!readHash()) { setView(full.lo, full.hi, true); }
        }).catch(function () {
            rangeTitle.textContent = 'Could not load the allocation data. Try reloading the page.';
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
