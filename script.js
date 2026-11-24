(() => {
  "use strict";

  const TARGET_CENTISECONDS = 1000; // 10.00秒
  const TRANSITION_COOLDOWN_MS = 220;
  const START_CUE_DURATION_MS = 700;

  const appEl = document.getElementById("app");
  const screenIdle = document.getElementById("screen-idle");
  const screenRunning = document.getElementById("screen-running");
  const screenResult = document.getElementById("screen-result");

  const btnStart = document.getElementById("btn-start");
  const btnStop = document.getElementById("btn-stop");
  const btnRetry = document.getElementById("btn-retry");

  const startCueEl = document.getElementById("start-cue");
  const resultCardEl = document.getElementById("result-card");
  const resultTimeEl = document.getElementById("result-time");
  const resultDiffEl = document.getElementById("result-diff");

  let state = "idle"; // "idle" | "running" | "result"
  let startTimeMs = 0;
  let lastTransitionAt = -Infinity;
  let startCueTimerId = null;
  let audioCtx = null;
  let keyHeld = false;

  /**
   * 短い「ピッ」という合図音を Web Audio API で鳴らす。
   * 音が鳴らせない環境でも計測を妨げないよう例外は握りつぶす。
   */
  function playStartBeep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }

      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }

      const now = audioCtx.currentTime;
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1046.5, now); // 聞き取りやすい高めの音（C6）

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch (_) {
      // 音声再生不可の環境でも無音のまま進行する
    }
  }

  /**
   * 計測開始時に「スタート！」を一瞬表示する。
   */
  function flashStartCue() {
    if (startCueTimerId !== null) {
      window.clearTimeout(startCueTimerId);
      startCueTimerId = null;
    }

    startCueEl.classList.add("is-visible");
    startCueEl.setAttribute("aria-hidden", "false");

    startCueTimerId = window.setTimeout(() => {
      startCueEl.classList.remove("is-visible");
      startCueEl.setAttribute("aria-hidden", "true");
      startCueTimerId = null;
    }, START_CUE_DURATION_MS);
  }

  function hideStartCueImmediately() {
    if (startCueTimerId !== null) {
      window.clearTimeout(startCueTimerId);
      startCueTimerId = null;
    }
    startCueEl.classList.remove("is-visible");
    startCueEl.setAttribute("aria-hidden", "true");
  }

  /**
   * 経過時間（ミリ秒）から表示用テキストを生成する。
   * 表示上の小数第2位（10ms単位で四捨五入）を基準に差を計算し、
   * 10.00秒のときは必ず「ぴったり！」とする。
   */
  function formatResult(elapsedMs) {
    const safeMs = Math.max(0, elapsedMs);
    const centiseconds = Math.round(safeMs / 10);
    const timeText = `${(centiseconds / 100).toFixed(2)}秒`;
    const diffCentiseconds = centiseconds - TARGET_CENTISECONDS;

    if (diffCentiseconds === 0) {
      return {
        timeText,
        diffText: "ぴったり！",
        isExact: true
      };
    }

    const diffSecondsText = (Math.abs(diffCentiseconds) / 100).toFixed(2);
    if (diffCentiseconds < 0) {
      return {
        timeText,
        diffText: `10秒まであと${diffSecondsText}秒`,
        isExact: false
      };
    }

    return {
      timeText,
      diffText: `10秒より${diffSecondsText}秒オーバー`,
      isExact: false
    };
  }

  function setScreen(nextState) {
    state = nextState;
    appEl.dataset.state = nextState;

    screenIdle.hidden = nextState !== "idle";
    screenRunning.hidden = nextState !== "running";
    screenResult.hidden = nextState !== "result";

    if (nextState === "idle") {
      btnStart.focus({ preventScroll: true });
    } else if (nextState === "running") {
      btnStop.focus({ preventScroll: true });
    } else if (nextState === "result") {
      btnRetry.focus({ preventScroll: true });
    }
  }

  function canTransition(nowMs) {
    return nowMs - lastTransitionAt >= TRANSITION_COOLDOWN_MS;
  }

  function startGame() {
    const now = performance.now();
    if (state !== "idle" || !canTransition(now)) {
      return;
    }

    lastTransitionAt = now;
    playStartBeep();
    startTimeMs = performance.now();
    setScreen("running");
    flashStartCue();
  }

  function stopGame() {
    const now = performance.now();
    if (state !== "running" || !canTransition(now)) {
      return;
    }

    const elapsedMs = now - startTimeMs;
    lastTransitionAt = now;
    hideStartCueImmediately();

    const { timeText, diffText, isExact } = formatResult(elapsedMs);
    resultTimeEl.textContent = timeText;
    resultDiffEl.textContent = diffText;
    resultCardEl.classList.toggle("is-exact", isExact);

    setScreen("result");
  }

  function resetGame() {
    const now = performance.now();
    if (state !== "result" || !canTransition(now)) {
      return;
    }

    lastTransitionAt = now;
    hideStartCueImmediately();
    resultCardEl.classList.remove("is-exact");
    setScreen("idle");
  }

  function triggerCurrentAction() {
    if (state === "idle") {
      startGame();
    } else if (state === "running") {
      stopGame();
    } else if (state === "result") {
      resetGame();
    }
  }

  btnStart.addEventListener("click", () => {
    startGame();
  });

  btnStop.addEventListener("click", () => {
    stopGame();
  });

  btnRetry.addEventListener("click", () => {
    resetGame();
  });

  // キーボード操作（Space / Enter）
  // 長押しによる連続発火と、ボタンフォーカス時の click 二重発火を防ぐ
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    if (event.repeat || keyHeld) {
      return;
    }

    keyHeld = true;
    triggerCurrentAction();
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space" || event.key === "Enter") {
      keyHeld = false;
    }
  });

  window.addEventListener("blur", () => {
    keyHeld = false;
  });

  // 初期画面をセット
  setScreen("idle");
})();
