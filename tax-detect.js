/* ================================================================
 * tax-detect.js — レシート消費税率 自動認識ユーティリティ
 * index.html / president.html / admin.html から共通利用される純粋関数群
 *
 * 提供API (window.TaxDetect):
 *   - buildOCRPrompt()                          Gemini向けプロンプト
 *   - parseOCRResponse(rawText)                 Gemini応答からJSONを抽出
 *   - classifyTax(parsed, amount)               単一/混在/不明 を判定
 *   - migrateExpense(expense)                   旧スキーマ→新スキーマ移行
 *   - buildBreakdownFromRate(amount, rate)      単一税率から内訳を生成
 *   - expandTaxSegments(amount, breakdown)      JDL用セグメントへ展開
 *   - renderTaxCard(el, expenseLike, onEdit)    読取結果カードを描画
 *   - openTaxFallbackModal(amount, onConfirm)   確認モーダルを開く
 *   - formatYen(n)                              共通: ¥カンマ整形
 * ================================================================ */
(function (global) {
  'use strict';

  // ----------------- 共通ユーティリティ -----------------
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const formatYen = (n) => `¥${num(n).toLocaleString()}`;

  // ----------------- OCRプロンプト -----------------
  function buildOCRPrompt() {
    return `このレシート・領収書から情報を抽出し、必ずJSON形式のみで回答してください。

抽出項目：
- date: 日付（YYYY-MM-DD形式）
  ※「令和」「平成」と明記されている場合のみ和暦→西暦に変換してください。
  ※「26年4月17日」のように元号の記載がない2桁年は、西暦2000年代として扱ってください(例: "26年" → "2026", "25年" → "2025")。
  ※「2026/4/17」「2026-04-17」など西暦4桁はそのまま使ってください。
  例: "令和6年4月17日" → "2024-04-17" / "26年4月17日" → "2026-04-17"
- amount: 税込合計金額（整数。記号・カンマ不要）
- store: 店名・会社名（先頭に多い固有名詞）
- tax_breakdown:
    - taxable_10: 10%対象の税抜額(整数)
    - tax_10:    10%消費税額(整数)
    - taxable_8: 8%軽減対象の税抜額(整数)
    - tax_8:     8%消費税額(整数)
    - taxable_0: 非課税(対象外)金額(整数)
- is_mixed: 8%と10%が両方含まれる場合 true、それ以外 false
- confidence: 抽出の自信度 0.0〜1.0

判定ルール:
- 「10%対象 ¥XXX」「8%対象 ¥XXX」「内消費税」等の税率別小計欄があれば最優先で読み取ってください
- 商品行末尾の「※」「軽」マークは 8%軽減税率の印です
- 飲食店のレシートで持ち帰り(テイクアウト)表記がなければ通常は10%、コンビニで食品+雑貨混在なら is_mixed:true を検討してください
- 明確に税率が不明な場合は confidence < 0.6 にしてください
- 必ず amount === taxable_10 + tax_10 + taxable_8 + tax_8 + taxable_0 が成立する値を返してください

例:
{"date":"2026-03-18","amount":1500,"store":"コーナン","tax_breakdown":{"taxable_10":1364,"tax_10":136,"taxable_8":0,"tax_8":0,"taxable_0":0},"is_mixed":false,"confidence":0.95}
{"date":"2026-04-02","amount":876,"store":"セブンイレブン","tax_breakdown":{"taxable_10":300,"tax_10":30,"taxable_8":505,"tax_8":41,"taxable_0":0},"is_mixed":true,"confidence":0.88}

読み取れない項目は null にしてください。`;
  }

  // ----------------- OCRレスポンスのJSON抽出 -----------------
  function parseOCRResponse(rawText) {
    if (!rawText) return null;
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); }
    catch { return null; }
  }

  // ----------------- 分類ロジック -----------------
  // 戻り値: { kind: 'single'|'mixed'|'unknown', rate?, breakdown? }
  function classifyTax(parsed, totalAmount) {
    if (!parsed || !parsed.tax_breakdown) return { kind: 'unknown' };
    const b = normalizeBreakdown(parsed.tax_breakdown);
    const has10 = (b.taxable_10 + b.tax_10) > 0;
    const has8  = (b.taxable_8  + b.tax_8)  > 0;
    const has0  = b.taxable_0 > 0;
    const sum = b.taxable_10 + b.tax_10 + b.taxable_8 + b.tax_8 + b.taxable_0;
    const consistent = Math.abs(sum - num(totalAmount)) <= 2;
    const conf = parsed.confidence == null ? 1 : Number(parsed.confidence);

    if (!consistent || conf < 0.6) return { kind: 'unknown' };
    if (has10 && has8)          return { kind: 'mixed',  breakdown: b };
    if (has8)                   return { kind: 'single', rate: '8',  breakdown: b };
    if (has10)                  return { kind: 'single', rate: '10', breakdown: b };
    if (has0)                   return { kind: 'single', rate: '0',  breakdown: b };
    return { kind: 'unknown' };
  }

  function normalizeBreakdown(b) {
    return {
      taxable_10: num(b.taxable_10),
      tax_10:     num(b.tax_10),
      taxable_8:  num(b.taxable_8),
      tax_8:      num(b.tax_8),
      taxable_0:  num(b.taxable_0),
    };
  }

  // ----------------- 単一税率から内訳を機械的に生成 -----------------
  // 内税方式 (税込額から税抜・税額を逆算)
  function buildBreakdownFromRate(amount, rate, source) {
    const a = num(amount);
    const r = String(rate);
    const out = {
      taxable_10: 0, tax_10: 0,
      taxable_8:  0, tax_8:  0,
      taxable_0:  0,
      source: source || 'manual',
      confidence: source === 'legacy' ? 0.5 : 1.0,
    };
    if (r === '10') {
      const tax = Math.floor(a * 10 / 110);
      out.tax_10 = tax;
      out.taxable_10 = a - tax;
    } else if (r === '8') {
      const tax = Math.floor(a * 8 / 108);
      out.tax_8 = tax;
      out.taxable_8 = a - tax;
    } else {
      out.taxable_0 = a;
    }
    return out;
  }

  // ----------------- レガシーデータ移行 -----------------
  // 既存 expense オブジェクトに taxBreakdown が無ければ tax から生成して付与
  function migrateExpense(e) {
    if (!e || typeof e !== 'object') return e;
    if (e.taxBreakdown && typeof e.taxBreakdown === 'object') {
      // 整合性が壊れているなら作り直す
      const b = e.taxBreakdown;
      const sum = num(b.taxable_10) + num(b.tax_10) + num(b.taxable_8) + num(b.tax_8) + num(b.taxable_0);
      if (Math.abs(sum - num(e.amount)) <= 2) return e;
    }
    const rate = String(e.tax ?? '10');
    e.taxBreakdown = buildBreakdownFromRate(e.amount, rate, 'legacy');
    return e;
  }

  // ----------------- JDL用セグメント展開 -----------------
  // breakdown を税率セグメントへ。amount は実際に出力したい行金額(按分後など)。
  // 戻り値: [{ rate:'10'|'8'|'0', label, area, amount, tax }]
  function expandTaxSegments(amount, breakdown, taxAreaForNonZero) {
    const total = num(amount);
    const b = normalizeBreakdown(breakdown || {});
    const fullTotal = b.taxable_10 + b.tax_10 + b.taxable_8 + b.tax_8 + b.taxable_0;

    // 内訳が空 / 整合しない → 単一10%扱いで返す（呼出側で安全側に倒す）
    if (fullTotal <= 0) {
      return [{
        rate: '10',
        label: '10%',
        area: taxAreaForNonZero || '仕入',
        method: '内税',
        amount: total,
        tax: Math.floor(total * 10 / 110),
      }];
    }

    // 各税率区分の税込合計
    const segs = [
      { rate: '10', label: '10%',    grossKey: ['taxable_10', 'tax_10'], rateNum: 10 },
      { rate: '8',  label: '軽減8%', grossKey: ['taxable_8',  'tax_8'],  rateNum: 8 },
      { rate: '0',  label: '',       grossKey: ['taxable_0'],            rateNum: 0 },
    ];

    // 全体内訳total に対する total の按分比 (按分や端数調整用)
    const ratio = total / fullTotal;
    const result = [];
    let absorbed = 0;
    let absorbIdx = -1;

    segs.forEach((s, idx) => {
      const grossFull = s.grossKey.reduce((a, k) => a + num(b[k]), 0);
      if (grossFull <= 0) return;
      const segAmount = Math.floor(grossFull * ratio);
      const segTax = s.rateNum === 0 ? 0 : Math.floor(segAmount * s.rateNum / (100 + s.rateNum));
      result.push({
        rate: s.rate,
        label: s.label,
        area: s.rate === '0' ? '' : (taxAreaForNonZero || '仕入'),
        method: s.rate === '0' ? '' : '内税',
        amount: segAmount,
        tax: segTax,
      });
      absorbed += segAmount;
      if (s.rate !== '0') absorbIdx = result.length - 1; // 端数は10% or 8% に寄せる
    });

    // 端数を最大の非ゼロセグメントに加算 (按分計算で1〜2円ズレが出るため)
    if (result.length > 0 && absorbed !== total) {
      const diff = total - absorbed;
      const target = absorbIdx >= 0 ? result[absorbIdx] : result[0];
      target.amount += diff;
      if (target.rate !== '0') {
        const r = target.rate === '8' ? 8 : 10;
        target.tax = Math.floor(target.amount * r / (100 + r));
      }
    }

    return result;
  }

  // ----------------- カード描画 -----------------
  // expenseLike: { amount, taxBreakdown, tax }
  // onEdit: () => void   編集ボタンを押したとき
  function renderTaxCard(el, expenseLike, onEdit) {
    if (!el) return;
    const amount = num(expenseLike?.amount);
    const b = expenseLike?.taxBreakdown
      ? normalizeBreakdown(expenseLike.taxBreakdown)
      : null;

    if (!b || (b.taxable_10 + b.tax_10 + b.taxable_8 + b.tax_8 + b.taxable_0) <= 0) {
      el.innerHTML = `
        <div class="tax-card tax-card-unknown">
          <span class="tax-card-icon">⚠️</span>
          <span class="tax-card-text">税率を確認してください</span>
          <button type="button" class="tax-card-btn" data-tax-edit>選択</button>
        </div>`;
    } else {
      const has10 = (b.taxable_10 + b.tax_10) > 0;
      const has8  = (b.taxable_8  + b.tax_8)  > 0;
      const has0  = b.taxable_0 > 0;
      const isMixed = [has10, has8, has0].filter(Boolean).length >= 2;

      if (isMixed) {
        const parts = [];
        if (has10) parts.push(`<span class="tax-seg">10%: ${formatYen(b.taxable_10 + b.tax_10)}<small>（内税${formatYen(b.tax_10)}）</small></span>`);
        if (has8)  parts.push(`<span class="tax-seg">軽8%: ${formatYen(b.taxable_8  + b.tax_8)}<small>（内税${formatYen(b.tax_8)}）</small></span>`);
        if (has0)  parts.push(`<span class="tax-seg">対象外: ${formatYen(b.taxable_0)}</span>`);
        el.innerHTML = `
          <div class="tax-card tax-card-mixed">
            <span class="tax-card-icon">📊</span>
            <span class="tax-card-title">混在</span>
            <div class="tax-card-segs">${parts.join('')}</div>
            <button type="button" class="tax-card-btn" data-tax-edit>編集</button>
          </div>`;
      } else {
        const rate = has8 ? '軽減8%' : (has10 ? '10%' : '対象外');
        const tax = has8 ? b.tax_8 : (has10 ? b.tax_10 : 0);
        const icon = has0 && !has10 && !has8 ? '➖' : '✅';
        const taxText = (has10 || has8) ? `（内税 ${formatYen(tax)}）` : '';
        el.innerHTML = `
          <div class="tax-card tax-card-single">
            <span class="tax-card-icon">${icon}</span>
            <span class="tax-card-title">${rate}</span>
            <span class="tax-card-amount">${formatYen(amount)}<small>${taxText}</small></span>
            <button type="button" class="tax-card-btn" data-tax-edit>編集</button>
          </div>`;
      }
    }
    if (typeof onEdit === 'function') {
      const btn = el.querySelector('[data-tax-edit]');
      if (btn) btn.addEventListener('click', onEdit);
    }
  }

  // ----------------- 確認モーダル -----------------
  // amount を渡すと、ユーザー選択を反映した taxBreakdown を onConfirm に渡す
  function openTaxFallbackModal(amount, initialBreakdown, onConfirm) {
    ensureModal();
    const modal = document.getElementById('taxFallbackModal');
    const body  = document.getElementById('taxFallbackBody');
    const total = num(amount);

    const init = initialBreakdown ? normalizeBreakdown(initialBreakdown) : null;
    const initRate = init
      ? ((init.taxable_10 + init.tax_10 > 0 && init.taxable_8 + init.tax_8 > 0) ? 'mixed'
        : (init.taxable_8 + init.tax_8 > 0) ? '8'
        : (init.taxable_10 + init.tax_10 > 0) ? '10'
        : '0')
      : '10';

    body.innerHTML = `
      <div class="taxfb-row">
        <div class="taxfb-label">税込合計</div>
        <div class="taxfb-amount">${formatYen(total)}</div>
      </div>
      <div class="taxfb-tabs">
        ${['10', '8', 'mixed', '0'].map(v => `
          <button type="button" class="taxfb-tab" data-rate="${v}">${
            v === '10' ? '10%' : v === '8' ? '軽減8%' : v === 'mixed' ? '混在' : '対象外'
          }</button>
        `).join('')}
      </div>
      <div id="taxfbMixedPane" class="taxfb-mixed" style="display:none">
        <div class="taxfb-mixed-row">
          <label>10%対象（税込）</label>
          <input type="number" id="taxfbT10" min="0" step="1" value="${init ? (init.taxable_10 + init.tax_10) : ''}">
        </div>
        <div class="taxfb-mixed-row">
          <label>8%対象（税込）</label>
          <input type="number" id="taxfbT8"  min="0" step="1" value="${init ? (init.taxable_8 + init.tax_8) : ''}">
        </div>
        <div class="taxfb-mixed-hint" id="taxfbHint"></div>
      </div>
      <div class="taxfb-actions">
        <button type="button" class="taxfb-cancel">キャンセル</button>
        <button type="button" class="taxfb-ok">決定</button>
      </div>
    `;

    let currentRate = initRate;
    const tabs = body.querySelectorAll('.taxfb-tab');
    const pane = body.querySelector('#taxfbMixedPane');
    const hint = body.querySelector('#taxfbHint');
    const t10El = body.querySelector('#taxfbT10');
    const t8El  = body.querySelector('#taxfbT8');

    const updateHint = () => {
      const g10 = Math.max(0, num(t10El.value));
      const g8  = Math.max(0, num(t8El.value));
      const used = g10 + g8;
      const rest = total - used;
      if (rest < 0) {
        hint.textContent = `⚠️ 合計が ${formatYen(used)} で税込合計 ${formatYen(total)} を超えています`;
        hint.style.color = '#dc2626';
      } else {
        hint.textContent = rest > 0
          ? `残り ${formatYen(rest)} は「対象外」として扱われます`
          : `合計一致 ✓`;
        hint.style.color = '#6b7280';
      }
    };
    [t10El, t8El].forEach(el => el.addEventListener('input', updateHint));
    updateHint();

    const refreshTabs = () => {
      tabs.forEach(t => {
        const active = t.dataset.rate === currentRate;
        t.classList.toggle('active', active);
      });
      pane.style.display = currentRate === 'mixed' ? '' : 'none';
    };
    tabs.forEach(t => t.addEventListener('click', () => {
      currentRate = t.dataset.rate;
      refreshTabs();
    }));
    refreshTabs();

    const close = () => { modal.style.display = 'none'; };
    body.querySelector('.taxfb-cancel').addEventListener('click', close);
    body.querySelector('.taxfb-ok').addEventListener('click', () => {
      let breakdown;
      if (currentRate === 'mixed') {
        const g10 = Math.max(0, num(t10El.value));
        const g8  = Math.max(0, num(t8El.value));
        if (g10 + g8 > total) {
          alert('内訳が税込合計を超えています');
          return;
        }
        const tax10 = Math.floor(g10 * 10 / 110);
        const tax8  = Math.floor(g8  *  8 / 108);
        breakdown = {
          taxable_10: g10 - tax10, tax_10: tax10,
          taxable_8:  g8  - tax8,  tax_8:  tax8,
          taxable_0:  total - g10 - g8,
          source: 'manual',
          confidence: 1.0,
        };
      } else {
        breakdown = buildBreakdownFromRate(total, currentRate, 'manual');
      }
      close();
      onConfirm && onConfirm(breakdown);
    });

    modal.style.display = 'flex';
  }

  function ensureModal() {
    if (document.getElementById('taxFallbackModal')) return;
    // モーダルとカード用CSSを注入(各HTML側で個別CSSを書かなくていいように)
    const style = document.createElement('style');
    style.textContent = `
      .tax-card{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;
                border:1.5px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-size:13px;margin-bottom:10px}
      .tax-card-single{background:#f0fdf4;border-color:#bbf7d0}
      .tax-card-mixed{background:#eff6ff;border-color:#bfdbfe;flex-direction:column;align-items:stretch}
      .tax-card-mixed>span{display:inline-block}
      .tax-card-mixed .tax-card-title{font-weight:700}
      .tax-card-unknown{background:#fffbeb;border-color:#fde68a}
      .tax-card-icon{font-size:16px}
      .tax-card-title{font-weight:700}
      .tax-card-amount{font-weight:700;margin-left:auto}
      .tax-card-amount small{font-weight:400;color:#6b7280;margin-left:4px}
      .tax-card-btn{margin-left:auto;padding:5px 12px;border:1px solid #d1d5db;background:white;
                    border-radius:5px;font-size:11px;font-weight:700;cursor:pointer}
      .tax-card-btn:hover{background:#f3f4f6}
      .tax-card-segs{display:flex;flex-wrap:wrap;gap:8px;width:100%;margin-top:4px}
      .tax-seg{display:inline-block;padding:4px 8px;background:white;border:1px solid #dbeafe;
               border-radius:5px;font-size:12px;font-weight:600}
      .tax-seg small{font-weight:400;color:#6b7280;margin-left:2px}

      #taxFallbackModal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);
                        z-index:400;align-items:center;justify-content:center;padding:14px}
      #taxFallbackModal .taxfb-box{background:white;border-radius:12px;max-width:420px;width:100%;
                                   padding:18px;box-shadow:0 12px 32px rgba(0,0,0,.2)}
      #taxFallbackModal .taxfb-title{font-size:15px;font-weight:700;margin-bottom:12px}
      .taxfb-row{display:flex;justify-content:space-between;align-items:center;
                 padding:8px 10px;background:#f3f4f6;border-radius:6px;margin-bottom:12px;font-size:13px}
      .taxfb-row .taxfb-amount{font-weight:700;font-size:15px}
      .taxfb-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
      .taxfb-tab{padding:10px;border:1.5px solid #d1d5db;background:white;border-radius:6px;
                 font-size:13px;font-weight:700;cursor:pointer}
      .taxfb-tab.active{background:#dbeafe;border-color:#2563eb;color:#1d4ed8}
      .taxfb-mixed{background:#f9fafb;border-radius:6px;padding:10px;margin-bottom:12px}
      .taxfb-mixed-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;margin-bottom:6px;font-size:13px}
      .taxfb-mixed-row input{padding:7px;border:1px solid #d1d5db;border-radius:5px;text-align:right;font-size:13px}
      .taxfb-mixed-hint{font-size:11px;color:#6b7280;margin-top:4px}
      .taxfb-actions{display:flex;gap:8px;justify-content:flex-end}
      .taxfb-cancel,.taxfb-ok{padding:9px 16px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;border:none}
      .taxfb-cancel{background:white;border:1px solid #d1d5db}
      .taxfb-ok{background:#2563eb;color:white}
    `;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'taxFallbackModal';
    modal.innerHTML = `
      <div class="taxfb-box" onclick="event.stopPropagation()">
        <div class="taxfb-title">💰 税率を選択</div>
        <div id="taxFallbackBody"></div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    document.body.appendChild(modal);
  }

  // ----------------- export -----------------
  global.TaxDetect = {
    buildOCRPrompt,
    parseOCRResponse,
    classifyTax,
    migrateExpense,
    buildBreakdownFromRate,
    expandTaxSegments,
    renderTaxCard,
    openTaxFallbackModal,
    formatYen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
