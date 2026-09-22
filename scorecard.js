/* ================================================================
   FreePokerHub — Score Card & Buy-In Tracker
   Screens: login -> setup -> game -> end -> results
   ================================================================ */
(function () {
  "use strict";

  /* ---------------- state ---------------- */
  var STORE_KEY = "fph_scorecard_v1";
  var state = {
    signedIn: false,
    rateCoins: 100,     // coin count that ...
    rateValue: 5,       // ... equals this dollar value
    players: [],        // {id, first, last, buyins:[{coins,value}], finalCoins}
    nextId: 1,
    phase: "login"      // login|setup|game|end|results
  };

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function dollarsPerCoin() {
    if (!state.rateCoins || state.rateCoins <= 0) return 0;
    return state.rateValue / state.rateCoins;
  }
  function coinsToValue(coins) { return coins * dollarsPerCoin(); }
  // value in whole cents (integer) — used for exact settlement math
  function coinsToCents(coins) {
    if (!state.rateCoins || state.rateCoins <= 0) return 0;
    return Math.round(coins * state.rateValue * 100 / state.rateCoins);
  }
  function fmt(v) {
    var neg = v < 0;
    var s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? "-" + s : s;
  }
  function fmtCents(c) { return fmt(c / 100); }
  function fmtSigned(v) {
    if (v > 0) return "+" + fmt(v);
    if (v < 0) return fmt(v); // fmt already adds the minus
    return fmt(0);
  }
  function initials(p) {
    var a = (p.first || "?").charAt(0);
    var b = (p.last || "").charAt(0);
    return (a + b).toUpperCase();
  }
  function fullName(p) {
    return (p.first + (p.last ? " " + p.last : "")).trim();
  }
  function boughtCoins(p) {
    return p.buyins.reduce(function (s, b) { return s + b.coins; }, 0);
  }
  function boughtCount(p) { return p.buyins.length; }

  var toastT;
  function toast(msg) {
    var t = $("sc-toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------------- persistence ---------------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d && typeof d === "object") {
        state = Object.assign(state, d);
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------------- screen routing ---------------- */
  function show(phase) {
    state.phase = phase;
    ["sc-login", "sc-setup", "sc-game", "sc-end", "sc-results"].forEach(function (idp) {
      $(idp).classList.remove("active");
    });
    $("sc-" + phase).classList.add("active");
    window.scrollTo(0, 0);
    if (phase === "setup") renderSetup();
    if (phase === "game") renderGame();
    if (phase === "end") renderEnd();
    if (phase === "results") renderResults();
    save();
  }

  /* ================================================================
     LOGIN
     ================================================================ */
  function detectIOS() {
    var ua = navigator.userAgent || "";
    var iOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
    if (iOS) document.body.classList.add("is-ios");
  }
  function signIn(provider) {
    state.signedIn = true;
    save();
    if (provider) toast("Signed in with " + provider);
    // if a game is already in progress, resume it
    if (state.players.length && state.phase && state.phase !== "login") {
      show(state.phase === "login" ? "setup" : state.phase);
    } else {
      show("setup");
    }
  }

  /* ================================================================
     SETUP
     ================================================================ */
  function readDenom() {
    var c = parseFloat($("denom-coins").value);
    var v = parseFloat($("denom-value").value);
    if (!isNaN(c) && c > 0) state.rateCoins = c;
    if (!isNaN(v) && v >= 0) state.rateValue = v;
    updateDenomHint();
  }
  function updateDenomHint() {
    var dpc = dollarsPerCoin();
    $("denom-hint").innerHTML =
      "<b>" + (+state.rateCoins).toLocaleString() + "</b> coins = <b>" + fmt(state.rateValue) +
      "</b> &nbsp;·&nbsp; each coin is worth <b>" + fmt(dpc) + "</b>";
  }
  // keep the "buy-in value" field in sync when coins typed (and vice-versa)
  function syncAssignFromCoins() {
    var c = parseFloat($("p-coins").value);
    if (!isNaN(c)) $("p-value").value = coinsToValue(c).toFixed(2);
  }
  function syncAssignFromValue() {
    var v = parseFloat($("p-value").value);
    var dpc = dollarsPerCoin();
    if (!isNaN(v) && dpc > 0) $("p-coins").value = Math.round(v / dpc);
  }

  function addPlayer() {
    var first = $("p-first").value.trim();
    var last = $("p-last").value.trim();
    if (!first) { toast("Enter a first name"); $("p-first").focus(); return; }
    var coins = parseFloat($("p-coins").value);
    if (isNaN(coins) || coins < 0) coins = state.rateCoins;

    state.players.push({
      id: state.nextId++,
      first: first,
      last: last,
      buyins: [{ coins: coins, value: coinsToValue(coins) }],
      finalCoins: null
    });
    // reset name fields, keep the assign defaults
    $("p-first").value = "";
    $("p-last").value = "";
    $("p-coins").value = state.rateCoins;
    $("p-value").value = (+state.rateValue).toFixed(2);
    $("p-first").focus();
    renderSetup();
    save();
  }

  function renderSetup() {
    updateDenomHint();
    var list = $("setup-list");
    list.innerHTML = "";
    if (!state.players.length) {
      list.appendChild(el("div", "empty-note", "No players yet. Add at least two to start."));
    } else {
      state.players.forEach(function (p) {
        var bc = boughtCoins(p);
        var row = el("div", "plr");
        row.innerHTML =
          '<div class="plr-avatar">' + esc(initials(p)) + '</div>' +
          '<div class="plr-main">' +
            '<div class="plr-name">' + esc(fullName(p)) + '</div>' +
            '<div class="plr-meta"><b>' + bc.toLocaleString() + '</b> coins buy-in</div>' +
          '</div>' +
          '<div class="plr-right">' +
            '<div class="plr-value">' + fmt(coinsToValue(bc)) + '</div>' +
          '</div>';
        var x = el("button", "btn-x", "&times;");
        x.title = "Remove";
        x.onclick = function () { removePlayer(p.id); };
        row.appendChild(x);
        list.appendChild(row);
      });
    }
    $("btn-start").disabled = state.players.length < 2;
  }
  function removePlayer(id) {
    state.players = state.players.filter(function (p) { return p.id !== id; });
    if (state.phase === "setup") renderSetup(); else renderGame();
    save();
  }

  /* ================================================================
     GAME
     ================================================================ */
  function renderGame() {
    $("rate-line").innerHTML =
      "Rate: <b style='color:var(--gold2)'>" + (+state.rateCoins).toLocaleString() +
      " coins = " + fmt(state.rateValue) + "</b>";

    var totCoins = 0;
    state.players.forEach(function (p) { totCoins += boughtCoins(p); });
    $("tot-players").textContent = state.players.length;
    $("tot-coins").textContent = totCoins.toLocaleString();
    $("tot-money").textContent = fmt(coinsToValue(totCoins));

    var list = $("game-list");
    list.innerHTML = "";
    state.players.forEach(function (p) {
      var bc = boughtCoins(p);
      var row = el("div", "plr");
      row.innerHTML =
        '<div class="plr-avatar">' + esc(initials(p)) + '</div>' +
        '<div class="plr-main">' +
          '<div class="plr-name">' + esc(fullName(p)) + '</div>' +
          '<div class="plr-meta"><b>' + bc.toLocaleString() + '</b> coins &nbsp;·&nbsp; ' +
            boughtCount(p) + ' buy-in' + (boughtCount(p) === 1 ? "" : "s") + '</div>' +
        '</div>' +
        '<div class="plr-right">' +
          '<div class="plr-value">' + fmt(coinsToValue(bc)) + '</div>' +
          '<div class="plr-sub">bought in</div>' +
        '</div>';
      var actions = el("div", "plr-actions");
      var buy = el("button", "btn-buyin", "Buy In");
      buy.onclick = function () { openBuyIn(p.id); };
      var x = el("button", "btn-x", "&times;");
      x.title = "Remove player";
      x.onclick = function () { confirmRemove(p); };
      actions.appendChild(buy);
      actions.appendChild(x);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function confirmRemove(p) {
    openConfirm("Remove " + fullName(p) + "?",
      "This clears their buy-ins for this game.",
      function () { removePlayer(p.id); toast(fullName(p) + " removed"); });
  }

  /* ---- buy-in modal ---- */
  var buyinTargetId = null;
  function openBuyIn(id) {
    buyinTargetId = id;
    var p = state.players.find(function (x) { return x.id === id; });
    if (!p) return;
    $("buyin-who").innerHTML =
      '<div class="plr-avatar">' + esc(initials(p)) + '</div><span>' + esc(fullName(p)) + '</span>';
    // prefill with the default denomination
    $("buyin-coins").value = state.rateCoins;
    $("buyin-value").value = (+state.rateValue).toFixed(2);
    updateBuyinTotal();
    openModal("buyin-modal");
    setTimeout(function () { $("buyin-coins").select(); }, 60);
  }
  function updateBuyinTotal() {
    var p = state.players.find(function (x) { return x.id === buyinTargetId; });
    if (!p) return;
    var add = parseFloat($("buyin-coins").value) || 0;
    var after = boughtCoins(p) + add;
    $("buyin-total").innerHTML =
      "New total for " + esc(fullName(p)) + ": <b>" + after.toLocaleString() +
      " coins</b> (" + fmt(coinsToValue(after)) + ")";
  }
  function confirmBuyIn() {
    var p = state.players.find(function (x) { return x.id === buyinTargetId; });
    if (!p) return;
    var coins = parseFloat($("buyin-coins").value);
    if (isNaN(coins) || coins <= 0) { toast("Enter a coin count"); return; }
    p.buyins.push({ coins: coins, value: coinsToValue(coins) });
    closeModal("buyin-modal");
    renderGame();
    save();
    toast(fullName(p) + " bought in " + coins.toLocaleString() + " coins");
  }

  /* ================================================================
     END GAME
     ================================================================ */
  function renderEnd() {
    var list = $("end-list");
    list.innerHTML = "";
    state.players.forEach(function (p) {
      var bc = boughtCoins(p);
      var def = (p.finalCoins != null) ? p.finalCoins : bc;
      var row = el("div", "end-row");
      row.innerHTML =
        '<div class="plr-avatar">' + esc(initials(p)) + '</div>' +
        '<div class="end-name">' + esc(fullName(p)) +
          '<small>bought ' + bc.toLocaleString() + ' coins · ' + fmt(coinsToValue(bc)) + '</small></div>';
      var wrap = el("div", "end-input-wrap");
      var inp = el("input", "sc-input");
      inp.type = "number"; inp.inputMode = "numeric"; inp.min = "0";
      inp.value = def;
      inp.setAttribute("data-pid", p.id);
      inp.style.textAlign = "right";
      var sub = el("div", "plr-sub", fmt(coinsToValue(def)));
      inp.addEventListener("input", function () {
        var v = parseFloat(inp.value) || 0;
        sub.textContent = fmt(coinsToValue(v));
        updateBalanceBanner();
      });
      wrap.appendChild(inp);
      wrap.appendChild(sub);
      row.appendChild(wrap);
      list.appendChild(row);
    });
    updateBalanceBanner();
  }
  function readEndInputs() {
    var total = 0;
    document.querySelectorAll('#end-list input[data-pid]').forEach(function (inp) {
      var id = parseInt(inp.getAttribute("data-pid"), 10);
      var v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) v = 0;
      var p = state.players.find(function (x) { return x.id === id; });
      if (p) { p.finalCoins = v; total += v; }
    });
    return total;
  }
  function totalBought() {
    return state.players.reduce(function (s, p) { return s + boughtCoins(p); }, 0);
  }
  function updateBalanceBanner() {
    var finalTotal = 0;
    document.querySelectorAll('#end-list input[data-pid]').forEach(function (inp) {
      finalTotal += (parseFloat(inp.value) || 0);
    });
    var bought = totalBought();
    var diff = finalTotal - bought;
    var b = $("balance-banner");
    if (diff === 0) {
      b.className = "balance-banner balance-ok";
      b.innerHTML = "&#10003; Chips balance: " + finalTotal.toLocaleString() +
        " coins in, " + bought.toLocaleString() + " coins bought.";
    } else {
      b.className = "balance-banner balance-off";
      var word = diff > 0 ? "more" : "fewer";
      b.innerHTML = "&#9888; Final chips are " + Math.abs(diff).toLocaleString() + " coins " + word +
        " than were bought (" + fmt(coinsToValue(Math.abs(diff))) + "). Check the counts.";
    }
  }

  /* ================================================================
     RESULTS + SETTLEMENT
     ================================================================ */
  function computeResults() {
    // net in cents per player = final value - bought value
    return state.players.map(function (p) {
      var bc = boughtCoins(p);
      var fc = (p.finalCoins != null) ? p.finalCoins : bc;
      var netCents = coinsToCents(fc) - coinsToCents(bc);
      return {
        p: p,
        boughtCoins: bc,
        finalCoins: fc,
        boughtCents: coinsToCents(bc),
        finalCents: coinsToCents(fc),
        netCents: netCents
      };
    });
  }

  // greedy minimal-transaction settlement on integer cents
  function settle(results) {
    var debtors = [], creditors = [];
    results.forEach(function (r) {
      if (r.netCents < 0) debtors.push({ name: fullName(r.p), amt: -r.netCents });
      else if (r.netCents > 0) creditors.push({ name: fullName(r.p), amt: r.netCents });
    });
    debtors.sort(function (a, b) { return b.amt - a.amt; });
    creditors.sort(function (a, b) { return b.amt - a.amt; });

    var tx = [];
    var i = 0, j = 0, guard = 0;
    while (i < debtors.length && j < creditors.length && guard < 1000) {
      guard++;
      var pay = Math.min(debtors[i].amt, creditors[j].amt);
      if (pay > 0) {
        tx.push({ from: debtors[i].name, to: creditors[j].name, cents: pay });
      }
      debtors[i].amt -= pay;
      creditors[j].amt -= pay;
      if (debtors[i].amt <= 0) i++;
      if (creditors[j].amt <= 0) j++;
    }
    return tx;
  }

  function renderResults() {
    var results = computeResults();

    // sort by net desc (winners first)
    var sorted = results.slice().sort(function (a, b) { return b.netCents - a.netCents; });

    var list = $("results-list");
    list.innerHTML = "";
    sorted.forEach(function (r) {
      var cls = r.netCents > 0 ? "net-pos" : (r.netCents < 0 ? "net-neg" : "net-zero");
      var sign = r.netCents > 0 ? "+" : "";
      var verb = r.netCents > 0 ? "won" : (r.netCents < 0 ? "lost" : "broke even");
      var row = el("div", "result-player");
      row.innerHTML =
        '<div class="plr-avatar">' + esc(initials(r.p)) + '</div>' +
        '<div class="rp-main">' +
          '<div class="rp-name">' + esc(fullName(r.p)) + '</div>' +
          '<div class="rp-flow">' + r.finalCoins.toLocaleString() + ' final &minus; ' +
            r.boughtCoins.toLocaleString() + ' bought coins &nbsp;·&nbsp; ' + verb + '</div>' +
        '</div>' +
        '<div class="rp-net ' + cls + '">' + sign + fmtCents(r.netCents) + '</div>';
      list.appendChild(row);
    });

    // balance note
    var sumNet = results.reduce(function (s, r) { return s + r.netCents; }, 0);
    var sub = $("res-sub");
    if (sumNet === 0) {
      sub.innerHTML = "How everyone finished. Wins and losses balance out.";
    } else {
      sub.innerHTML = "How everyone finished. <span style='color:#f0a89f'>Note: totals are off by " +
        fmtCents(Math.abs(sumNet)) + " — final chip counts don't match buy-ins.</span>";
    }

    // settlement
    var tx = settle(results);
    var sl = $("settle-list");
    sl.innerHTML = "";
    if (!tx.length) {
      sl.appendChild(el("div", "settle-none", "Everyone broke even — nothing to settle. 🎉"));
    } else {
      tx.forEach(function (t) {
        var row = el("div", "settle-row");
        row.innerHTML =
          '<span class="from">' + esc(t.from) + '</span>' +
          '<span class="arrow">&rarr; pays &rarr;</span>' +
          '<span class="to">' + esc(t.to) + '</span>' +
          '<span class="amt">' + fmtCents(t.cents) + '</span>';
        sl.appendChild(row);
      });
    }
    save();
  }

  /* ================================================================
     MODALS
     ================================================================ */
  function openModal(id) { $(id).classList.add("show"); }
  function closeModal(id) { $(id).classList.remove("show"); }

  var confirmCb = null;
  function openConfirm(title, text, cb) {
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    confirmCb = cb;
    openModal("confirm-modal");
  }

  /* ================================================================
     WIRE UP
     ================================================================ */
  function init() {
    detectIOS();
    load();

    // login
    $("sc-google-btn").onclick = function () { signIn("Google"); };
    $("sc-apple-btn").onclick = function () { signIn("Apple"); };
    $("sc-guest-btn").onclick = function () { signIn(null); };

    // setup — denomination
    $("denom-coins").addEventListener("input", function () { readDenom(); });
    $("denom-value").addEventListener("input", function () { readDenom(); });
    // setup — assign sync
    $("p-coins").addEventListener("input", syncAssignFromCoins);
    $("p-value").addEventListener("input", syncAssignFromValue);
    $("btn-add-player").onclick = addPlayer;
    $("p-last").addEventListener("keydown", function (e) { if (e.key === "Enter") addPlayer(); });
    $("btn-start").onclick = function () {
      if (state.players.length < 2) { toast("Add at least two players"); return; }
      readDenom();
      show("game");
    };

    // game
    $("btn-game-add").onclick = function () { show("setup"); };
    $("btn-game-menu").onclick = function () { show("setup"); };
    $("btn-end").onclick = function () {
      state.players.forEach(function (p) { if (p.finalCoins == null) p.finalCoins = boughtCoins(p); });
      show("end");
    };

    // buy-in modal
    $("buyin-coins").addEventListener("input", function () {
      var c = parseFloat($("buyin-coins").value);
      if (!isNaN(c)) $("buyin-value").value = coinsToValue(c).toFixed(2);
      updateBuyinTotal();
    });
    $("buyin-value").addEventListener("input", function () {
      var v = parseFloat($("buyin-value").value);
      var dpc = dollarsPerCoin();
      if (!isNaN(v) && dpc > 0) $("buyin-coins").value = Math.round(v / dpc);
      updateBuyinTotal();
    });
    $("buyin-ok").onclick = confirmBuyIn;
    $("buyin-cancel").onclick = function () { closeModal("buyin-modal"); };
    $("buyin-close").onclick = function () { closeModal("buyin-modal"); };

    // end game
    $("btn-end-back").onclick = function () { readEndInputs(); show("game"); };
    $("btn-end-cancel").onclick = function () { show("game"); };
    $("btn-calc").onclick = function () { readEndInputs(); show("results"); };

    // results
    $("btn-res-edit").onclick = function () { show("end"); };
    $("btn-back-game").onclick = function () { show("game"); };
    $("btn-newgame").onclick = function () {
      openConfirm("Start a new game?", "This clears all players, buy-ins and results.", function () {
        var signed = state.signedIn;
        state = {
          signedIn: signed, rateCoins: 100, rateValue: 5,
          players: [], nextId: 1, phase: "setup"
        };
        $("denom-coins").value = 100;
        $("denom-value").value = 5;
        $("p-coins").value = 100;
        $("p-value").value = "5.00";
        save();
        show("setup");
        toast("New game started");
      });
    };

    // confirm modal
    $("confirm-ok").onclick = function () {
      closeModal("confirm-modal");
      if (confirmCb) confirmCb();
      confirmCb = null;
    };
    $("confirm-cancel").onclick = function () { closeModal("confirm-modal"); confirmCb = null; };

    // close modals on backdrop click
    document.querySelectorAll(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(ov.id); });
    });

    // restore denomination fields if we loaded a game
    $("denom-coins").value = state.rateCoins;
    $("denom-value").value = state.rateValue;
    $("p-coins").value = state.rateCoins;
    $("p-value").value = (+state.rateValue).toFixed(2);

    // decide starting screen
    if (state.signedIn && state.players.length) {
      show(["game", "end", "results"].indexOf(state.phase) >= 0 ? state.phase : "game");
    } else if (state.signedIn) {
      show("setup");
    } else {
      show("login");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
